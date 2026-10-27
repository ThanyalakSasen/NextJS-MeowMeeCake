/**
 * POST /api/shop/payment-groups/[id]/slip — แนบสลิปเดียวสำหรับทุกบิลในกลุ่ม (multipart: "file" หรือ "slip")
 *   ทุกบิลต้องยังรอชำระ — มีบิลยกเลิก/หมดเวลา/ชำระแล้ว = 409 ให้ชำระแยกรายบิล
 *   ไฟล์เดียวกับ /api/shop/payments/[id]/slip (ไฟล์ส่วนตัว · ≤ 5 MB) · ผูกไม่สำเร็จ = ลบไฟล์ทิ้ง
 */
import type { NextRequest } from "next/server";
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { readSingleUpload, UPLOAD_DIRS } from "@/lib/upload";
import { savePrivateImage, deletePrivateFile } from "@/lib/privateFiles";
import * as paymentGroupService from "@/services/paymentGroupService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  // ตรวจว่าเป็นของตัวเองก่อนรับไฟล์ (ไม่ใช่ = 404 ไม่เขียนไฟล์ทิ้งไว้)
  await paymentGroupService.getGroupPaymentPage(id, session.user_id);
  const { file } = await readSingleUpload(req, ["file", "slip"]);
  const saved = await savePrivateImage(file, UPLOAD_DIRS.slips);
  let result;
  try {
    result = await paymentGroupService.submitGroupSlip(id, session.user_id, saved.url);
  } catch (err) {
    await deletePrivateFile(saved.url).catch(() => undefined);
    throw err;
  }
  audit(req, {
    action: `แนบสลิปชำระรวม (อัปโหลด ${saved.filename})`,
    action_type: "UPDATE",
    entity: "Payment",
    entity_id: id,
    details: { group_id: id, payments: result.payments.length },
  });
  return ok(result);
});
