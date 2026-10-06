import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import userLogModel from "@/models/userLogModel";
import * as authService from "@/services/authService";
import { OAuthAccountError } from "@/services/oauthService";

// authService.loginWithLine — ล็อกอินด้วย LINE ของ frontend แยก origin (/api/auth/line/callback)
// หา/สร้างบัญชีตามกติกาของ oauthService.signInWithLine แล้วออก session JWT ของหลัก
describe("authService.loginWithLine", () => {
  it("LINE ใหม่ → สร้างลูกค้า (line_user_id) + ออก token + userlog · ไม่มี secret รั่ว", async () => {
    await roleModel.create({ role_name: "customer", role_type: "customer" });

    const r = await authService.loginWithLine({ sub: "U_NEW", name: "แมว เหมียว", email: "cat@example.com" }, { ip: "1.2.3.4" });

    expect(typeof r.token).toBe("string");
    expect(r.session.role_type).toBe("customer");
    const doc = await userModel.findById(r.session.user_id).lean<{ line_user_id: string; email: string; auth_provider: string }>();
    expect(doc?.line_user_id).toBe("U_NEW");
    expect(doc?.email).toBe("cat@example.com");
    expect(doc?.auth_provider).toBe("line");
    expect((r.user as Record<string, unknown>).password).toBeUndefined();
    expect(await userLogModel.exists({ user_id: r.session.user_id, action: "เข้าสู่ระบบผ่าน LINE" })).toBeTruthy();
  });

  it("LINE เดิม → บัญชีเดิม ไม่สร้างซ้ำ", async () => {
    await roleModel.create({ role_name: "customer", role_type: "customer" });
    const first = await authService.loginWithLine({ sub: "U_SAME", name: "ก" });
    const second = await authService.loginWithLine({ sub: "U_SAME", name: "ก" });
    expect(second.session.user_id).toBe(first.session.user_id);
    expect(await userModel.countDocuments({ line_user_id: "U_SAME" })).toBe(1);
  });

  it("ไม่มีอีเมลจาก LINE → อีเมลชั่วคราว *@line-user.invalid", async () => {
    await roleModel.create({ role_name: "customer", role_type: "customer" });
    const r = await authService.loginWithLine({ sub: "U_NOMAIL" });
    const doc = await userModel.findById(r.session.user_id).lean<{ email: string }>();
    expect(doc?.email).toMatch(/@line-user\.invalid$/);
  });

  it("บัญชีถูกปิด → OAuthAccountError (หน้าเว็บแสดงข้อความ)", async () => {
    await roleModel.create({ role_name: "customer", role_type: "customer" });
    const r = await authService.loginWithLine({ sub: "U_OFF" });
    await userModel.updateOne({ _id: r.session.user_id }, { $set: { is_active: false } });
    await expect(authService.loginWithLine({ sub: "U_OFF" })).rejects.toBeInstanceOf(OAuthAccountError);
  });
});
