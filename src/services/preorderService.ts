/**
 * preorderService — คำสั่งพรีออเดอร์ (Preorders + PreorderItems)
 *
 * ขอบเขต: สินค้าพรีออเดอร์ (is_preorder: true) เท่านั้น สั่งเป็น "รอบ" (PreorderRounds)
 *   - แยกคอลเลกชันจากออเดอร์ปกติ (orderModel) โดยสิ้นเชิง
 *   - ราคาต่อหน่วย = price_override ของรอบ ?? sale_price ?? product_price (สแนปช็อตลง PreorderItem)
 *   - ค่าส่งคิดฝั่ง server ผ่าน deliveryService (เหมือนออเดอร์ปกติ) ; takeaway = 0
 *   - โปรโมชัน/ส่วนลด: v1 รองรับเฉพาะส่วนลดกรอกมือของแอดมิน (allowManualDiscount) — ยังไม่ผูก discountEngine
 *   - จองโควตาผ่าน preorderRoundService.commitQty (กันจองเกิน max_qty_total) ; ยกเลิกแล้วคืนด้วย releaseQty
 *
 * ข้อจำกัด: ไม่มี transaction — ใช้ best-effort + ชดเชย (คืนโควตา/ลบเอกสาร) ผ่าน Saga เมื่อผิดพลาดกลางคัน
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { Saga } from "../lib/compensation";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import {
  registerAutoRefundOnCancel,
  assertCustomerCancelAllowed,
  setEntityPaymentStatus,
  applyEntityDeliveryUpdate,
  softDeleteEntityWithItems,
} from "../lib/orderLifecycle";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import userModel from "../models/userModel";
import * as preorderRoundService from "./preorderRoundService";
import * as deliveryService from "./deliveryService";
import * as recipeService from "./recipeService";
import { customerMessages, notifyCustomerLater } from "./customerNotifyService";
import { notificationService } from "./notificationService";
import { computePaymentDueAt, onPreorderCancelled, onPreorderPaid } from "./preorderRoundLifecycleService";
import { log } from "../lib/logger";
import { toSatang, toBaht, toBahtFields } from "../lib/money";
import { generateDocNo } from "../lib/productCode";
import type { z } from "zod";
// BACKLOG2 §4 — schema เดียวกับ orderService.updateDelivery() ทุกฟิลด์ (generic ไม่มีอะไรเฉพาะ order)
// ใช้ร่วมกันได้เลย ไม่ต้องสร้างซ้ำ
import type { updateDeliveryBody } from "../schemas/order";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PREORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;
export type PreorderStatus = (typeof PREORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// state machine เดียวกับออเดอร์ปกติ
const NEXT_STATUS: Record<PreorderStatus, PreorderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const ADDRESS_FIELDS = [
  "recipient_name",
  "recipient_phone",
  "house_no",
  "sub_district",
  "district",
  "province",
  "zip_code",
] as const;

// ── Types ────────────────────────────────────────────────────
export interface PreorderLineInput {
  round_item_id: string;
  quantity: number;
  special_request?: string | null;
}

export interface CreatePreorderInput {
  round_id: string;
  order_type: "delivery" | "takeaway";
  delivery_address?: Record<string, string> | null;
  items: PreorderLineInput[];
  /** ส่วนลดกรอกมือ — มีผลเฉพาะเมื่อเรียกจากฝั่งแอดมิน (opts.allowManualDiscount) */
  discount_amount?: number;
}

export interface ListPreorderQuery {
  pagination: Pagination;
  user_id?: string;
  round_id?: string;
  order_status?: PreorderStatus;
  payment_status?: PaymentStatus;
  order_type?: "delivery" | "takeaway";
  search?: string;
  date_from?: string;
  date_to?: string;
  includeDeleted?: boolean;
  sort?: Record<string, 1 | -1>;
}

