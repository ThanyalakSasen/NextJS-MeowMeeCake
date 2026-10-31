/**
 * schemas/purchase — บันทึกการซื้อวัตถุดิบ (POST /api/admin/purchases) + ผูกรายการรับเข้ากับค่าใช้จ่าย
 * ดู services/purchaseService.ts
 */
import { z } from "zod";
import { objectId, WHOLE_BAHT } from "./common";
import { EXPENSE_MAX } from "./expense";

/** หมวดค่าใช้จ่ายของบิลซื้อ — ของที่รับเข้าสต็อกวัตถุดิบ (นับเป็นต้นทุนขาย) */
export const PURCHASE_CATEGORIES = ["วัตถุดิบ", "บรรจุภัณฑ์"] as const;
const PAYMENT_METHODS = ["เงินสด", "โอนเงิน", "บัตรเครดิต", "QR Code"] as const;
/** จำนวนรายการสูงสุดต่อบิล */
export const PURCHASE_ITEMS_MAX = 50;

/** ราคารวมของรายการในบิล (บาทเต็ม — เท่ายอดค่าใช้จ่าย) · 0 ได้ (ของแถม) แต่ทั้งบิลต้องมากกว่า 0 */
const lineTotal = z.number().int(WHOLE_BAHT).min(0).max(EXPENSE_MAX);

export const purchaseCreate = z.object({
  date: z.coerce.date(),
  vendor: z.string().trim().max(200).optional(),
  category: z.enum(PURCHASE_CATEGORIES),
  payment_method: z.enum(PAYMENT_METHODS),
  /** ว่าง = ระบบตั้งให้จากชื่อวัตถุดิบ */
  description: z.string().trim().max(300).optional(),
  note: z.string().trim().max(1000).optional(),
  receipt_url: z.string().trim().max(1000).nullish(),
  /** เลขที่บิล/ใบสั่งซื้อ — เก็บที่รายการรับเข้าทุกแถว (po_ref) */
  po_ref: z.string().trim().max(100).optional(),
  /** ตั้งต้นทุนวัตถุดิบ (cost_per_unit) = ราคาต่อหน่วยของบิลนี้ (line_total / qty · ข้ามรายการราคา 0) — ไม่ส่ง = true */
  update_cost: z.boolean().optional(),
  items: z
    .array(
      z.object({
        ingredient_id: objectId,
        qty: z.number().positive(),
        line_total: lineTotal,
        expiry_date: z.coerce.date().nullish(),
      })
    )
    .min(1)
    .max(PURCHASE_ITEMS_MAX),
});
export type PurchaseCreate = z.infer<typeof purchaseCreate>;

export const expenseLinkBody = z.object({
  links: z
    .array(z.object({ transaction_id: objectId, line_total: lineTotal }))
    .min(1)
    .max(PURCHASE_ITEMS_MAX),
  /** ตั้งต้นทุนวัตถุดิบจากราคาที่ผูก — เฉพาะเมื่อเป็นราคาซื้อล่าสุดของวัตถุดิบนั้น (ดู purchaseService.linkStockItems) · ไม่ส่ง = true */
  update_cost: z.boolean().optional(),
});
