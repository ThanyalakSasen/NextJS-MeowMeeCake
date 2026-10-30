/**
 * schemas/expense — validation ของ /api/admin/expenses (crudRoutes validate)
 */
import { z } from "zod";
import { WHOLE_BAHT } from "./common";

const CATEGORIES = [
  "วัตถุดิบ",
  "บรรจุภัณฑ์",
  "ค่าจ้างแรงงาน",
  "ค่าสาธารณูปโภค",
  "ค่าเช่า",
  "ค่าการตลาด",
  "ค่าซ่อมบำรุง",
  "อื่นๆ",
] as const;
const PAYMENT_METHODS = ["เงินสด", "โอนเงิน", "บัตรเครดิต", "QR Code"] as const;

/** ยอดค่าใช้จ่ายสูงสุดต่อรายการ (บาท) */
export const EXPENSE_MAX = 10_000_000;

export const expenseCreate = z.object({
  date: z.coerce.date(),
  description: z.string().trim().min(1).max(300),
  category: z.enum(CATEGORIES),
  // รายจ่าย 0 บาทไม่มีความหมาย — กันฟอร์มที่ลืมกรอกจำนวนเงินแล้วบันทึกเป็น 0 (TC-ADM-96)
  // เพดานกันพิมพ์ศูนย์เกิน (เช่น 1,500 → 15,000,000) แล้วสรุปการเงินเพี้ยน — เดิมไม่มีเพดาน
  amount: z.number().int(WHOLE_BAHT).positive("จำนวนเงินต้องมากกว่า 0").max(EXPENSE_MAX, `จำนวนเงินต้องไม่เกิน ${EXPENSE_MAX.toLocaleString("en-US")} บาท`),
  payment_method: z.enum(PAYMENT_METHODS),
  vendor: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  receipt_url: z.string().trim().max(1000).nullish(),
  is_recurring: z.boolean().optional(),
});
export const expenseUpdate = expenseCreate.partial();
