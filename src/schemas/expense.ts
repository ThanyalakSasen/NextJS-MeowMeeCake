/**
 * schemas/expense — validation ของ /api/admin/expenses (crudRoutes validate)
 */
import { z } from "zod";

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

export const expenseCreate = z.object({
  date: z.coerce.date(),
  description: z.string().trim().min(1).max(300),
  category: z.enum(CATEGORIES),
  // รายจ่าย 0 บาทไม่มีความหมาย — กันฟอร์มที่ลืมกรอกจำนวนเงินแล้วบันทึกเป็น 0 (TC-ADM-96)
  amount: z.number().positive("จำนวนเงินต้องมากกว่า 0"),
  payment_method: z.enum(PAYMENT_METHODS),
  vendor: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  receipt_url: z.string().trim().max(1000).nullish(),
  is_recurring: z.boolean().optional(),
});
export const expenseUpdate = expenseCreate.partial();
