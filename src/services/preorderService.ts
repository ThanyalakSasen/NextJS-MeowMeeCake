/**
 * preorderService — คำสั่งพรีออเดอร์ (Preorders + PreorderItems)
 *
 * ขอบเขต: สินค้าที่ product_type = "preorder" เท่านั้น สั่งเป็น "รอบ" (PreorderRounds)
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
import { assertObjectId, pick } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import userModel from "../models/userModel";
import * as preorderRoundService from "./preorderRoundService";
import * as deliveryService from "./deliveryService";
import * as recipeService from "./recipeService";

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

const round2 = (n: number) => Math.round(n * 100) / 100;

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

// ── helper: ออกเลขพรีออเดอร์ PRE-YYYYMMDD-XXXXXX ────────────
function randomPreorderNo(now = new Date()): string {
  const ymd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PRE-${ymd}-${rand}`;
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
    delivery_address = pick(addr, ADDRESS_FIELDS) as Record<string, string>;
  }

  // ── resolve รายการ + คิดราคา ──
  const seen = new Set<string>();
  const lines: Array<{
    round_item_id: any;
    product_id: any;
    product_snapshot: { product_name_th: string; product_name_eng: string };
    quantity: number;
    unit_price: number;
    total_price: number;
    special_request: string | null;
  }> = [];

  for (const raw of input.items) {
    assertObjectId(raw.round_item_id, "round_item_id");
    if (seen.has(String(raw.round_item_id))) {
      throw badRequest("มี round_item_id ซ้ำใน items — รวมจำนวนเป็นรายการเดียว");
    }
    seen.add(String(raw.round_item_id));

    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw badRequest("quantity ของแต่ละรายการต้องเป็นจำนวนเต็มตั้งแต่ 1");
    }

    const { item, product, unit_price } = await preorderRoundService.getOrderableRoundItem(
      raw.round_item_id,
      String(round._id)
    );
    if (quantity < (item.min_order_qty ?? 1)) {
      throw badRequest(
        `"${product.product_name_th}" สั่งขั้นต่ำ ${item.min_order_qty} ชิ้นต่อรายการ`
      );
    }

    lines.push({
      round_item_id: item._id,
      product_id: product._id,
      product_snapshot: {
        product_name_th: product.product_name_th,
        product_name_eng: product.product_name_eng,
      },
      quantity,
      unit_price,
      total_price: round2(unit_price * quantity),
      special_request: raw.special_request?.trim() || null,
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.total_price, 0));

  // ── ค่าส่ง (server คิดเอง) ──
  let delivery_fee = 0;
  if (input.order_type === "delivery") {
    delivery_fee = deliveryService.calcDeliveryFee({
      province: delivery_address?.province ?? null,
      subtotal,
    }).fee;
  }

  // ── ส่วนลด (เฉพาะแอดมินกรอกมือ) ──
  const discount_amount = opts.allowManualDiscount
    ? Math.max(0, Number(input.discount_amount) || 0)
    : 0;
  if (discount_amount > subtotal + delivery_fee) {
    throw badRequest("ส่วนลดมากกว่ายอดที่ต้องชำระ");
  }
  const total_amount = round2(subtotal - discount_amount + delivery_fee);

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
          preorder_no: randomPreorderNo(),
          user_id: userId,
          round_id: round._id,
          order_type: input.order_type,
          delivery_address,
          subtotal,
          discount_amount,
          delivery_fee,
          total_amount,
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
    return getPreorderById(String(preorder._id));
  } catch (err) {
    await saga.rollback();
    throw err;
  }
}

// ── READ ─────────────────────────────────────────────────────
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

  return { items, meta: buildMeta(total, query.pagination) };
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
  return { ...preorder, items };
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
  return { ...preorder, items };
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
  if (current === next) return getPreorderById(id);
  if (!NEXT_STATUS[current].includes(next)) {
    throw conflict(`เปลี่ยนสถานะจาก "${current}" เป็น "${next}" ไม่ได้`);
  }

  if (next === "cancelled") {
    const items = await preorderItemModel
      .find({ preorder_id: preorder._id, deleted_at: null })
      .lean<any[]>();
    for (const it of items) {
      await preorderRoundService
        .releaseQty(String(it.round_item_id), it.quantity)
        .catch(() => undefined);
    }
    preorder.cancelled_at = new Date();
    if (opts.cancelled_by) {
      assertObjectId(opts.cancelled_by, "cancelled_by");
      preorder.cancelled_by = opts.cancelled_by;
    }
    preorder.cancelled_reason = opts.cancelled_reason ?? null;
  }

  preorder.order_status = next;
  await preorder.save();
  return getPreorderById(id);
}

export async function cancelPreorder(
  id: string,
  opts: { cancelled_by?: string; cancelled_reason?: string } = {}
) {
  return updatePreorderStatus(id, "cancelled", opts);
}

// ── payment status (เรียกจาก paymentService ภายหลัง) ────────
export async function setPaymentStatus(
  preorderId: string,
  status: PaymentStatus,
  paymentId?: string
) {
  await dbConnect();
  assertObjectId(preorderId, "preorder_id");
  if (!PAYMENT_STATUSES.includes(status)) {
    throw badRequest(`payment_status ต้องเป็นหนึ่งใน: ${PAYMENT_STATUSES.join(", ")}`);
  }
  const set: Record<string, any> = { payment_status: status };
  if (paymentId) set.payment_id = paymentId;

  const preorder = await preorderModel
    .findOneAndUpdate({ _id: preorderId, deleted_at: null }, { $set: set }, { new: true })
    .lean<any>();
  if (!preorder) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");

  if (status === "paid" && preorder.order_status === "pending") {
    await preorderModel.updateOne({ _id: preorderId }, { $set: { order_status: "confirmed" } });
  }
  return preorder;
}

// ── DELETE (soft) ───────────────────────────────────────────
export async function deletePreorder(id: string) {
  await dbConnect();
  assertObjectId(id);
  const preorder = await preorderModel.findOne({ _id: id, deleted_at: null });
  if (!preorder) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ หรือถูกลบไปแล้ว");
  if (!["completed", "cancelled"].includes(preorder.order_status)) {
    throw conflict("ลบได้เฉพาะพรีออเดอร์ที่เสร็จสิ้นหรือถูกยกเลิกแล้วเท่านั้น");
  }
  preorder.deleted_at = new Date();
  await preorder.save();
  await preorderItemModel.updateMany(
    { preorder_id: preorder._id, deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  return { deleted: true, _id: preorder._id };
}