/** ยอดที่ลูกค้าจองไว้แล้วในรอบนี้ ต่อ round_item_id (เฉพาะพรีออเดอร์ที่ยังไม่ยกเลิก/ไม่ถูกลบ) */
async function quantityAlreadyOrdered(userId: string, roundId: unknown): Promise<Map<string, number>> {
  const mine = await preorderModel
    .find({ user_id: userId, round_id: roundId, deleted_at: null, order_status: { $ne: "cancelled" } })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  if (mine.length === 0) return new Map();
  const rows = await preorderItemModel.aggregate<{ _id: unknown; qty: number }>([
    { $match: { preorder_id: { $in: mine.map((p) => p._id) }, deleted_at: null } },
    { $group: { _id: "$round_item_id", qty: { $sum: "$quantity" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.qty]));
}

// ── CREATE ───────────────────────────────────────────────────
export async function createPreorder(
  userId: string,
  input: CreatePreorderInput,
  opts: { allowManualDiscount?: boolean } = {}
) {
  await dbConnect();
  await assertRefExists(userModel, userId, "ผู้ใช้", "user_id");

  if (input.order_type !== "delivery" && input.order_type !== "takeaway") {
    throw badRequest('order_type ต้องเป็น "delivery" หรือ "takeaway"');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw badRequest("ต้องระบุ items อย่างน้อย 1 รายการ");
  }

  const round = await preorderRoundService.assertRoundOrderable(input.round_id);

  // ── ที่อยู่จัดส่ง ──
  let delivery_address: Record<string, string> | null = null;
  if (input.order_type === "delivery") {
    const addr = input.delivery_address ?? null;
    if (!addr) throw badRequest("การจัดส่งแบบ delivery ต้องระบุ delivery_address");
    for (const f of ADDRESS_FIELDS) {
      if (!addr[f]) throw badRequest(`delivery_address.${f} จำเป็นต้องระบุ`);
    }
    // ตัดฟิลด์เกินทิ้ง (เก็บเฉพาะ ADDRESS_FIELDS) — ไม่ใช้ pick() ตรงนี้ตั้งใจ: ผ่านการเช็ค
    // required field ครบข้างบนแล้ว การ narrow shape แค่ Object.fromEntries ธรรมดาก็พอ
    // (ไม่ได้ทำหน้าที่กัน mass-assignment ที่ต้องรอ route adopt zod เหมือน service อื่น)
    delivery_address = Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, addr[f]]));
  }

  // ── resolve รายการ + คิดราคา ──
  // BACKLOG2 §2: เดิมวน await ทีละรายการ (พรีออเดอร์ N รายการ = query ~2N ครั้งทยอยทีละรายการ ผ่าน
  // getOrderableRoundItem() ตัวเดียว) เปลี่ยนมา batch ผ่าน getOrderableRoundItems() (พหูพจน์) ครั้ง
  // เดียว เหมือน orderService.resolveLines() ที่แก้ไว้แล้วใน §3.18 — validate/error message เดิมทุก
  // จุดต่อรายการ ต่างแค่ "ลำดับ" ของ error เมื่อมีหลายรายการผิดพร้อมกัน (เช็ค id/quantity ของทุก
  // รายการก่อน แล้วค่อยเช็คสิ่งที่ต้องรู้ผลจาก DB — เหมือนที่ยอมรับไว้แล้วใน resolveLines ไม่มีเทสไหน
  // อิงลำดับ error ข้ามรายการอยู่แล้ว)
  const seen = new Set<string>();
  const quantities = input.items.map((raw) => {
    assertObjectId(raw.round_item_id, "round_item_id");
    if (seen.has(String(raw.round_item_id))) {
      throw badRequest("มี round_item_id ซ้ำใน items — รวมจำนวนเป็นรายการเดียว");
    }
    seen.add(String(raw.round_item_id));

    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw badRequest("quantity ของแต่ละรายการต้องเป็นจำนวนเต็มตั้งแต่ 1");
    }
    return quantity;
  });

  const resolvedItems = await preorderRoundService.getOrderableRoundItems(
    input.items.map((raw) => raw.round_item_id),
    String(round._id)
  );

  // docs/preorder-round-flow.md ปัญหา 2 — เดิม product.preorder_config (บังคับกรอก) ไม่ถูกใช้เลย
  // ยอดที่ลูกค้าคนนี้จองไว้แล้วในรอบเดียวกัน (พรีออเดอร์ที่ยังไม่ยกเลิก) ต่อ round_item — ใช้คุม max_order_qty ต่อคน
  const alreadyByRoundItem = await quantityAlreadyOrdered(userId, round._id);

  const lines = resolvedItems.map(({ item, product, unit_price }, idx) => {
    const quantity = quantities[idx];
    const cfg = product.preorder_config ?? {};
    // ขั้นต่ำ = ค่าที่มากกว่าระหว่างรายการในรอบกับตัวสินค้า
    const minQty = Math.max(item.min_order_qty ?? 1, cfg.min_order_qty ?? 1);
    if (quantity < minQty) {
      throw badRequest(`"${product.product_name_th}" สั่งขั้นต่ำ ${minQty} ชิ้นต่อรายการ`);
    }
    // สูงสุดต่อลูกค้า 1 คนต่อรอบ (รวมพรีออเดอร์เดิมในรอบเดียวกัน) — กันคนเดียวกวาดโควตาทั้งรอบ
    if (cfg.max_order_qty != null) {
      const already = alreadyByRoundItem.get(String(item._id)) ?? 0;
      if (already + quantity > cfg.max_order_qty) {
        throw badRequest(
          `"${product.product_name_th}" สั่งได้สูงสุด ${cfg.max_order_qty} ชิ้นต่อคนต่อรอบ` +
            (already > 0 ? ` (สั่งไว้แล้ว ${already} ชิ้น เหลือสั่งได้อีก ${Math.max(0, cfg.max_order_qty - already)})` : "")
        );
      }
    }

    // BACKLOG §3.11 เฟส 5b — unit_price จาก preorderRoundService.getOrderableRoundItems() เป็นสตางค์
    // อยู่แล้ว (price_override/sale_price/product_price เป็นสตางค์ทั้งหมดตั้งแต่เฟส 5b) ไม่ต้องแปลง
    // อะไรเพิ่ม — ก่อนหน้านี้ (เฟส 1-5a) ยังต้อง toSatang() ตรงนี้เพราะฝั่งสินค้ายังเป็นบาทอยู่
    const unitPriceSatang = unit_price;
    return {
      round_item_id: item._id,
      product_id: product._id,
      product_snapshot: {
        product_name_th: product.product_name_th,
        product_name_eng: product.product_name_eng,
      },
      quantity,
      unit_price: unitPriceSatang,
      total_price: toSatang(unitPriceSatang * quantity),
      special_request: input.items[idx].special_request?.trim() || null,
    };
  });

  const subtotal = toSatang(lines.reduce((s, l) => s + l.total_price, 0));

  // ── ค่าส่ง (server คิดเอง) ── deliveryService ยังทำงานเป็นบาท — แปลงข้ามโดเมนแค่จุดนี้
  let delivery_fee = 0;
  if (input.order_type === "delivery") {
    delivery_fee = toSatang(
      (
        await deliveryService.calcDeliveryFee({
          province: delivery_address?.province ?? null,
          subtotal: toBaht(subtotal),
        })
      ).fee
    );
  }

  // ── ส่วนลด (เฉพาะแอดมินกรอกมือ — input.discount_amount เป็นบาทจาก request) ──
  const discount_amount = opts.allowManualDiscount
    ? toSatang(Math.max(0, Number(input.discount_amount) || 0))
    : 0;
  if (discount_amount > subtotal + delivery_fee) {
    throw badRequest("ส่วนลดมากกว่ายอดที่ต้องชำระ");
  }
  const total_amount = toSatang(subtotal - discount_amount + delivery_fee);

  // ── ต้นทุนต่อหน่วย (สแนปช็อตจากสูตรล่าสุด) ──
  const costByProduct = await recipeService.getUnitCostByProduct(
    lines.map((l) => String(l.product_id))
  );

  // ── จองโควตา + สร้างเอกสาร — ชดเชยผ่าน Saga ถ้าพลาดกลางคัน ──
  const saga = new Saga();
  try {
    for (const l of lines) {
      const roundItemId = String(l.round_item_id);
      await preorderRoundService.commitQty(roundItemId, l.quantity);
      saga.onRollback(`releaseQty:${roundItemId}`, () =>
        preorderRoundService.releaseQty(roundItemId, l.quantity)
      );
    }

    // สร้างเอกสารพรีออเดอร์ (retry เมื่อเลขชนกัน)
    let preorder: any = null;
    for (let attempt = 0; attempt < 5 && !preorder; attempt++) {
      try {
        preorder = await preorderModel.create({
          preorder_no: generateDocNo("PRE"),
          user_id: userId,
          round_id: round._id,
          order_type: input.order_type,
          delivery_address,
          subtotal,
          discount_amount,
          delivery_fee,
          total_amount,
          // docs/preorder-round-flow.md ประเด็น 3 — เลยกำหนดแล้วยังไม่จ่าย (ไม่มีสลิปรอตรวจ) → ยกเลิกอัตโนมัติ
          payment_due_at: computePaymentDueAt(new Date(), round.close_date),
        });
      } catch (err: any) {
        if (err?.code === 11000 && attempt < 4) continue;
        throw err;
      }
    }
    saga.onRollback("deletePreorder", () => preorderModel.deleteOne({ _id: preorder._id }));

    await preorderItemModel.insertMany(
      lines.map((l) => ({
        preorder_id: preorder._id,
        round_item_id: l.round_item_id,
        product_id: l.product_id,
        product_snapshot: l.product_snapshot,
        pickup_date: round.pickup_date,
        special_request: l.special_request,
        quantity: l.quantity,
        unit_price: l.unit_price,
        total_price: l.total_price,
        cost_per_unit: costByProduct.get(String(l.product_id)) ?? null,
      }))
    );
    saga.onRollback("deletePreorderItems", () =>
      preorderItemModel.deleteMany({ preorder_id: preorder._id })
    );

    // ทุกขั้นสำเร็จ → ทิ้ง undo ก่อนอ่านผลลัพธ์ (getPreorderById อาจ throw โดยไม่ต้อง rollback)
    saga.commit();

    // แจ้งเจ้าของร้าน (DB + LINE) — คู่กับ orderService.persistOrder · best-effort ไม่ทำให้สร้างพรีออเดอร์ล้มเหลว
    // link = null: ยังไม่มี path หน้าจัดการพรีออเดอร์ฝั่ง frontend ที่ยืนยันแล้ว (docs/LINE.md §9)
    notificationService
      .notify({
        title: `เปิดพรีออเดอร์รอบใหม่ ${preorder.preorder_no}`,
        message: `รอบ ${round.round_name ?? "-"} · ยอดรวม ${toBaht(total_amount).toLocaleString("th-TH")} บาท`,
        module: "order",
        type: "info",
        link: null,
      })
      .catch((err) => log.error("preorder.notify_failed", { preorder_id: String(preorder._id), err }));
    notifyCustomerLater(userId, customerMessages.created("preorder", preorder.preorder_no, total_amount));
    return getPreorderById(String(preorder._id));
  } catch (err) {
    await saga.rollback();
    throw err;
  }
}

