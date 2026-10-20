import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import { POST as refundPOST } from "@/app/api/admin/payments/[id]/refund/route";
import { makeUser } from "./helpers";

/**
 * POST /api/admin/payments/[id]/refund ใช้ payments.delete (Final-Backlog P7)
 * เดิมใช้ payments.approve ตัวเดียวกับยืนยันสลิป — พนักงานเคาน์เตอร์ที่ยืนยันการชำระใน POS ได้ กดคืนเงินได้ด้วย
 */

async function staffWith(perms: { can_approve?: boolean; can_delete?: boolean }) {
  const role = await roleModel.create({ role_name: `staff-${Math.random()}`, role_type: "staff" });
  const user = await makeUser({ role_id: role._id });
  await createPermission({ role_id: String(role._id), menu_key: "payments", granted_by: String(user._id), can_view: true, ...perms });
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: "staff",
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return session;
}

/** ยิงคืนเงินกับ id ที่ไม่มีจริง — ผ่านด่านสิทธิ์ = 404 (ไม่พบรายการ) · ไม่ผ่าน = 403 */
async function refund(session: SessionUser) {
  const id = String(new Types.ObjectId());
  const res = await refundPOST(
    new NextRequest(`http://localhost:3000/api/admin/payments/${id}/refund`, {
      method: "POST",
      headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );
  return res.status;
}

describe("คืนเงิน — สิทธิ์ payments.delete", () => {
  it("มีแค่ payments.approve (ยืนยันสลิป) → คืนเงินไม่ได้ 403", async () => {
    expect(await refund(await staffWith({ can_approve: true }))).toBe(403);
  });

  it("มี payments.delete → ผ่านด่านสิทธิ์ (รายการไม่มีจริง = 404)", async () => {
    expect(await refund(await staffWith({ can_delete: true }))).toBe(404);
  });
});
