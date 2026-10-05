import { describe, it, expect, beforeEach, afterEach } from "vitest";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import { setMailTransport } from "@/lib/mailer";
import * as accountService from "@/services/accountService";
import * as userService from "@/services/userService";
import * as pointsService from "@/services/pointsService";
import { signInWithGoogle, signInWithLine, isPlaceholderEmail } from "@/services/oauthService";
import { assertSessionStillValid } from "@/lib/authGuard";
import type { SessionUser } from "@/lib/session";

/** ขั้น 3 — สมัครแบบยืนยันอีเมล · ลืมรหัสผ่าน · Google/LINE ผ่าน next-auth · session next-auth (customer-backend-merge.md §8.9) */

type Mail = { to: string; subject: string; html: string };
let sent: Mail[] = [];
let failMail = false;

beforeEach(async () => {
  sent = [];
  failMail = false;
  setMailTransport({
    sendMail: (async (m: Mail) => {
      if (failMail) throw new Error("SMTP down");
      sent.push(m);
      return {};
    }) as never,
  });
  await roleModel.create({ role_name: "customer", role_type: "customer" });
});
afterEach(() => setMailTransport(null));

/** ดึง token จากลิงก์ในอีเมลล่าสุด */
const tokenFromMail = () => /token=([a-f0-9]+)/.exec(sent[sent.length - 1].html)![1];
const signupInput = (email: string) => ({ user_fullname: "ลูกค้า ทดสอบ", email, password: "Password123" });

describe("สมัครสมาชิก + ยืนยันอีเมล", () => {
  it("สมัคร → ส่งลิงก์ · ยังไม่ยืนยันล็อกอินไม่ได้ · ยืนยันแล้วล็อกอินได้ · ใช้ลิงก์ซ้ำไม่ได้", async () => {
    const res = await accountService.signup(signupInput("New@Test.local"));
    expect(res.email).toBe("new@test.local");
    expect(sent).toHaveLength(1);
    const token = tokenFromMail();
    const stored = await userModel.findById(res.user_id).lean<{ email_verify_token: string }>();
    expect(stored!.email_verify_token).not.toBe(token); // เก็บเป็น hash

    await expect(userService.verifyCredentials("new@test.local", "Password123")).rejects.toMatchObject({ status: 403 });
    await expect(accountService.signup(signupInput("new@test.local"))).rejects.toMatchObject({ status: 409 });

    await accountService.verifyEmail(token);
    expect(await pointsService.getBalance(res.user_id)).toBe(50); // โบนัสสมาชิกใหม่หลังยืนยันอีเมล (§8.11)
    const user = (await userService.verifyCredentials("new@test.local", "Password123")) as { email: string };
    expect(user.email).toBe("new@test.local");
    await expect(accountService.verifyEmail(token)).rejects.toMatchObject({ status: 400 });
  });

  it("ส่งอีเมลไม่ได้ → 502 + ยกเลิกการสมัคร แล้วสมัครใหม่ด้วยอีเมลเดิมได้ (ใช้เอกสารเดิม)", async () => {
    failMail = true;
    await expect(accountService.signup(signupInput("fail@test.local"))).rejects.toMatchObject({ status: 502 });
    failMail = false;
    const again = await accountService.signup(signupInput("fail@test.local"));
    expect(await userModel.countDocuments({ email: "fail@test.local" })).toBe(1);
    expect((await userModel.findById(again.user_id).lean<{ deleted_at: unknown }>())!.deleted_at).toBeNull();
  });

  it("พนักงานที่ยังไม่ยืนยันอีเมลล็อกอินได้ตามเดิม · ขอส่งอีเมลยืนยันใหม่ได้ (ตอบเหมือนกันทุกกรณี)", async () => {
    const staffRole = await roleModel.create({ role_name: "staff", role_type: "staff" });
    await userModel.create({
      user_fullname: "พนักงาน", email: "staff@test.local", password: await userService.hashPassword("Password123"),
      auth_provider: "local", role_id: staffRole._id,
    });
    expect(await userService.verifyCredentials("staff@test.local", "Password123")).toBeTruthy();

    await accountService.signup(signupInput("old@test.local"));
    const first = tokenFromMail();
    const a = await accountService.resendVerification("old@test.local");
    const b = await accountService.resendVerification("nobody@test.local");
    expect(a).toEqual(b);
    expect(sent).toHaveLength(2);
    await expect(accountService.verifyEmail(first)).rejects.toMatchObject({ status: 400 }); // ลิงก์เก่าใช้ไม่ได้แล้ว
    await accountService.verifyEmail(tokenFromMail());
  });
});

