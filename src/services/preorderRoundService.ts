/**
 * preorderRoundService — รอบพรีออเดอร์ (PreorderRounds + PreorderRoundItems)
 *
 * รอบพรีออเดอร์ = ช่วงเวลาเปิดรับสั่งล่วงหน้าสำหรับสินค้าพรีออเดอร์ (is_preorder: true)
 *   open_date..close_date = ช่วงเปิดรับ ; pickup_date = วันนัดรับ / เริ่มจัดส่ง
 *
 * round_status (state machine):
 *   scheduled → open → closed          (เดินหน้าตามลำดับ) · closed → open (ยังไม่มีใบสั่งผลิต)
 *   scheduled | open → cancelled       (ยกเลิกรอบ)
 *   เปิด/ปิดอัตโนมัติตามเวลาผ่าน cron (preorderRoundLifecycleService.runRoundScheduler) หรือแอดมินกดเอง ·
 *   ปิดรอบ → ยกเลิกคนไม่จ่าย + สร้างใบสั่งผลิต (onRoundClosed) · ตอนลูกค้าสั่งเช็ค assertRoundOrderable() อีกชั้น
 *
 * PreorderRoundItems = สินค้าพรีออเดอร์ที่เปิดขายในรอบ + เพดานจำนวนรวม (max_qty_total) + ยอดจองปัจจุบัน (current_qty)
 *   commitQty/releaseQty ใช้ $inc แบบมีเงื่อนไข กันจองเกินโควตา (best-effort ไม่มี transaction)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import { restoreDoc } from "../lib/crudService";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import productionOrderModel from "../models/productionOrderModel";
import productModel from "../models/productModel";
import userModel from "../models/userModel";
import type { z } from "zod";
import type { updateRoundBody, updateRoundItemBody } from "../schemas/preorderRound";
import { toSatang, toBahtFields } from "../lib/money";
import { isPreorderProduct } from "../lib/productCode";
import { customerMessages, customerWeb, notifyCustomerLater } from "./customerNotifyService";

/* eslint-disable @typescript-eslint/no-explicit-any */

type UpdateRoundInput = z.infer<typeof updateRoundBody>;
type UpdateRoundItemInput = z.infer<typeof updateRoundItemBody>;

