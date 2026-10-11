import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import roleModel from "@/models/roleModel";
import { ACCOUNT_LOCKED, LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS, verifyCredentials } from "@/services/userService";
import { makeUser } from "./helpers";

/** error ที่ verifyCredentials โยน — HttpError + details ของ 423 */
type LockError = { status: number; message: string; details: { reason: string; lockout_until: string; retry_after_seconds: number } };

/**
 * ล็อกบัญชีหลังใส่รหัสผิดครบ MAX_FAILED_ATTEMPTS — 423 ต้องบอกเวลาปลดล็อก (details) ให้หน้า login นับถอยหลังได้
 * และครั้งที่ทำให้ล็อกต้องตอบ 423 ทันที (เดิมตอบ 401 "รหัสผิด" ผู้ใช้เพิ่งรู้ว่าโดนล็อกตอนลองครั้งถัดไป)
 */
describe("verifyCredentials — ล็อกบัญชี", () => {
  async function makeLocalUser(over: Record<string, unknown> = {}) {
    const role = await roleModel.create({ role_name: `owner-${Date.now()}-${Math.random()}`, role_type: "owner" });
    return makeUser({ role_id: role._id, password: await bcrypt.hash("right-password-1", 4), ...over });
  }

  it("ผิดครั้งที่ทำให้ล็อก → 423 + reason/lockout_until/retry_after_seconds", async () => {
    const user = await makeLocalUser({ failed_login_attempts: MAX_FAILED_ATTEMPTS - 1 });
    const err: LockError = await verifyCredentials(user.email, "wrong-password").catch((e) => e);
    expect(err.status).toBe(423);
    expect(err.details.reason).toBe(ACCOUNT_LOCKED);
    expect(err.details.retry_after_seconds).toBeGreaterThan(LOCKOUT_MINUTES * 60 - 5);
    expect(new Date(err.details.lockout_until).getTime()).toBeGreaterThan(Date.now());
  });

  it("ยังล็อกอยู่ → 423 บอกเวลาที่เหลือจริง (ไม่รีเซ็ตเป็น 15 นาทีใหม่)", async () => {
    const until = new Date(Date.now() + 3 * 60_000);
    const user = await makeLocalUser({ lockout_until: until });
    const err: LockError = await verifyCredentials(user.email, "right-password-1").catch((e) => e);
    expect(err.status).toBe(423);
    expect(err.details.lockout_until).toBe(until.toISOString());
    expect(err.details.retry_after_seconds).toBeLessThanOrEqual(180);
    expect(err.message).toContain("3 นาที");
  });

  it("ผิดแต่ยังไม่ครบ → 401 เหมือนเดิม", async () => {
    const user = await makeLocalUser({ failed_login_attempts: 0 });
    await expect(verifyCredentials(user.email, "wrong-password")).rejects.toMatchObject({ status: 401 });
  });
});
