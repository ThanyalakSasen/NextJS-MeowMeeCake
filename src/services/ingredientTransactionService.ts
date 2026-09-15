/**
 * ingredientTransactionService — รายการเคลื่อนไหวสต็อกวัตถุดิบ (IngredientTransactions)
 *
 * เป็น "แหล่งความจริง" ของการเปลี่ยนแปลง current_stock ของวัตถุดิบ:
 *   type "receive" → เพิ่มสต็อก (+qty)
 *   type "use"     → ลดสต็อก  (-qty)   กันติดลบ เว้นแต่ allowNegative
 *   type "adjust"  → ตั้งยอดนับจริง current_stock = qty (บันทึกส่วนต่างไว้ใน note ให้ด้วย)
 *
 * ทุกครั้งจะอัปเดต current_stock แบบ atomic แล้วจึงบันทึกรายการ ถ้าบันทึกล้มเหลวจะย้อนสต็อกกลับ
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, type Pagination } from "../lib/queryParams";
import ingredientTransactionModel from "../models/ingredientTransactionModel";
import ingredientModel from "../models/ingredientModel";
import unitModel from "../models/unitModel";
import userModel from "../models/userModel";
import productionItemModel from "../models/productionItemModel";
import { notificationService } from "./notificationService";
import { log } from "../lib/logger";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const TRANSACTION_TYPES = ["use", "receive", "adjust"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface CreateTransactionInput {
  ingredient_id: string;
  type: TransactionType;
  qty: number;
  performed_by: string;
  unit_id?: string | null;
  note?: string;
  po_ref?: string | null;
  transaction_date?: string | Date | null;
  expiry_date?: string | Date | null;
  allowNegative?: boolean;
  /** BACKLOG §2c.3 — internal only: productionItemService ใส่ให้เพื่อผูกธุรกรรมกับรายการผลิต
   *  ที่สร้างมัน กัน voidTransaction() ย้อนรายการนี้แบบไม่รู้ตัว (ต้องยกเลิกผ่าน reverse-stock แทน) */
  production_item_id?: string | null;
}

export interface ListTransactionQuery {
  pagination: Pagination;
  ingredient_id?: string;
  type?: TransactionType;
  performed_by?: string;
  date_from?: string;
  date_to?: string;
  includeDeleted?: boolean;
}