// ── READ ─────────────────────────────────────────────────────
// BACKLOG §3.11 — DB เก็บเงินเป็นสตางค์ แต่ API ยังคืนบาททศนิยมเหมือนเดิม (เหมือน orderService)
const PREORDER_MONEY_FIELDS = ["subtotal", "discount_amount", "delivery_fee", "total_amount"] as const;
// cost_per_unit เป็นสตางค์เช่นกันตั้งแต่เฟส 4 — เหตุผลเดียวกับ orderService (ORDER_ITEM_MONEY_FIELDS)
const PREORDER_ITEM_MONEY_FIELDS = ["unit_price", "total_price", "cost_per_unit"] as const;

function presentPreorder<T extends Record<string, unknown>>(preorder: T): T {
  return toBahtFields(preorder, PREORDER_MONEY_FIELDS);
}

function presentPreorderItem(item: any): any {
  return toBahtFields(item, PREORDER_ITEM_MONEY_FIELDS);
}

/**
 * BACKLOG3 §5/§10 — เทียบ orderService.presentOrderWithItems(): populate user_id/round_id บน document
 * ที่มีอยู่แล้วตรง ๆ แทน getPreorderById(id) ที่ต้อง re-query ทั้ง header + items ใหม่ทั้งที่ไม่จำเป็น
 */
