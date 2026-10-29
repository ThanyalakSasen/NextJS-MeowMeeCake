/**
 * productLotService — ล็อตสินค้าที่ผลิตเสร็จ (ProductLots) · เลขล็อตพิมพ์เป็นบาร์โค้ดบนฉลาก
 *
 * สร้างตอนปิดงานผลิต (productionOrderService.completeProduction) 1 ล็อตต่อรายการผลิตที่ผลิตได้ > 0 ชิ้น
 *   - วันผลิตเริ่มต้น = production_date ของใบสั่งผลิต · วันหมดอายุเริ่มต้น = วันผลิต + products.shelf_life_days
 *   - หน้าปิดงานส่งวันผลิต/วันหมดอายุจริงต่อรายการมาแทนได้ (lots[]) — ตรวจก่อนปิดงานด้วย validateLotInputs
 *   - จำนวน = จำนวนเดียวกับที่เพิ่มสต็อกสินค้า (product_stock_added_qty) / ผลิตได้จริง / วางแผน
 *   - สินค้าพรีออเดอร์ก็มีล็อต (ฉลากวันผลิต/หมดอายุ) แต่ qty_remaining = null — ไม่มีสต็อก
 *   - สร้างรหัสประจำชิ้น (ProductLotPieces) 1..qty_produced พร้อมล็อต — ฉลากแต่ละดวงพิมพ์รหัสชิ้นของตัวเอง
 *
 * ยังไม่ตัด qty_remaining ตอนขาย (เฟส 2 — ตัดล็อตที่สแกนที่ POS / หมดอายุก่อนสำหรับออเดอร์เว็บ)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { bangkokDateString } from "../lib/datetime";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import { isPreorderProduct } from "../lib/productCode";
import productLotModel from "../models/productLotModel";
import productLotPieceModel from "../models/productLotPieceModel";
import productionItemModel from "../models/productionItemModel";
import productModel from "../models/productModel";
import { nextLotNo } from "./docNoService";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** วันผลิต/วันหมดอายุที่หน้าปิดงานกรอกมาต่อรายการผลิต ("YYYY-MM-DD" · ไม่ส่ง = ใช้ค่าเริ่มต้น · expiry null = ไม่มีวันหมดอายุ) */
export interface LotDateInput {
  item_id: string;
  produced_date?: string;
  expiry_date?: string | null;
}

/** expired = เลยวันหมดอายุแล้ว · expiring = หมดอายุภายใน EXPIRING_DAYS วัน (รวมวันนี้) · ok · none = ไม่มีวันหมดอายุ */
export type ExpiryState = "expired" | "expiring" | "ok" | "none";
export const EXPIRING_DAYS = 2;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest(`${field} ต้องเป็นวันที่รูปแบบ YYYY-MM-DD`);
  }
  return value;
}

/** "YYYY-MM-DD" + n วัน (นับเป็นวันปฏิทิน ไม่ขึ้นกับเขตเวลา) */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function expiryState(expiryDate: string | null | undefined, today: string = bangkokDateString()): ExpiryState {
  if (!expiryDate) return "none";
  if (expiryDate < today) return "expired";
  if (expiryDate <= addDays(today, EXPIRING_DAYS)) return "expiring";
  return "ok";
}

/** ตรวจ lots[] จากหน้าปิดงาน (ก่อนปิดงานจริง — กันปิดงานแล้วค่อยมาล้มตอนสร้างล็อต) · คืน Map<item_id, input> */
export async function validateLotInputs(orderId: string, inputs: unknown): Promise<Map<string, LotDateInput>> {
  const byItem = new Map<string, LotDateInput>();
  if (inputs == null) return byItem;
  if (!Array.isArray(inputs)) throw badRequest("lots ต้องเป็น array");

  const itemIds = new Set(
    (await productionItemModel.find({ production_order_id: orderId, deleted_at: null }).select("_id").lean<any[]>()).map(
      (i) => String(i._id)
    )
  );
  for (const raw of inputs as any[]) {
    const itemId = String(raw?.item_id ?? "");
    if (!itemIds.has(itemId)) throw badRequest(`lots: ไม่พบรายการผลิต ${itemId} ในใบสั่งผลิตนี้`);
    const input: LotDateInput = { item_id: itemId };
    if (raw.produced_date !== undefined) input.produced_date = assertDate(raw.produced_date, "produced_date");
    if (raw.expiry_date !== undefined) {
      input.expiry_date = raw.expiry_date === null ? null : assertDate(raw.expiry_date, "expiry_date");
    }
    if (input.produced_date && input.expiry_date && input.expiry_date < input.produced_date) {
      throw badRequest("วันหมดอายุต้องไม่ก่อนวันผลิต");
    }
    byItem.set(itemId, input);
  }
  return byItem;
}