// ── CREATE (+ ปรับ current_stock) ───────────────────────────
export async function createTransaction(input: CreateTransactionInput) {
  await dbConnect();

  if (!TRANSACTION_TYPES.includes(input.type)) {
    throw badRequest(`type ต้องเป็นหนึ่งใน: ${TRANSACTION_TYPES.join(", ")}`);
  }
  if (!input.performed_by) throw badRequest("กรุณาระบุ performed_by");

  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty < 0) throw badRequest("qty ต้องเป็นตัวเลขไม่ติดลบ");
  if ((input.type === "use" || input.type === "receive") && qty <= 0) {
    throw badRequest('type "use"/"receive" ต้องมี qty มากกว่า 0');
  }

  assertObjectId(input.ingredient_id, "ingredient_id");
  const ingredient = await ingredientModel
    .findOne({ _id: input.ingredient_id, deleted_at: null })
    .lean<any>();
  if (!ingredient) throw notFound("ไม่พบวัตถุดิบที่ระบุ");

  await assertRefExists(userModel, input.performed_by, "ผู้ทำรายการ", "performed_by");

  const unitId = input.unit_id || String(ingredient.unit_id);
  await assertRefExists(unitModel, unitId, "หน่วยนับ", "unit_id");

  if (input.production_item_id) {
    await assertRefExists(productionItemModel, input.production_item_id, "รายการผลิต", "production_item_id");
  }

  const before = ingredient.current_stock ?? 0;
  let after: number;
  let noteExtra = "";

  if (input.type === "receive") {
    await ingredientModel.updateOne(
      { _id: ingredient._id },
      { $inc: { current_stock: qty } }
    );
    after = before + qty;
  } else if (input.type === "use") {
    const filter: Record<string, any> = { _id: ingredient._id, deleted_at: null };
    if (!input.allowNegative) filter.current_stock = { $gte: qty };
    const res = await ingredientModel.updateOne(filter, { $inc: { current_stock: -qty } });
    if (res.modifiedCount === 0) {
      throw conflict(`สต็อกวัตถุดิบไม่พอ (คงเหลือ ${before}, ต้องการ ${qty})`);
    }
    after = before - qty;
  } else {
    // adjust: ตั้งยอดนับจริง
    await ingredientModel.updateOne(
      { _id: ingredient._id },
      { $set: { current_stock: qty } }
    );
    after = qty;
    noteExtra = ` [ปรับยอด: ${before} → ${after} (${after - before >= 0 ? "+" : ""}${after - before})]`;
  }

  try {
    const txn = await ingredientTransactionModel.create({
      ingredient_id: ingredient._id,
      type: input.type,
      qty,
      unit_id: unitId,
      note: (input.note ?? "") + noteExtra,
      po_ref: input.po_ref ?? null,
      transaction_date: input.transaction_date ? new Date(input.transaction_date) : new Date(),
      expiry_date: input.expiry_date ? new Date(input.expiry_date) : null,
      performed_by: input.performed_by,
      production_item_id: input.production_item_id ?? null,
    });

    // แจ้งเตือนตอนสต็อกเพิ่งข้ามจุดสั่งซื้อลงมา (before > reorder_point, after <= reorder_point)
    // เช็คแค่ตอน "เพิ่งข้าม" กัน spam แจ้งเตือนซ้ำทุกครั้งที่เบิกตอนสต็อกต่ำอยู่แล้ว
    const reorderPoint = ingredient.reorder_point ?? 0;
    if (before > reorderPoint && after <= reorderPoint) {
      notificationService
        .notify({
          title: `วัตถุดิบใกล้หมด: ${ingredient.ingredient_name}`,
          message: `คงเหลือ ${after} (จุดสั่งซื้อ ${reorderPoint})`,
          module: "ingredient",
          type: "warning",
          link: "/owner/ingredients",
        })
        .catch((err) => log.error("ingredient.notify_failed", { ingredient_id: String(ingredient._id), err }));
    }

    return {
      transaction: txn.toObject(),
      stock: { ingredient_id: String(ingredient._id), before, after },
    };
  } catch (err) {
    // ย้อนสต็อกกลับ (best-effort)
    if (input.type === "receive") {
      await ingredientModel.updateOne({ _id: ingredient._id }, { $inc: { current_stock: -qty } });
    } else if (input.type === "use") {
      await ingredientModel.updateOne({ _id: ingredient._id }, { $inc: { current_stock: qty } });
    } else {
      await ingredientModel.updateOne({ _id: ingredient._id }, { $set: { current_stock: before } });
    }
    throw err;
  }
}