describe("ลืมรหัสผ่าน", () => {
  it("ขอลิงก์ → ตั้งรหัสใหม่ · ห้ามรหัสเดิม · ใช้ครั้งเดียว · session next-auth เดิมหลุด", async () => {
    const res = await accountService.signup(signupInput("reset@test.local"));
    await accountService.verifyEmail(tokenFromMail());
    const session: SessionUser = {
      user_id: res.user_id, role_id: "", role_type: "customer", email: "reset@test.local",
      source: "nextauth", auth_time: Date.now() - 1000,
    };
    expect((await assertSessionStillValid(session)).role_id).not.toBe(""); // เติม role_id จาก DB

    expect(await accountService.requestPasswordReset("nobody@test.local")).toEqual(
      await accountService.requestPasswordReset("reset@test.local")
    );
    const token = tokenFromMail();
    await expect(accountService.checkResetToken("bad")).rejects.toMatchObject({ status: 400 });
    await accountService.checkResetToken(token);
    await expect(accountService.resetPassword(token, "Password123")).rejects.toMatchObject({ status: 400 });
    await expect(accountService.resetPassword({ $ne: "" }, "NewPassword456")).rejects.toMatchObject({ status: 400 });

    await accountService.resetPassword(token, "NewPassword456");
    await expect(accountService.resetPassword(token, "Another789!")).rejects.toMatchObject({ status: 400 });
    expect(await userService.verifyCredentials("reset@test.local", "NewPassword456")).toBeTruthy();
    await expect(assertSessionStillValid(session)).rejects.toMatchObject({ status: 401 });
    expect(await assertSessionStillValid({ ...session, auth_time: Date.now() + 1000 })).toBeTruthy();
  });

  it("บัญชี Google ไม่มีรหัสผ่าน → 400", async () => {
    await signInWithGoogle({ email: "g@test.local", name: "G", sub: "g-1" });
    await expect(accountService.requestPasswordReset("g@test.local")).rejects.toMatchObject({ status: 400 });
  });
});

describe("Google / LINE ผ่าน next-auth", () => {
  it("Google: สร้างลูกค้าใหม่ (ยืนยันแล้ว) · ครั้งต่อไปใช้บัญชีเดิม · ผูกกับบัญชีรหัสผ่านเดิมโดยไม่เปลี่ยน auth_provider", async () => {
    const a = await signInWithGoogle({ email: "G1@test.local", name: "จี", sub: "g-1" });
    expect(a.role_type).toBe("customer");
    const b = await signInWithGoogle({ email: "g1@test.local", name: "จี", sub: "g-1" });
    expect(b.user_id).toBe(a.user_id);

    const s = await accountService.signup(signupInput("pw@test.local"));
    const linked = await signInWithGoogle({ email: "pw@test.local", sub: "g-2" });
    expect(linked.user_id).toBe(s.user_id);
    const u = await userModel.findById(s.user_id).lean<{ auth_provider: string; googleId: string; is_email_verified: boolean }>();
    expect(u).toMatchObject({ auth_provider: "local", googleId: "g-2", is_email_verified: true });
    expect(await userService.verifyCredentials("pw@test.local", "Password123")).toBeTruthy();
  });

  it("LINE: หาจาก line_user_id · ไม่มีอีเมล = อีเมลชั่วคราว แล้วตั้งอีเมลจริง · อีเมลซ้ำบัญชีอื่นไม่ผูกอัตโนมัติ", async () => {
    const a = await signInWithLine({ sub: "U123", name: "ไลน์" });
    const raw = await userModel.findById(a.user_id).lean<{ email: string; line_user_id: string; auth_provider: string }>();
    expect(raw).toMatchObject({ line_user_id: "U123", auth_provider: "line" });
    expect(isPlaceholderEmail(raw!.email)).toBe(true);
    expect(a.email).toBe("");
    expect((await signInWithLine({ sub: "U123" })).user_id).toBe(a.user_id);

    expect((await accountService.emailStatus(a.user_id)).needs_email).toBe(true);
    await accountService.setLineAccountEmail(a.user_id, "line@test.local");
    await accountService.verifyEmail(tokenFromMail());
    expect(await accountService.emailStatus(a.user_id)).toMatchObject({ needs_email: false, email: "line@test.local", email_verified: true });

    await accountService.signup(signupInput("taken@test.local"));
    await expect(signInWithLine({ sub: "U999", email: "taken@test.local" })).rejects.toThrow(/มีบัญชีอยู่แล้ว/);
  });

  it("บัญชีถูกปิด → ล็อกอิน Google/LINE ไม่ได้ · session next-auth ใช้ไม่ได้", async () => {
    const a = await signInWithLine({ sub: "U555" });
    await userModel.updateOne({ _id: a.user_id }, { $set: { is_active: false } });
    await expect(signInWithLine({ sub: "U555" })).rejects.toThrow(/ปิดใช้งาน/);
    await expect(
      assertSessionStillValid({ ...a, source: "nextauth", auth_time: Date.now() })
    ).rejects.toMatchObject({ status: 401 });
  });
});