/**
 * สร้างล็อตของใบสั่งผลิตที่เพิ่งปิดงาน — ครั้งเดียวต่อรายการ (unique production_item_id · ปิดซ้ำไม่สร้างซ้ำ)
 * order = เอกสารใบสั่งผลิต (มี _id, production_date, round_id)
 */
export async function createLotsForProduction(
  order: { _id: unknown; production_date: Date; round_id?: unknown },
  opts: { use_actual?: boolean; lots?: Map<string, LotDateInput> } = {}
): Promise<void> {
  await dbConnect();
  const items = await productionItemModel
    .find({ production_order_id: order._id, deleted_at: null, item_status: { $ne: "cancelled" } })
    .lean<any[]>();
  if (items.length === 0) return;

  const products = await productModel
    .find({ _id: { $in: items.map((i) => i.product_id) } })
    .select("is_preorder shelf_life_days")
    .lean<Array<{ _id: unknown; is_preorder?: boolean; shelf_life_days?: number | null }>>();
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const defaultProduced = bangkokDateString(new Date(order.production_date));

  for (const it of items) {
    const qty =
      it.product_stock_added_qty != null
        ? Number(it.product_stock_added_qty)
        : opts.use_actual && it.actual_qty != null
          ? Number(it.actual_qty)
          : Number(it.planned_qty);
    if (!(qty > 0)) continue;

    const product = productById.get(String(it.product_id));
    const input = opts.lots?.get(String(it._id));
    const produced = input?.produced_date ?? defaultProduced;
    const expiry =
      input?.expiry_date !== undefined
        ? input.expiry_date
        : product?.shelf_life_days
          ? addDays(produced, product.shelf_life_days)
          : null;
    if (expiry && expiry < produced) throw badRequest("วันหมดอายุต้องไม่ก่อนวันผลิต");

    try {
      const lot = await productLotModel.create({
        lot_no: await nextLotNo(produced),
        product_id: it.product_id,
        production_order_id: order._id,
        production_item_id: it._id,
        round_id: order.round_id ?? null,
        produced_date: produced,
        expiry_date: expiry,
        qty_produced: qty,
        qty_remaining: isPreorderProduct(product) ? null : qty,
      });
      await ensurePieces(lot);
    } catch (err) {
      // รายการนี้มีล็อตแล้ว (ปิดงานซ้อน) — ข้าม
      if ((err as { code?: number })?.code === 11000) continue;
      throw err;
    }
  }
}

function presentLot(lot: any, today: string) {
  const product = lot.product_id && typeof lot.product_id === "object" ? lot.product_id : null;
  const order = lot.production_order_id && typeof lot.production_order_id === "object" ? lot.production_order_id : null;
  const round = lot.round_id && typeof lot.round_id === "object" ? lot.round_id : null;
  return {
    ...lot,
    product_id: product?._id ?? lot.product_id,
    product_name_th: product?.product_name_th ?? null,
    product_code: product?.product_id ?? null,
    is_preorder: product ? isPreorderProduct(product) : false,
    production_order_id: order?._id ?? lot.production_order_id,
    production_no: order?.production_no ?? null,
    round_id: round?._id ?? lot.round_id ?? null,
    round_name: round?.round_name ?? null,
    expiry_state: expiryState(lot.expiry_date, today),
  };
}

const populateLot = (q: any) =>
  q
    .populate("product_id", "product_id product_name_th is_preorder")
    .populate("production_order_id", "production_no production_date")
    .populate("round_id", "round_name");

export interface ListLotQuery {
  pagination: Pagination;
  product_id?: string;
  production_order_id?: string;
  /** ค้นจากเลขล็อต */
  search?: string;
  /** true = เฉพาะล็อตที่ยังมีของเหลือ (สินค้าปกติ) */
  in_stock?: boolean;
}

export async function listLots(query: ListLotQuery) {
  await dbConnect();
  const filter: Record<string, any> = { deleted_at: null };
  if (query.product_id) {
    assertObjectId(query.product_id, "product_id");
    filter.product_id = query.product_id;
  }
  if (query.production_order_id) {
    assertObjectId(query.production_order_id, "production_order_id");
    filter.production_order_id = query.production_order_id;
  }
  if (query.search) filter.lot_no = new RegExp(escapeRegExp(query.search.trim()), "i");
  if (query.in_stock) filter.qty_remaining = { $gt: 0 };

  const [items, total] = await Promise.all([
    populateLot(
      productLotModel
        .find(filter)
        // ล็อตล่าสุดก่อน
        .sort({ produced_date: -1, created_at: -1 })
        .skip(query.pagination.skip)
        .limit(query.pagination.limit)
    ).lean(),
    productLotModel.countDocuments(filter),
  ]);
  const today = bangkokDateString();
  return { items: (items as any[]).map((l) => presentLot(l, today)), meta: buildMeta(total, query.pagination) };
}

