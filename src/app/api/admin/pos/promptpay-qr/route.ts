/**
 * GET /api/admin/pos/promptpay-qr?amount=150.50
 *   QR พร้อมเพย์จริงของร้านสำหรับยอดที่ต้องชำระ (บาท) — POS ให้ลูกค้าหน้าร้านสแกนจ่าย
 *   คืน { qr_image (data URL PNG), account_name, promptpay_id, amount }
 *   เลขพร้อมเพย์/ชื่อบัญชีจาก "ข้อมูลร้านค้า" (StoreProfile) → ไม่ได้ตั้ง = env PROMPTPAY_ID · ไม่มีทั้งคู่ = 422
 *   สร้างด้วย buildPromptPayQr ตัวเดียวกับหน้าชำระเงินออนไลน์ (paymentService.getPaymentPage)
 *
 *   สิทธิ์: orders.view (เหมือน API อื่นของ POS) — /admin/store-profile เป็นของเจ้าของร้านเท่านั้น
 *   พนักงานหน้าร้านจึงอ่านเลขพร้อมเพย์จากที่นั่นไม่ได้ (เดิม POS แสดง QR จำลองที่สแกนจ่ายไม่ได้)
 *   ไม่มีการยืนยันเงินเข้าอัตโนมัติ — พนักงานตรวจยอดในแอปธนาคารแล้วกดยืนยันเอง
 */
import { z } from "zod";
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseQuery } from "@/lib/validate";
import { buildPromptPayQr } from "@/services/promptpayService";

const query = z.object({
  amount: z.coerce
    .number()
    .positive()
    .max(1_000_000)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
      message: "ยอดเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง",
    }),
});

export const GET = withPermission("orders", "view", async (_s, req) => {
  const { amount } = parseQuery(req.nextUrl.searchParams, query);
  const rounded = Math.round(amount * 100) / 100;
  return ok({ ...(await buildPromptPayQr(rounded)), amount: rounded });
});