export const ROUND_STATUSES = ["scheduled", "open", "closed", "cancelled"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

// state machine: สถานะปัจจุบัน → สถานะถัดไปที่อนุญาต
const NEXT_ROUND_STATUS: Record<RoundStatus, RoundStatus[]> = {
  scheduled: ["open", "cancelled"],
  open: ["closed", "cancelled"],
  // เปิดกลับได้ถ้ายังไม่มีใบสั่งผลิต (docs/preorder-round-flow.md ประเด็น 8) — ตรวจเพิ่มใน updateRoundStatus
  closed: ["open"],
  cancelled: [],
};

const PRODUCT_SELECT =
  "product_name_th product_name_eng product_price sale_price product_img is_preorder preorder_config";

// BACKLOG §3.11 เฟส 5b — price_override เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
// ต้องแปลง "ซ้อน" เข้าไปในผลลัพธ์ populate (product_id.product_price/sale_price) ด้วย เพราะ populate
// ไม่เรียกผ่าน productService.presentProduct() เลย (เหมือน componentService/recipeService.
// getExpanded() ในเฟส 4) — ใช้กับทั้ง listRoundItems()/getRoundDetail() (current_price คำนวณจาก
// สตางค์ล้วนแล้วแปลงเป็นบาทตรงนี้ทีเดียว)
function presentRoundItem(it: Record<string, any>): Record<string, any> {
  const presented = toBahtFields(it, ["price_override", "current_price"] as const);
  return {
    ...presented,
    product_id:
      presented.product_id && typeof presented.product_id === "object"
        ? toBahtFields(presented.product_id, ["product_price", "sale_price"] as const)
        : presented.product_id,
  };
}

// ── Types ────────────────────────────────────────────────────
export interface RoundItemInput {
  product_id: string;
  price_override?: number | null;
  min_order_qty?: number;
  max_qty_total: number;
  is_active?: boolean;
}

export interface CreateRoundInput {
  round_name: string;
  open_date: string | Date;
  close_date: string | Date;
  pickup_date: string | Date;
  round_status?: RoundStatus;
  /** สร้างรายการสินค้าในรอบไปพร้อมกันได้เลย (ไม่บังคับ) */
  items?: RoundItemInput[];
}

export interface ListRoundQuery {
  pagination: Pagination;
  round_status?: RoundStatus;
  search?: string;
  /** เฉพาะรอบที่ยัง "รับสั่งได้หรือกำลังจะมา" (scheduled/open และ close_date ยังไม่ผ่าน) — ใช้ฝั่ง catalog */
  upcomingOnly?: boolean;
  includeDeleted?: boolean;
  sort?: Record<string, 1 | -1>;
}

// ── helpers ──────────────────────────────────────────────────
function toDate(v: unknown, field: string): Date {
  const d = new Date(v as any);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} ไม่ใช่วันที่ที่ถูกต้อง`);
  return d;
}

function assertDateOrder(open: Date, close: Date, pickup: Date): void {
  if (!(open.getTime() < close.getTime())) {
    throw badRequest("open_date ต้องมาก่อน close_date");
  }
  if (pickup.getTime() < close.getTime()) {
    throw badRequest("pickup_date ต้องไม่มาก่อน close_date");
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * lead_time_days ของสินค้า = จำนวนวันที่ต้องใช้ผลิตหลังปิดรับ (docs/preorder-round-flow.md ปัญหา 2 — เดิมไม่ถูกใช้)
 * บังคับ: pickup_date − close_date ≥ lead_time_days ของทุกสินค้าในรอบ
 * ตรวจตอนใส่สินค้าเข้ารอบ (createRound / addRoundItem) และตอนเลื่อน close/pickup (updateRound)
 */
function assertLeadTime(
  closeDate: Date,
  pickupDate: Date,
  products: Array<{ product_name_th?: string; preorder_config?: { lead_time_days?: number } | null }>
): void {
  const gapDays = (new Date(pickupDate).getTime() - new Date(closeDate).getTime()) / DAY_MS;
  for (const p of products) {
    const lead = p.preorder_config?.lead_time_days;
    if (lead != null && gapDays < lead) {
      throw badRequest(
        `"${p.product_name_th ?? "สินค้า"}" ต้องใช้เวลาผลิต ${lead} วันหลังปิดรับ ` +
          `แต่รอบนี้ปิดรับถึงวันรับห่างกัน ${Math.floor(gapDays * 10) / 10} วัน — เลื่อนวันรับหรือปิดรับให้เร็วขึ้น`
      );
    }
  }
}

function assertMaxQty(n: unknown): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) throw badRequest("max_qty_total ต้องเป็นจำนวนเต็มตั้งแต่ 1");
  return v;
}

// ── CREATE ───────────────────────────────────────────────────
export async function createRound(input: CreateRoundInput, createdBy: string) {
  await dbConnect();
  await assertRefExists(userModel, createdBy, "ผู้สร้างรอบ", "created_by");

  const name = (input.round_name ?? "").trim();
  if (!name) throw badRequest("กรุณาระบุ round_name");

  const open_date = toDate(input.open_date, "open_date");
  const close_date = toDate(input.close_date, "close_date");
  const pickup_date = toDate(input.pickup_date, "pickup_date");
  assertDateOrder(open_date, close_date, pickup_date);

  const round_status: RoundStatus = input.round_status ?? (open_date.getTime() > Date.now() ? "scheduled" : "open");
  if (!ROUND_STATUSES.includes(round_status)) {
    throw badRequest(`round_status ต้องเป็นหนึ่งใน: ${ROUND_STATUSES.join(", ")}`);
  }

  // ตรวจ items ก่อนสร้างรอบ (กันสร้างรอบค้างโดยไม่มีสินค้า)
  const items = input.items ?? [];
  const resolvedItems: Array<{
    product_id: any;
    price_override: number | null;
    min_order_qty: number;
    max_qty_total: number;
    is_active: boolean;
  }> = [];
  if (items.length) {
    const seen = new Set<string>();
    for (const it of items) {
      assertObjectId(it.product_id, "items[].product_id");
      if (seen.has(String(it.product_id))) {
        throw badRequest("มี product_id ซ้ำในรายการสินค้าของรอบ");
      }
      seen.add(String(it.product_id));
      const product = await productModel
        .findOne({ _id: it.product_id, deleted_at: null })
        .select("is_preorder product_name_th preorder_config")
        .lean<any>();
      if (!product) throw notFound(`ไม่พบสินค้า ${it.product_id}`);
      if (!isPreorderProduct(product)) {
        throw badRequest(`สินค้า "${product.product_name_th}" ไม่ใช่สินค้าพรีออเดอร์ (is_preorder ต้องเป็น true)`);
      }
      assertLeadTime(close_date, pickup_date, [product]);
      resolvedItems.push({
        product_id: product._id,
        // BACKLOG §3.11 เฟส 5b — price_override เป็นบาทจาก request เสมอ (API contract) แปลงเป็น
        // สตางค์ก่อนเก็บ (DB เป็นสตางค์แล้ว ผูก fallback chain เดียวกับ product.sale_price/
        // product_price ใน getOrderableRoundItem()/getRoundDetail() ด้านล่าง)
        price_override:
          it.price_override != null ? toSatang(Math.max(0, Number(it.price_override) || 0)) : null,
        min_order_qty: Math.max(1, Number(it.min_order_qty) || 1),
        max_qty_total: assertMaxQty(it.max_qty_total),
        is_active: it.is_active ?? true,
      });
    }
  }

  const round = await preorderRoundModel.create({
    created_by: createdBy,
    round_name: name,
    open_date,
    close_date,
    pickup_date,
    round_status,
  });

  if (resolvedItems.length) {
    await preorderRoundItemModel.insertMany(
      resolvedItems.map((it) => ({ ...it, round_id: round._id, current_qty: 0 }))
    );
  }

  return getRoundDetail(String(round._id));
}

// ── READ ─────────────────────────────────────────────────────
export async function listRounds(query: ListRoundQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (query.round_status) filter.round_status = query.round_status;
  if (query.search) filter.round_name = new RegExp(escapeRegExp(query.search.trim()), "i");
  if (query.upcomingOnly) {
    filter.round_status = { $in: ["scheduled", "open"] };
    filter.close_date = { $gte: new Date() };
  }

  const [items, total] = await Promise.all([
    preorderRoundModel
      .find(filter)
      .sort(query.sort ?? { open_date: 1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .lean(),
    preorderRoundModel.countDocuments(filter),
  ]);

  // แนบจำนวนรายการสินค้าในแต่ละรอบ
  const ids = items.map((r: any) => r._id);
  const counts = await preorderRoundItemModel.aggregate([
    { $match: { round_id: { $in: ids }, deleted_at: null } },
    { $group: { _id: "$round_id", item_count: { $sum: 1 } } },
  ]);
  const countByRound = new Map(counts.map((c: any) => [String(c._id), c.item_count]));

  return {
    items: items.map((r: any) => ({ ...r, item_count: countByRound.get(String(r._id)) ?? 0 })),
    meta: buildMeta(total, query.pagination),
  };
}

export async function getRoundById(id: string, opts: { includeDeleted?: boolean } = {}) {
  await dbConnect();
  assertObjectId(id);
  const filter: Record<string, any> = { _id: id };
  if (!opts.includeDeleted) filter.deleted_at = null;
  const round = await preorderRoundModel.findOne(filter).lean<any>();
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ");
  return round;
}

export async function getRoundDetail(
  id: string,
  opts: { includeDeleted?: boolean; activeItemsOnly?: boolean } = {}
) {
  await dbConnect();
  const round = await getRoundById(id, opts);

  const itemFilter: Record<string, any> = { round_id: round._id, deleted_at: null };
  if (opts.activeItemsOnly) itemFilter.is_active = true;

  const items = await preorderRoundItemModel
    .find(itemFilter)
    .populate("product_id", PRODUCT_SELECT)
    .sort({ created_at: 1 })
    .lean<any[]>();

  return {
    ...round,
    items: items.map((it) => {
      const product = it.product_id ?? {};
      // price_override/product.sale_price/product.product_price เป็นสตางค์ทั้งหมดแล้ว (เฟส 5b) —
      // current_price ที่คำนวณตรงนี้จึงเป็นสตางค์ไปด้วยโดยอัตโนมัติ แปลงเป็นบาทพร้อมกับ field อื่นใน
      // presentRoundItem() ทีเดียวด้านล่าง
      const base = it.price_override ?? product.sale_price ?? product.product_price ?? 0;
      return presentRoundItem({
        ...it,
        current_price: base,
        remaining_qty: Math.max(0, (it.max_qty_total ?? 0) - (it.current_qty ?? 0)),
      });
    }),
  };
}

// ── UPDATE (แก้ได้เฉพาะชื่อ + ช่วงเวลา) ──────────────────────
// "ต้องมีอย่างน้อย 1 ฟิลด์" / round_name ไม่ว่าง validate ที่ route ผ่าน schemas/preorderRound.ts แล้ว
export async function updateRound(id: string, input: UpdateRoundInput) {
  await dbConnect();
  assertObjectId(id);

  const round = await preorderRoundModel.findOne({ _id: id, deleted_at: null });
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ");
  if (round.round_status === "closed" || round.round_status === "cancelled") {
    throw conflict(`รอบสถานะ "${round.round_status}" แก้ไขรายละเอียดไม่ได้`);
  }

  const payload: Record<string, any> = { ...input };

  const open_date = payload.open_date !== undefined ? toDate(payload.open_date, "open_date") : round.open_date;
  const close_date = payload.close_date !== undefined ? toDate(payload.close_date, "close_date") : round.close_date;
  const pickup_date = payload.pickup_date !== undefined ? toDate(payload.pickup_date, "pickup_date") : round.pickup_date;
  assertDateOrder(open_date, close_date, pickup_date);
  if (payload.open_date !== undefined) payload.open_date = open_date;
  if (payload.close_date !== undefined) payload.close_date = close_date;
  if (payload.pickup_date !== undefined) payload.pickup_date = pickup_date;

  // เลื่อน close/pickup → ช่วงผลิตต้องยังพอสำหรับทุกสินค้าในรอบ (lead_time_days)
  if (payload.close_date !== undefined || payload.pickup_date !== undefined) {
    const itemProductIds = await preorderRoundItemModel
      .find({ round_id: round._id, deleted_at: null })
      .distinct("product_id");
    const products = itemProductIds.length
      ? await productModel.find({ _id: { $in: itemProductIds } }).select("product_name_th preorder_config").lean<any[]>()
      : [];
    assertLeadTime(close_date, pickup_date, products);
  }

  const pickupChanged =
    payload.pickup_date !== undefined && new Date(round.pickup_date).getTime() !== pickup_date.getTime();

  Object.assign(round, payload);
  await round.save();

  if (pickupChanged) await syncPickupDateChange(round._id, pickup_date);
  if (payload.close_date !== undefined) await recomputePaymentDueDates(round._id, close_date);
  return getRoundDetail(id);
}

/**
 * วันรับของรอบเปลี่ยน (docs/preorder-round-flow.md ปัญหา 6) — เดิมไม่มีใครรู้:
 *   - preorderItems.pickup_date เป็นสแนปช็อตตอนสั่ง → อัปเดตตามให้ตรงรอบ (เฉพาะพรีออเดอร์ที่ยังค้าง)
 *   - แจ้งลูกค้าทาง LINE ทีละพรีออเดอร์ (ผ่านกลไกโควตา — ส่งไม่ถึงไม่ทำให้การแก้รอบล้ม)
 *   - ล้าง pickup_reminded_at ให้ระบบเตือนก่อนวันรับ (preorderReminderService) เตือนใหม่ตามวันใหม่
 */
/**
 * เลื่อน close_date → คำนวณกำหนดชำระใหม่ของรายการที่ยังไม่จ่ายในรอบ = min(สั่ง + N ชม., ปิดรอบใหม่)
 * (docs/preorder-round-flow.md ประเด็น 3 — เลื่อนปิดออกไปแล้วคนที่ถูกจำกัดด้วยเวลาปิดเดิมได้เวลาเพิ่ม)
 */
async function recomputePaymentDueDates(roundId: unknown, closeDate: Date): Promise<void> {
  const { computePaymentDueAt } = await import("./preorderRoundLifecycleService");
  const unpaid = await preorderModel
    .find({
      round_id: roundId,
      deleted_at: null,
      order_status: { $nin: ["cancelled", "completed"] },
      payment_status: { $in: ["pending", "failed"] },
    })
    .select("_id created_at")
    .lean<Array<{ _id: unknown; created_at: Date }>>();
  for (const p of unpaid) {
    await preorderModel.updateOne({ _id: p._id }, { $set: { payment_due_at: computePaymentDueAt(p.created_at, closeDate) } });
  }
}

async function syncPickupDateChange(roundId: unknown, pickupDate: Date): Promise<void> {
  const active = await preorderModel
    .find({ round_id: roundId, deleted_at: null, order_status: { $nin: ["cancelled", "completed"] } })
    .select("_id preorder_no user_id order_type")
    .lean<Array<{ _id: unknown; preorder_no: string; user_id: unknown; order_type: string }>>();
  if (active.length === 0) return;

  const ids = active.map((p) => p._id);
  await preorderItemModel.updateMany({ preorder_id: { $in: ids }, deleted_at: null }, { $set: { pickup_date: pickupDate } });
  await preorderModel.updateMany({ _id: { $in: ids } }, { $set: { pickup_reminded_at: null } });

  for (const p of active) {
    const text = customerMessages.pickupDateChanged(p.preorder_no, pickupDate, p.order_type);
    notifyCustomerLater(p.user_id, text, customerWeb.fromLineText("preorder", p._id, p.preorder_no, text, "warning"));
  }
}

export interface RoundCancelCascade {
  /** พรีออเดอร์ที่ยกเลิกสำเร็จ (คืนโควตา + คืนเงินอัตโนมัติถ้าจ่ายแล้ว + แจ้งลูกค้าทาง LINE — ผ่าน cancelPreorder) */
  cancelled: string[];
  /** ยกเลิกไม่สำเร็จ — ต้องจัดการมือ (รอบถูกยกเลิกไปแล้ว ลูกค้าสั่งเพิ่มไม่ได้) */
  failed: Array<{ preorder_no: string; error: string }>;
}

/**
 * ยกเลิกพรีออเดอร์ที่ยังค้างทุกรายการในรอบที่ถูกยกเลิก (docs/preorder-round-flow.md ปัญหา 1)
 * ทีละรายการผ่าน preorderService.cancelPreorder — ได้ cleanup ครบเหมือนแอดมินกดยกเลิกเอง
 * รายการที่พังไม่หยุดรายการอื่น (best-effort) · dynamic import กัน circular (preorderService import ไฟล์นี้)
 */
async function cancelPreordersOfRound(
  roundId: unknown,
  roundName: string,
  cancelledBy?: string
): Promise<RoundCancelCascade> {
  const { cancelPreorder } = await import("./preorderService");
  const active = await preorderModel
    .find({ round_id: roundId, deleted_at: null, order_status: { $nin: ["cancelled", "completed"] } })
    .select("_id preorder_no")
    .lean<Array<{ _id: unknown; preorder_no: string }>>();

  const result: RoundCancelCascade = { cancelled: [], failed: [] };
  for (const p of active) {
    try {
      await cancelPreorder(String(p._id), {
        cancelled_by: cancelledBy,
        cancelled_reason: `ร้านยกเลิกรอบพรีออเดอร์ "${roundName}"`,
      });
      result.cancelled.push(p.preorder_no);
    } catch (err) {
      result.failed.push({ preorder_no: p.preorder_no, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

// ── UPDATE STATUS (state machine) ───────────────────────────
/**
 * `cancelled` → ยกเลิกพรีออเดอร์ที่ค้างในรอบให้ด้วย (cancelPreordersOfRound) — ต้องส่ง opts.by (ผู้กด) เพื่อให้
 * คืนเงินอัตโนมัติได้ (registerAutoRefundOnCancel ต้องมีผู้ยืนยันการคืนเงิน)
 */
export async function updateRoundStatus(
  id: string,
  next: RoundStatus,
  opts: { by?: string; close_date?: string | Date } = {}
) {
  await dbConnect();
  assertObjectId(id);
  if (!ROUND_STATUSES.includes(next)) {
    throw badRequest(`round_status ต้องเป็นหนึ่งใน: ${ROUND_STATUSES.join(", ")}`);
  }

  const round = await preorderRoundModel.findOne({ _id: id, deleted_at: null });
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ");

  const current = round.round_status as RoundStatus;
  if (current === next) return getRoundDetail(id);
  if (!NEXT_ROUND_STATUS[current].includes(next)) {
    throw conflict(`เปลี่ยนสถานะรอบจาก "${current}" เป็น "${next}" ไม่ได้`);
  }

  // ประเด็น 8 — เปิดรอบที่ปิดแล้วกลับ: ต้องยังไม่มีใบสั่งผลิต และ close_date ต้องอยู่ในอนาคต (ไม่งั้นตัวตั้งเวลาปิดซ้ำทันที)
  // รอบที่ปิดแล้วแก้วันที่ผ่าน updateRound ไม่ได้ → รับ close_date ใหม่มาพร้อมคำสั่งเปิดกลับได้เลย
  if (current === "closed" && next === "open") {
    const production = await productionOrderModel.countDocuments({
      round_id: round._id,
      deleted_at: null,
      production_status: { $ne: "cancelled" },
    });
    if (production > 0) {
      throw conflict("รอบนี้มีใบสั่งผลิตแล้ว เปิดกลับไม่ได้ (ยกเลิกใบสั่งผลิตก่อนถ้าจำเป็นต้องเปิดรับเพิ่ม)");
    }
    if (opts.close_date !== undefined) {
      const close = toDate(opts.close_date, "close_date");
      assertDateOrder(round.open_date, close, round.pickup_date);
      round.close_date = close;
    }
    if (new Date(round.close_date).getTime() <= Date.now()) {
      throw conflict("close_date ผ่านไปแล้ว — ส่ง close_date ใหม่ (ในอนาคต) มาพร้อมคำสั่งเปิดรอบกลับ");
    }
  }

  // เปลี่ยนสถานะรอบก่อน — ลูกค้าสั่งเพิ่มไม่ได้ทันที (assertRoundOrderable) ระหว่างไล่ยกเลิกพรีออเดอร์ข้างล่าง
  round.round_status = next;
  await round.save();

  // ปิดรอบ → ยกเลิกคนไม่จ่าย + สร้างใบสั่งผลิตอัตโนมัติ (docs/preorder-round-flow.md §6) — dynamic import กัน circular
  if (next === "closed") {
    const { onRoundClosed } = await import("./preorderRoundLifecycleService");
    return { ...(await getRoundDetail(id)), close_result: await onRoundClosed(round._id) };
  }

  if (next === "cancelled") {
    const cascade = await cancelPreordersOfRound(round._id, round.round_name, opts.by);
    return { ...(await getRoundDetail(id)), cancel_cascade: cascade };
  }
  return getRoundDetail(id);
}

// ── DELETE / RESTORE (soft) ────────────────────────────────
export async function deleteRound(id: string) {
  await dbConnect();
  assertObjectId(id);
  const round = await preorderRoundModel.findOne({ _id: id, deleted_at: null });
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ หรือถูกลบไปแล้ว");

  const activePreorders = await preorderModel.countDocuments({
    round_id: round._id,
    deleted_at: null,
    order_status: { $nin: ["cancelled", "completed"] },
  });
  if (activePreorders > 0) {
    throw conflict(`ยังมีพรีออเดอร์ที่ค้างอยู่ในรอบนี้ ${activePreorders} รายการ — จัดการให้เสร็จก่อนจึงจะลบรอบได้`);
  }

  // ใช้เวลาเดียวกันทั้งรอบและรายการ — restoreRound ใช้จับคู่ว่ารายการไหนถูกลบ "พร้อมรอบ" (ต่างจากที่ลบเองทีละตัวก่อนหน้า)
  const now = new Date();
  round.deleted_at = now;
  await round.save();
  await preorderRoundItemModel.updateMany(
    { round_id: round._id, deleted_at: null },
    { $set: { deleted_at: now } }
  );
  return { deleted: true, _id: round._id };
}

/** ข้อมูลที่ลบก่อนแก้ (รอบกับรายการได้ deleted_at คนละ new Date() ห่างกันไม่กี่ ms) — ยอมให้คลาดได้เท่านี้ */
const CASCADE_DELETE_TOLERANCE_MS = 5_000;

/**
 * กู้คืนรอบ + รายการสินค้าที่ถูกลบไปพร้อมรอบ (docs/preorder-round-flow.md ปัญหา 4 — เดิมกู้แค่รอบ ได้รอบเปล่า)
 * รายการที่แอดมินลบเองทีละตัวก่อนลบรอบ (deleted_at ต่างจากรอบ) ไม่ถูกกู้ตาม
 */
export async function restoreRound(id: string) {
  await dbConnect();
  assertObjectId(id);
  const round = await preorderRoundModel.findOne({ _id: id, deleted_at: { $ne: null } });
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ถูกลบไว้");

  const deletedAt = new Date(round.deleted_at).getTime();
  const itemRes = await preorderRoundItemModel.updateMany(
    {
      round_id: round._id,
      // ข้อมูลเก่า: deleteRound เดิมตั้ง deleted_at ของรอบก่อน แล้วค่อยของรายการ → รายการที่ลบ "พร้อมรอบ" มีเวลา
      // เท่ากับหรือหลังรอบเสมอ · รายการที่แอดมินลบเองก่อนหน้า (แม้แค่ไม่กี่ ms) อยู่ก่อนเวลารอบ → ไม่ถูกกู้
      deleted_at: { $gte: new Date(deletedAt), $lte: new Date(deletedAt + CASCADE_DELETE_TOLERANCE_MS) },
    },
    { $set: { deleted_at: null } }
  );
  const restored = await restoreDoc(preorderRoundModel, id, { notFoundMsg: "ไม่พบรอบพรีออเดอร์ที่ถูกลบไว้" });
  return { ...(restored as Record<string, unknown>), restored_items: itemRes.modifiedCount };
}

// ── ROUND ITEMS ────────────────────────────────────────────
export async function listRoundItems(
  roundId: string,
  opts: { activeOnly?: boolean; includeDeleted?: boolean } = {}
) {
  await dbConnect();
  assertObjectId(roundId, "round_id");
  const filter: Record<string, any> = { round_id: roundId };
  if (!opts.includeDeleted) filter.deleted_at = null;
  if (opts.activeOnly) filter.is_active = true;
  const items = await preorderRoundItemModel
    .find(filter)
    .populate("product_id", PRODUCT_SELECT)
    .sort({ created_at: 1 })
    .lean();
  return items.map(presentRoundItem);
}

export async function addRoundItem(roundId: string, input: RoundItemInput) {
  await dbConnect();
  assertObjectId(roundId, "round_id");

  const round = await preorderRoundModel.findOne({ _id: roundId, deleted_at: null }).lean<any>();
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ");
  if (round.round_status === "closed" || round.round_status === "cancelled") {
    throw conflict(`รอบสถานะ "${round.round_status}" เพิ่มสินค้าไม่ได้`);
  }

  assertObjectId(input.product_id, "product_id");
  const product = await productModel
    .findOne({ _id: input.product_id, deleted_at: null })
    .select("is_preorder product_name_th preorder_config")
    .lean<any>();
  if (!product) throw notFound("ไม่พบสินค้าที่ระบุ");
  if (!isPreorderProduct(product)) {
    throw badRequest(`สินค้า "${product.product_name_th}" ไม่ใช่สินค้าพรีออเดอร์`);
  }
  assertLeadTime(round.close_date, round.pickup_date, [product]);

  try {
    const doc = await preorderRoundItemModel.create({
      round_id: roundId,
      product_id: input.product_id,
      price_override:
        input.price_override != null ? toSatang(Math.max(0, Number(input.price_override) || 0)) : null,
      min_order_qty: Math.max(1, Number(input.min_order_qty) || 1),
      max_qty_total: assertMaxQty(input.max_qty_total),
      current_qty: 0,
      is_active: input.is_active ?? true,
    });
    return presentRoundItem(doc.toObject());
  } catch (err: any) {
    if (err?.code === 11000) {
      throw conflict("สินค้านี้อยู่ในรอบนี้แล้ว (ใช้การแก้ไขแทน)");
    }
    throw err;
  }
}

// "ต้องมีอย่างน้อย 1 ฟิลด์" validate ที่ route ผ่าน schemas/preorderRound.ts updateRoundItemBody แล้ว
export async function updateRoundItem(itemId: string, input: UpdateRoundItemInput) {
  await dbConnect();
  assertObjectId(itemId, "id");

  const item = await preorderRoundItemModel.findOne({ _id: itemId, deleted_at: null });
  if (!item) throw notFound("ไม่พบรายการสินค้าในรอบที่ระบุ");

  // เหมือน addRoundItem — รอบที่ปิด/ยกเลิกแล้วแก้รายการไม่ได้ (docs/preorder-round-flow.md ปัญหา 7)
  const round = await preorderRoundModel.findOne({ _id: item.round_id }).select("round_status").lean<any>();
  if (round && (round.round_status === "closed" || round.round_status === "cancelled")) {
    throw conflict(`รอบสถานะ "${round.round_status}" แก้ไขรายการสินค้าไม่ได้`);
  }

  const payload: Record<string, any> = { ...input };
  if (payload.price_override !== undefined && payload.price_override !== null) {
    payload.price_override = toSatang(Math.max(0, Number(payload.price_override) || 0));
  }
  if (payload.min_order_qty !== undefined) {
    payload.min_order_qty = Math.max(1, Number(payload.min_order_qty) || 1);
  }
  if (payload.max_qty_total !== undefined) {
    payload.max_qty_total = assertMaxQty(payload.max_qty_total);
    if (payload.max_qty_total < (item.current_qty ?? 0)) {
      throw conflict(`max_qty_total (${payload.max_qty_total}) น้อยกว่ายอดที่จองไปแล้ว (${item.current_qty})`);
    }
  }

  Object.assign(item, payload);
  await item.save();
  return presentRoundItem(item.toObject());
}

export async function removeRoundItem(itemId: string) {
  await dbConnect();
  assertObjectId(itemId, "id");
  const item = await preorderRoundItemModel.findOne({ _id: itemId, deleted_at: null });
  if (!item) throw notFound("ไม่พบรายการสินค้าในรอบที่ระบุ หรือถูกลบไปแล้ว");
  if ((item.current_qty ?? 0) > 0) {
    throw conflict("รายการนี้มีการจองแล้ว ปิดการขายด้วย is_active=false แทนการลบ");
  }
  item.deleted_at = new Date();
  await item.save();
  return { deleted: true, _id: item._id };
}

// ── helpers สำหรับ preorderService ─────────────────────────
/** คืน round doc ถ้ารอบ "เปิดรับสั่งได้ตอนนี้" ไม่งั้นโยน error */
export async function assertRoundOrderable(roundId: string) {
  await dbConnect();
  assertObjectId(roundId, "round_id");
  const round = await preorderRoundModel.findOne({ _id: roundId, deleted_at: null }).lean<any>();
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ");

  if (round.round_status !== "open") {
    throw conflict(
      round.round_status === "scheduled"
        ? "รอบนี้ยังไม่เปิดรับพรีออเดอร์"
        : `รอบนี้ปิดรับพรีออเดอร์แล้ว (สถานะ "${round.round_status}")`
    );
  }
  const now = Date.now();
  if (new Date(round.open_date).getTime() > now) throw conflict("ยังไม่ถึงวันเปิดรับของรอบนี้");
  if (new Date(round.close_date).getTime() < now) throw conflict("เลยกำหนดปิดรับของรอบนี้แล้ว");
  return round;
}

/**
 * ดึง round item + product สำหรับคิดราคาตอนสร้างพรีออเดอร์ (batch)
 * BACKLOG §3.11 เฟส 5b — ฟังก์ชันนี้เป็น "internal only" ไม่เคย expose ผ่าน API ตรง ๆ (ใช้แค่ภายใน
 * preorderService ตอนสร้างพรีออเดอร์) `unit_price` ที่คืนจึงตั้งใจเป็น**สตางค์**ตรง ๆ (ไม่ผ่าน
 * presentRoundItem()) เพราะ item.price_override/product.sale_price/product.product_price เป็น
 * สตางค์ทั้งหมดแล้ว — ผู้เรียก (preorderService) ก็ไม่ต้องแปลงอะไรเพิ่มเพราะรับค่ามาใส่
 * preorderItem.unit_price ตรง ๆ (satang เหมือนกัน) — เหมือน recipeService.getUnitCostByProduct()
 * ในเฟส 4 เป๊ะ
 *
 * BACKLOG2 §2 — เดิมชื่อ getOrderableRoundItem() (เอกพจน์) รับ roundItemId เดียว ให้
 * createPreorder() เรียกวน await ทีละรายการ (N รายการ = query ~2N ครั้งทยอย) เปลี่ยนเป็น batch
 * ด้วย $in ครั้งเดียวต่อ collection (preorderRoundItem/product) แล้ว join ใน memory เหมือน
 * orderService.resolveLines() ที่แก้ไว้แล้วใน §3.18 — คืนผลลัพธ์เรียงตามลำดับ `roundItemIds` เดิม
 * เป๊ะ (รายการไหนไม่พบ/ไม่ active จะ throw ตอน join ตามลำดับนั้น เหมือนพฤติกรรมเดิมทุกประการ)
 */
export async function getOrderableRoundItems(roundItemIds: string[], roundId: string) {
  await dbConnect();
  roundItemIds.forEach((id) => assertObjectId(id, "round_item_id"));

  const items = await preorderRoundItemModel
    .find({ _id: { $in: roundItemIds }, round_id: roundId, deleted_at: null })
    .lean<any[]>();
  const itemById = new Map(items.map((it) => [String(it._id), it]));

  const productIds = [...new Set(items.map((it) => String(it.product_id)))];
  const products = productIds.length
    ? await productModel
        .find({ _id: { $in: productIds }, deleted_at: null })
        .select("product_name_th product_name_eng product_price sale_price is_preorder preorder_config")
        .lean<any[]>()
    : [];
  const productById = new Map(products.map((p) => [String(p._id), p]));

  return roundItemIds.map((roundItemId) => {
    const item = itemById.get(String(roundItemId));
    if (!item) throw badRequest("ไม่พบรายการสินค้านี้ในรอบที่เลือก");
    if (!item.is_active) throw conflict("รายการสินค้านี้ปิดการขายในรอบนี้แล้ว");

    const product = productById.get(String(item.product_id));
    if (!product) throw notFound("ไม่พบสินค้าของรายการนี้");

    const unit_price = item.price_override ?? product.sale_price ?? product.product_price ?? 0;
    return { item, product, unit_price };
  });
}

/** จอง current_qty (กันเกิน max_qty_total ด้วย $expr) */
export async function commitQty(roundItemId: string, qty: number): Promise<void> {
  await dbConnect();
  const res = await preorderRoundItemModel.updateOne(
    {
      _id: roundItemId,
      deleted_at: null,
      is_active: true,
      $expr: { $lte: [{ $add: ["$current_qty", qty] }, "$max_qty_total"] },
    },
    { $inc: { current_qty: qty } }
  );
  if (res.modifiedCount !== 1) {
    throw conflict("จำนวนที่สั่งเกินโควตาที่เหลือของรายการนี้ในรอบ");
  }
}

/** คืน current_qty ที่เคยจองไว้ (ตอนยกเลิก) — best-effort */
export async function releaseQty(roundItemId: string, qty: number): Promise<void> {
  await dbConnect();
  await preorderRoundItemModel
    .updateOne({ _id: roundItemId, current_qty: { $gte: qty } }, { $inc: { current_qty: -qty } })
    .catch(() => undefined);
}