/**
 * รหัสประจำชิ้น = "<เลขล็อต>-<ลำดับชิ้น>" (เช่น L2610290001-001) — ลำดับ 1..qty_produced เติม 0 อย่างน้อย 3 หลัก
 * (ล็อตเกิน 999 ชิ้น = ยาวตามจำนวน) · เก็บใน ProductLotPieces (ensurePieces) — ฉลาก/การสแกนอ่านจากตารางนั้น
 */
export function pieceCode(lotNo: string, piece: number, qtyProduced: number): string {
  return `${lotNo}-${String(piece).padStart(Math.max(3, String(qtyProduced).length), "0")}`;
}

/**
 * สร้างรหัสประจำชิ้นที่ยังไม่มีของล็อต (1..qty_produced) — upsert รายชิ้น เรียกซ้ำ/ซ้อนได้ไม่สร้างซ้ำ
 * เรียกตอนสร้างล็อต + ตอนขอรายการชิ้น (ล็อตที่สร้างก่อนมีตาราง ProductLotPieces)
 */
export async function ensurePieces(lot: { _id: unknown; lot_no: string; product_id: unknown; qty_produced: number }) {
  const existing = await productLotPieceModel.countDocuments({ lot_id: lot._id });
  if (existing >= lot.qty_produced) return;
  await productLotPieceModel.bulkWrite(
    Array.from({ length: lot.qty_produced }, (_, i) => ({
      updateOne: {
        filter: { lot_id: lot._id, piece_no: i + 1 },
        update: {
          $setOnInsert: {
            piece_code: pieceCode(lot.lot_no, i + 1, lot.qty_produced),
            product_id: lot.product_id,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

const findLotByNo = (lotNo: string): Promise<any> =>
  populateLot(productLotModel.findOne({ lot_no: lotNo, deleted_at: null })).lean();

/** รหัสประจำชิ้นทั้งล็อตเรียงตามลำดับ (สำหรับพิมพ์ฉลาก) — ล็อตเก่าที่ยังไม่มีรหัสชิ้น สร้างให้ก่อน */
export async function listPieces(lotNo: string) {
  await dbConnect();
  const no = String(lotNo ?? "").trim().toUpperCase();
  const lot = await productLotModel.findOne({ lot_no: no, deleted_at: null }).lean<any>();
  if (!lot) throw notFound(`ไม่พบล็อต ${no}`);
  await ensurePieces({ ...lot, product_id: lot.product_id });
  const pieces = await productLotPieceModel
    .find({ lot_id: lot._id, piece_no: { $lte: lot.qty_produced } })
    .sort({ piece_no: 1 })
    .select("piece_no piece_code")
    .lean<Array<{ piece_no: number; piece_code: string }>>();
  return pieces.map((p) => ({ piece_no: p.piece_no, piece_code: p.piece_code }));
}

/**
 * ค้นจากบาร์โค้ดบนฉลาก — รหัสประจำชิ้น (ProductLotPieces) หรือเลขล็อต · ไม่สนตัวพิมพ์เล็ก/ใหญ่ + ตัดช่องว่าง
 * piece_no / piece_code = ชิ้นที่สแกน (สแกนเลขล็อตตรง ๆ = null)
 */
export async function getLotByNo(code: string) {
  await dbConnect();
  const no = String(code ?? "").trim().toUpperCase();
  if (!no) throw badRequest("ต้องระบุเลขล็อต");

  const piece = await productLotPieceModel
    .findOne({ piece_code: no })
    .select("lot_id piece_no piece_code")
    .lean<{ lot_id: unknown; piece_no: number; piece_code: string } | null>();
  const lot: any = piece
    ? await populateLot(productLotModel.findOne({ _id: piece.lot_id, deleted_at: null })).lean()
    : await findLotByNo(no);
  if (!lot) throw notFound(`ไม่พบล็อต ${no}`);
  return {
    ...presentLot(lot, bangkokDateString()),
    piece_no: piece?.piece_no ?? null,
    piece_code: piece?.piece_code ?? null,
  };
}