// ── READ ────────────────────────────────────────────────────
export async function listTransactions(query: ListTransactionQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (query.ingredient_id) {
    assertObjectId(query.ingredient_id, "ingredient_id");
    filter.ingredient_id = query.ingredient_id;
  }
  if (query.type) filter.type = query.type;
  if (query.performed_by) {
    assertObjectId(query.performed_by, "performed_by");
    filter.performed_by = query.performed_by;
  }
  if (query.date_from || query.date_to) {
    filter.transaction_date = {};
    if (query.date_from) filter.transaction_date.$gte = new Date(query.date_from);
    if (query.date_to) filter.transaction_date.$lte = new Date(query.date_to);
  }

  const [items, total] = await Promise.all([
    ingredientTransactionModel
      .find(filter)
      .sort({ transaction_date: -1, created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("ingredient_id", "ingredient_name")
      .populate("unit_id", "unit_name unit_abbr")
      .populate("performed_by", "user_fullname email")
      .lean(),
    ingredientTransactionModel.countDocuments(filter),
  ]);

  return { items, meta: buildMeta(total, query.pagination) };
}

export async function getTransactionById(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await ingredientTransactionModel
    .findOne({ _id: id, deleted_at: null })
    .populate("ingredient_id", "ingredient_name current_stock")
    .populate("unit_id", "unit_name unit_abbr")
    .populate("performed_by", "user_fullname email")
    .lean();
  if (!doc) throw notFound("ไม่พบรายการเคลื่อนไหวที่ระบุ");
  return doc;
}

// ── VOID (ยกเลิก + ย้อนผลต่อสต็อก) — เฉพาะ use/receive ──────
export async function voidTransaction(id: string) {
  await dbConnect();
  assertObjectId(id);

  const txn = await ingredientTransactionModel.findOne({ _id: id, deleted_at: null });
  if (!txn) throw notFound("ไม่พบรายการเคลื่อนไหวที่ระบุ หรือถูกยกเลิกไปแล้ว");
  if (txn.type === "adjust") {
    throw badRequest("รายการชนิด adjust ยกเลิกไม่ได้ (ไม่มียอดก่อนหน้าให้ย้อน) — ให้ทำ adjust ใหม่แทน");
  }
  // BACKLOG §2c.3 — รายการที่เกิดจากการผลิต (consumeStock/reverseStock) ห้าม void ผ่านทางนี้:
  // ธุรกรรมกลุ่มนี้ผูกกับ productionItem.stock_impact/stock_updated_at ของรายการผลิตต้นทาง — ถ้า void
  // ตรงนี้แล้วภายหลังมีคนกด reverse-stock ที่หน้ารายการผลิตอีกที (เพราะ stock_updated_at ยังไม่ถูกเคลียร์
  // ไม่รู้ว่ามีคนย้อนไปแล้ว) จะสร้างรายการ "receive" ชดเชยซ้ำอีกรอบ = เครดิตสต็อกสองครั้งจากการเบิกครั้งเดียว
  if (txn.production_item_id) {
    throw conflict(
      "รายการนี้เกิดจากการผลิต — ยกเลิกผ่านทางนี้ไม่ได้ (จะทำให้เครดิตสต็อกซ้ำถ้ามีคนกดคืนสต็อกที่หน้า" +
        "รายการผลิตอีกที) ให้ไปที่รายการผลิตนี้แล้วกด \"คืนสต็อกวัตถุดิบ\" (reverse-stock) แทน"
    );
  }

  const inc = txn.type === "receive" ? -txn.qty : txn.qty; // receive→ลบออก, use→คืนกลับ

  // BACKLOG 2c.2: ย้อนรายการ "receive" คือการลบสต็อกออก (inc < 0) — ต้องกันติดลบแบบเดียวกับ
  // createTransaction ฝั่ง "use" (:89) ไม่งั้น void รายการรับที่ของถูกเบิกใช้ไปแล้วบางส่วนจะทำให้
  // current_stock ติดลบเงียบ ๆ ไม่มี error (การย้อน "use" คืนกลับเข้าสต็อกไม่มีทางติดลบ ไม่ต้องกัน)
  const filter: Record<string, any> = { _id: txn.ingredient_id, deleted_at: null };
  if (inc < 0) filter.current_stock = { $gte: -inc };
  const res = await ingredientModel.updateOne(filter, { $inc: { current_stock: inc } });
  if (res.modifiedCount === 0) {
    const current = await ingredientModel.findById(txn.ingredient_id).lean<any>();
    throw conflict(
      `สต็อกไม่พอให้ย้อนรายการนี้ (คงเหลือ ${current?.current_stock ?? 0}, ต้องย้อนออก ${-inc}) — ` +
        `อาจมีการเบิกใช้ไปแล้วหลังรายการนี้ ให้ทำ adjust ปรับยอดแทน`
    );
  }

  txn.deleted_at = new Date();
  txn.note = `${txn.note ?? ""} [ยกเลิกรายการ]`.trim();
  await txn.save();
  return txn.toObject();
}
