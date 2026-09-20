import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import userModel from "@/models/userModel";
import roleModel from "@/models/roleModel";
import { verifyCredentials } from "@/services/userService";
import { resetPassword } from "../../scripts/reset-owner-password";
import { makeUser } from "./helpers";

/**
 * scripts/reset-owner-password.ts — รีเซ็ตรหัสผ่านต้อง "ปลดล็อกบัญชี" ด้วย
 * เดิมเซ็ตแค่ password: บัญชีที่ถูกล็อก (ผิด 5 ครั้ง → lockout 15 นาที) ยังเข้าไม่ได้ เพราะ
 * verifyCredentials() ปฏิเสธด้วย 423 ก่อนเทียบรหัสผ่านเสมอ
 */
describe("resetPassword (scripts/reset-owner-password.ts)", () => {
  async function makeLocalUser(over: Record<string, unknown> = {}) {
    const role = await roleModel.create({ role_name: `owner-${Date.now()}-${Math.random()}`, role_type: "owner" });
    return makeUser({ role_id: role._id, password: await bcrypt.hash("old-password-1", 4), ...over });
  }

  it("บัญชีที่ถูกล็อก: ตั้งรหัสใหม่แล้ว login ด้วยรหัสใหม่ได้ทันที (ก่อนแก้ต้องรอ lockout หมด)", async () => {
    const user = await makeLocalUser({ failed_login_attempts: 0, lockout_until: new Date(Date.now() + 10 * 60_000) });
    await expect(verifyCredentials(user.email, "old-password-1")).rejects.toMatchObject({ status: 423 });

    const r = await resetPassword(user.email, "brand-new-password-2");

    expect(r).toMatchObject({ found: true, wasLocked: true });
    const after = await userModel.findById(user._id).lean();
    expect(after?.lockout_until).toBeNull();
    expect(after?.failed_login_attempts).toBe(0);
    await expect(verifyCredentials(user.email, "brand-new-password-2")).resolves.toBeTruthy();
    await expect(verifyCredentials(user.email, "old-password-1")).rejects.toMatchObject({ status: 401 });
  });

  it("ยังไม่ถูกล็อกแต่มีจำนวนครั้งที่ผิดสะสม → ล้างเป็น 0 และรายงาน hadFailedAttempts", async () => {
    const user = await makeLocalUser({ failed_login_attempts: 3 });
    const r = await resetPassword(user.email, "brand-new-password-2");
    expect(r).toMatchObject({ found: true, wasLocked: false, hadFailedAttempts: true });
    expect((await userModel.findById(user._id).lean())?.failed_login_attempts).toBe(0);
  });

  it("lockout ที่หมดเวลาไปแล้วไม่นับว่า wasLocked แต่ก็ถูกล้างทิ้ง", async () => {
    const user = await makeLocalUser({ lockout_until: new Date(Date.now() - 60_000) });
    const r = await resetPassword(user.email, "brand-new-password-2");
    expect(r.wasLocked).toBe(false);
    expect((await userModel.findById(user._id).lean())?.lockout_until).toBeNull();
  });

  it("ไม่ยุ่งกับ is_active: บัญชีที่ถูกระงับยังถูกระงับ และรายงาน suspended", async () => {
    const user = await makeLocalUser({ is_active: false });
    const r = await resetPassword(user.email, "brand-new-password-2");
    expect(r.suspended).toBe(true);
    expect((await userModel.findById(user._id).lean())?.is_active).toBe(false);
  });

  it("อีเมลตัวพิมพ์ใหญ่/มีช่องว่างก็เจอ (เหมือนตอน login) · ไม่พบ user → found: false และไม่สร้างอะไรเพิ่ม", async () => {
    const user = await makeLocalUser();
    expect((await resetPassword(`  ${user.email.toUpperCase()} `, "brand-new-password-2")).found).toBe(true);

    const before = await userModel.countDocuments({});
    expect(await resetPassword("nobody@test.local", "brand-new-password-2")).toMatchObject({ found: false });
    expect(await userModel.countDocuments({})).toBe(before);
  });
});