async function presentPreorderWithItems(preorder: any, items?: any[]): Promise<any> {
  await preorder.populate("user_id", "user_fullname email user_phone");
  await preorder.populate("round_id", "round_name open_date close_date pickup_date round_status");
  const preorderItems =
    items ?? (await preorderItemModel.find({ preorder_id: preorder._id, deleted_at: null }).lean());
  return { ...presentPreorder(preorder.toObject()), items: preorderItems.map(presentPreorderItem) };
}

export async function listPreorders(query: ListPreorderQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (query.user_id) {
    assertObjectId(query.user_id, "user_id");
    filter.user_id = query.user_id;
  }
  if (query.round_id) {
    assertObjectId(query.round_id, "round_id");
    filter.round_id = query.round_id;
  }
  if (query.order_status) filter.order_status = query.order_status;
  if (query.payment_status) filter.payment_status = query.payment_status;
  if (query.order_type) filter.order_type = query.order_type;
  if (query.search) filter.preorder_no = new RegExp(escapeRegExp(query.search.trim()), "i");
  if (query.date_from || query.date_to) {
    filter.created_at = {};
    if (query.date_from) filter.created_at.$gte = new Date(query.date_from);
    if (query.date_to) filter.created_at.$lte = new Date(query.date_to);
  }

  const [items, total] = await Promise.all([
    preorderModel
      .find(filter)
      .sort(query.sort ?? { created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("user_id", "user_fullname email user_phone")
      .populate("round_id", "round_name open_date close_date pickup_date round_status")
      .lean(),
    preorderModel.countDocuments(filter),
  ]);

  return { items: items.map(presentPreorder), meta: buildMeta(total, query.pagination) };
}

export async function getPreorderById(id: string, opts: { includeDeleted?: boolean } = {}) {
  await dbConnect();
  assertObjectId(id);

  const filter: Record<string, any> = { _id: id };
  if (!opts.includeDeleted) filter.deleted_at = null;

  const preorder = await preorderModel
    .findOne(filter)
    .populate("user_id", "user_fullname email user_phone")
    .populate("round_id", "round_name open_date close_date pickup_date round_status")
    .lean<any>();
  if (!preorder) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");

  const items = await preorderItemModel.find({ preorder_id: preorder._id, deleted_at: null }).lean();
  return { ...presentPreorder(preorder), items: items.map(presentPreorderItem) };
}

export async function getPreorderByNo(preorderNo: string) {
  await dbConnect();
  const preorder = await preorderModel
    .findOne({ preorder_no: preorderNo, deleted_at: null })
    .populate("user_id", "user_fullname email user_phone")
    .populate("round_id", "round_name open_date close_date pickup_date round_status")
    .lean<any>();
  if (!preorder) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");
  const items = await preorderItemModel.find({ preorder_id: preorder._id, deleted_at: null }).lean();
  return { ...presentPreorder(preorder), items: items.map(presentPreorderItem) };
}

// ── UPDATE STATUS (state machine) ───────────────────────────
export async function updatePreorderStatus(
  id: string,
  next: PreorderStatus,
  opts: { cancelled_by?: string; cancelled_reason?: string } = {}
) {
  await dbConnect();
  assertObjectId(id);
  if (!PREORDER_STATUSES.includes(next)) {
    throw badRequest(`order_status ต้องเป็นหนึ่งใน: ${PREORDER_STATUSES.join(", ")}`);
  }

  const preorder = await preorderModel.findOne({ _id: id, deleted_at: null });
  if (!preorder) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");

  const current = preorder.order_status as PreorderStatus;
  // BACKLOG3 §5 — เทียบ orderService.updateOrderStatus: populate แทน re-query ทั้ง header+items
  if (current === next) return presentPreorderWithItems(preorder);
  if (!NEXT_STATUS[current].includes(next)) {
    throw conflict(`เปลี่ยนสถานะจาก "${current}" เป็น "${next}" ไม่ได้`);
  }

  // จำไว้ก่อน cleanup — auto-refund ด้านล่างเปลี่ยน payment_status ใน DB เป็น refunded ไปแล้วตอนเช็คทีหลัง
  const wasPaid = preorder.payment_status === "paid";

  let cancelledItems: any[] | undefined;
  if (next === "cancelled") {
    // cleanup ตอนยกเลิก — best-effort ทั้งหมด (step ที่ fail จะ log ผ่าน logger ไม่ล้มการยกเลิก)
    // ใช้ Saga เพื่อ log สม่ำเสมอ แทน .catch(() => undefined) ที่กลืน error เงียบ (เทียบ orderService)
    const cleanup = new Saga();

    const items = await preorderItemModel
      .find({ preorder_id: preorder._id, deleted_at: null })
      .lean<any[]>();
    cancelledItems = items;
    for (const it of items) {
      cleanup.onRollback(`release-qty-${it._id}`, () =>
        preorderRoundService.releaseQty(String(it.round_item_id), it.quantity)
      );
    }

    // พรีออเดอร์ที่จ่ายเงินแล้ว → คืนเงินอัตโนมัติ · กัน "preorder = cancelled แต่ payment ยัง paid"
    // (BACKLOG 2b.3 — คู่ขนานกับ orderService.updateOrderStatus §2.8) — BACKLOG3 §10: ย้ายไปใช้ร่วม
    // กับ orderService ที่ lib/orderLifecycle.ts แล้ว (คืนโควตาต่อรายการด้านบนยังคงแยกเขียนเอง เพราะ
    // เป็นคนละกลไกกับที่ order คืนสต็อก+ส่วนลด)
    await registerAutoRefundOnCancel({
      saga: cleanup,
      entityKind: "preorder",
      paymentFilter: { preorder_id: preorder._id },
      currentPaymentStatus: preorder.payment_status,
      cancelledBy: opts.cancelled_by,
      entityId: preorder._id,
    });

    await cleanup.rollback();

    preorder.cancelled_at = new Date();
    if (opts.cancelled_by) {
      assertObjectId(opts.cancelled_by, "cancelled_by");
      preorder.cancelled_by = opts.cancelled_by;
    }
    preorder.cancelled_reason = opts.cancelled_reason ?? null;
  }

  preorder.order_status = next;
  await preorder.save();
  notifyCustomerLater(
    preorder.user_id,
    customerMessages.orderStatus("preorder", preorder.preorder_no, next, {
      reason: preorder.cancelled_reason,
      orderType: preorder.order_type,
    })
  );

  // docs/BACKLOG4.md Y1 — ยกเลิกรายการที่ถูกนับเข้าใบผลิตแล้ว → ลดใบผลิต (best-effort ไม่ให้การยกเลิกล้ม)
  if (next === "cancelled") {
    await onPreorderCancelled(String(preorder._id), wasPaid).catch((err) =>
      log.error("preorder.production_reduce_failed", { preorder_id: String(preorder._id), err })
    );
  }
  return presentPreorderWithItems(preorder, cancelledItems);
}

/** สถานะที่ "ลูกค้า" ยกเลิกพรีออเดอร์เองได้ — พอร้านเริ่มเตรียม (preparing ขึ้นไป) ต้องติดต่อร้าน
 *  (เทียบ orderService.CUSTOMER_CANCELABLE_STATUSES) */
export const CUSTOMER_CANCELABLE_STATUSES: readonly PreorderStatus[] = ["pending", "confirmed"];

export async function cancelPreorder(
  id: string,
  opts: {
    cancelled_by?: string;
    cancelled_reason?: string;
    /** ถ้าระบุ: ยกเลิกได้เฉพาะเมื่อสถานะปัจจุบันอยู่ในลิสต์นี้ (ใช้จำกัดสิทธิ์ฝั่งลูกค้า — แอดมินไม่ส่ง = ยกเลิกได้ทุกสถานะที่ยังไม่ completed) */
    allowedFrom?: readonly PreorderStatus[];
  } = {}
) {
  const { allowedFrom, ...rest } = opts;
  // BACKLOG3 §10 — logic เหมือน orderService.cancelOrder เป๊ะ ย้ายไปใช้ร่วมกัน
  if (allowedFrom) {
    await assertCustomerCancelAllowed({
      model: preorderModel,
      id,
      allowedFrom,
      entityLabel: "พรีออเดอร์",
    });
  }
  return updatePreorderStatus(id, "cancelled", rest);
}

// ── payment status (เรียกจาก paymentService ภายหลัง) ────────
// BACKLOG3 §10 — logic เหมือน orderService.setPaymentStatus เป๊ะ ย้ายไปใช้ร่วมกัน
export async function setPaymentStatus(
  preorderId: string,
  status: PaymentStatus,
  paymentId?: string
) {
  const preorder = await setEntityPaymentStatus({
    model: preorderModel,
    id: preorderId,
    idField: "preorder_id",
    status,
    statuses: PAYMENT_STATUSES,
    paymentId,
    entityLabel: "พรีออเดอร์",
  });
  // จ่ายหลังปิดรอบ/หลังสร้างใบผลิต → บวกเข้าใบผลิต (fire-and-forget — ไม่ให้การยืนยันชำระเงินล้มเพราะงานนี้)
  if (status === "paid") {
    onPreorderPaid(preorderId).catch((err) => log.error("preorder.late_payment_sync_failed", { preorder_id: preorderId, err }));
  }
  return presentPreorder(preorder);
}

// BACKLOG2 §4 — คู่ขนานกับ orderService.updateDelivery() เป๊ะ (เดิมพรีออเดอร์ไม่มีฟังก์ชันนี้เลย
// ทั้งที่ preorderModel มีฟิลด์ delivery_status/shipped_at/delivered_at/tracking_no/delivered_note
// ครบเหมือน orderModel ทุกประการ — แอดมินเลยไม่มีทางบันทึกว่าพรีออเดอร์ถูกจัดส่งไปแล้วเลย)
// BACKLOG3 §10 — implementation ย้ายไปใช้ร่วมกับ orderService ที่ lib/orderLifecycle.ts แล้ว
type UpdateDeliveryInput = z.infer<typeof updateDeliveryBody>;

export async function updateDelivery(id: string, input: UpdateDeliveryInput) {
  const updated = await applyEntityDeliveryUpdate({
    model: preorderModel,
    id,
    input,
    entityLabel: "พรีออเดอร์",
  });
  return updated ? presentPreorder(updated) : updated;
}

// ── DELETE (soft) ───────────────────────────────────────────
// BACKLOG3 §10 — logic เหมือน orderService.deleteOrder เป๊ะ ย้ายไปใช้ร่วมกัน
export async function deletePreorder(id: string) {
  return softDeleteEntityWithItems({
    model: preorderModel,
    itemModel: preorderItemModel,
    itemForeignKey: "preorder_id",
    id,
    entityLabel: "พรีออเดอร์",
  });
}
