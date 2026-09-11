/**
 * preorderRoundService — รอบพรีออเดอร์ (PreorderRounds + PreorderRoundItems)
 *
 * รอบพรีออเดอร์ = ช่วงเวลาเปิดรับสั่งล่วงหน้าสำหรับสินค้า product_type = "preorder"
 *   open_date..close_date = ช่วงเปิดรับ ; pickup_date = วันนัดรับ / เริ่มจัดส่ง
 *
 * round_status (state machine):
 *   scheduled → open → closed          (เดินหน้าตามลำดับ)
 *   scheduled | open → cancelled       (ยกเลิกรอบ)
 *   ระบบไม่เลื่อนสถานะอัตโนมัติตามเวลา — แอดมินเป็นคนกด ส่วนตอนลูกค้าสั่งจะเช็ค isRoundOrderable() อีกชั้น
 *
 * PreorderRoundItems = สินค้าพรีออเดอร์ที่เปิดขายในรอบ + เพดานจำนวนรวม (max_qty_total) + ยอดจองปัจจุบัน (current_qty)
 *   commitQty/releaseQty ใช้ $inc แบบมีเงื่อนไข กันจองเกินโควตา (best-effort ไม่มี transaction)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId, pick } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import preorderModel from "../models/preorderModel";
import productModel from "../models/productModel";
import userModel from "../models/userModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ROUND_STATUSES = ["scheduled", "open", "closed", "cancelled"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

// state machine: สถานะปัจจุบัน → สถานะถัดไปที่อนุญาต
const NEXT_ROUND_STATUS: Record<RoundStatus, RoundStatus[]> = {
  scheduled: ["open", "cancelled"],
  open: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

const PRODUCT_SELECT =
  "product_name_th product_name_eng product_price sale_price product_img product_type preorder_config";

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
        .select("product_type product_name_th")
        .lean<any>();
      if (!product) throw notFound(`ไม่พบสินค้า ${it.product_id}`);
      if (product.product_type !== "preorder") {
        throw badRequest(`สินค้า "${product.product_name_th}" ไม่ใช่สินค้าพรีออเดอร์ (product_type ต้องเป็น "preorder")`);
      }
      resolvedItems.push({
        product_id: product._id,
        price_override: it.price_override != null ? Math.max(0, Number(it.price_override) || 0) : null,
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
      const base = it.price_override ?? product.sale_price ?? product.product_price ?? 0;
      return {
        ...it,
        current_price: base,
        remaining_qty: Math.max(0, (it.max_qty_total ?? 0) - (it.current_qty ?? 0)),
      };
    }),
  };
}

// ── UPDATE (แก้ได้เฉพาะชื่อ + ช่วงเวลา) ──────────────────────
export async function updateRound(id: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(id);

  const round = await preorderRoundModel.findOne({ _id: id, deleted_at: null });
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ");
  if (round.round_status === "closed" || round.round_status === "cancelled") {
    throw conflict(`รอบสถานะ "${round.round_status}" แก้ไขรายละเอียดไม่ได้`);
  }

  const payload = pick(input, ["round_name", "open_date", "close_date", "pickup_date"]);
  if (Object.keys(payload).length === 0) {
    throw badRequest("ไม่มีฟิลด์ที่อนุญาตให้แก้ไข (round_name/open_date/close_date/pickup_date)");
  }
  if (payload.round_name !== undefined) {
    payload.round_name = String(payload.round_name).trim();
    if (!payload.round_name) throw badRequest("round_name ห้ามว่าง");
  }

  const open_date = payload.open_date !== undefined ? toDate(payload.open_date, "open_date") : round.open_date;
  const close_date = payload.close_date !== undefined ? toDate(payload.close_date, "close_date") : round.close_date;
  const pickup_date = payload.pickup_date !== undefined ? toDate(payload.pickup_date, "pickup_date") : round.pickup_date;
  assertDateOrder(open_date, close_date, pickup_date);
  if (payload.open_date !== undefined) payload.open_date = open_date;
  if (payload.close_date !== undefined) payload.close_date = close_date;
  if (payload.pickup_date !== undefined) payload.pickup_date = pickup_date;

  Object.assign(round, payload);
  await round.save();
  return getRoundDetail(id);
}

// ── UPDATE STATUS (state machine) ───────────────────────────
export async function updateRoundStatus(id: string, next: RoundStatus) {
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

  round.round_status = next;
  await round.save();
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

  round.deleted_at = new Date();
  await round.save();
  await preorderRoundItemModel.updateMany(
    { round_id: round._id, deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  return { deleted: true, _id: round._id };
}

export async function restoreRound(id: string) {
  await dbConnect();
  assertObjectId(id);
  const round = await preorderRoundModel
    .findOneAndUpdate(
      { _id: id, deleted_at: { $ne: null } },
      { $set: { deleted_at: null } },
      { new: true }
    )
    .lean<any>();
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ถูกลบไว้");
  return round;
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
  return preorderRoundItemModel
    .find(filter)
    .populate("product_id", PRODUCT_SELECT)
    .sort({ created_at: 1 })
    .lean();
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
    .select("product_type product_name_th")
    .lean<any>();
  if (!product) throw notFound("ไม่พบสินค้าที่ระบุ");
  if (product.product_type !== "preorder") {
    throw badRequest(`สินค้า "${product.product_name_th}" ไม่ใช่สินค้าพรีออเดอร์`);
  }

  try {
    const doc = await preorderRoundItemModel.create({
      round_id: roundId,
      product_id: input.product_id,
      price_override: input.price_override != null ? Math.max(0, Number(input.price_override) || 0) : null,
      min_order_qty: Math.max(1, Number(input.min_order_qty) || 1),
      max_qty_total: assertMaxQty(input.max_qty_total),
      current_qty: 0,
      is_active: input.is_active ?? true,
    });
    return doc.toObject();
  } catch (err: any) {
    if (err?.code === 11000) {
      throw conflict("สินค้านี้อยู่ในรอบนี้แล้ว (ใช้การแก้ไขแทน)");
    }
    throw err;
  }
}

export async function updateRoundItem(itemId: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(itemId, "id");

  const item = await preorderRoundItemModel.findOne({ _id: itemId, deleted_at: null });
  if (!item) throw notFound("ไม่พบรายการสินค้าในรอบที่ระบุ");

  const payload = pick(input, ["price_override", "min_order_qty", "max_qty_total", "is_active"]);
  if (Object.keys(payload).length === 0) {
    throw badRequest("ไม่มีฟิลด์ที่อนุญาตให้แก้ไข (price_override/min_order_qty/max_qty_total/is_active)");
  }
  if (payload.price_override !== undefined && payload.price_override !== null) {
    payload.price_override = Math.max(0, Number(payload.price_override) || 0);
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
  return item.toObject();
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

/** ดึง round item + product สำหรับคิดราคาตอนสร้างพรีออเดอร์ */
export async function getOrderableRoundItem(roundItemId: string, roundId: string) {
  await dbConnect();
  assertObjectId(roundItemId, "round_item_id");
  const item = await preorderRoundItemModel
    .findOne({ _id: roundItemId, round_id: roundId, deleted_at: null })
    .lean<any>();
  if (!item) throw badRequest("ไม่พบรายการสินค้านี้ในรอบที่เลือก");
  if (!item.is_active) throw conflict("รายการสินค้านี้ปิดการขายในรอบนี้แล้ว");

  const product = await productModel
    .findOne({ _id: item.product_id, deleted_at: null })
    .select("product_name_th product_name_eng product_price sale_price product_type")
    .lean<any>();
  if (!product) throw notFound("ไม่พบสินค้าของรายการนี้");

  const unit_price = item.price_override ?? product.sale_price ?? product.product_price ?? 0;
  return { item, product, unit_price };
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
