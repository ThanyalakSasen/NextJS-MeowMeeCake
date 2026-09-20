import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import { BCRYPT_ROUNDS } from "../src/services/userService";
import userModel from "../src/models/userModel";

/**
 * รีเซ็ตรหัสผ่านของ user คนเดียว (ดีฟอลต์ = บัญชี owner) ตรง ๆ ใน DB
 * ใช้ตอนลืมรหัสผ่านจริง แล้วยังไม่มี route /api/auth/forgot-password ให้ใช้
 *
 * รัน: npx tsx scripts/reset-owner-password.ts [email] <new-password>
 *   ไม่ใส่ email = ใช้ค่า default ด้านล่าง
 *
 * ปลดล็อกบัญชีให้ด้วยเสมอ (ล้าง failed_login_attempts + lockout_until เหมือน userService.unlockUser)
 * — ตอนบัญชีถูกล็อก (ผิด 5 ครั้ง → ล็อก 15 นาที) userService.verifyCredentials() ปฏิเสธด้วย 423 "ก่อน" ตรวจรหัสผ่าน
 * ต่อให้ใส่รหัสใหม่ถูกก็เข้าไม่ได้ รีเซ็ตรหัสอย่างเดียวจึงไม่พอ
 * ไม่แตะ is_active (บัญชีที่ถูกระงับต้องเปิดผ่านหน้าจัดการพนักงานเอง ไม่ใช่งานของสคริปต์นี้)
 */
const DEFAULT_EMAIL = "thanyalak.sas@kkumail.com";

export interface ResetResult {
  found: boolean;
  /** บัญชีถูกล็อกอยู่ตอนก่อนรีเซ็ตหรือไม่ (lockout_until ยังไม่หมดเวลา) */
  wasLocked: boolean;
  /** ถ้ายังไม่ถูกล็อกแต่มีจำนวนครั้งที่ผิดสะสมอยู่ */
  hadFailedAttempts: boolean;
  /** บัญชีถูกระงับ (is_active = false) — สคริปต์ไม่ได้เปิดให้ ผู้เรียกควรเตือน */
  suspended: boolean;
}

/**
 * ตั้งรหัสผ่านใหม่ + ปลดล็อกบัญชี — แยกออกมาจาก main() ของ CLI เพื่อให้ integration test import ไปเรียกตรง ๆ ได้
 * โดยไม่โดน side effect ของ main() (mongoose.disconnect() ตอนจบ)
 */
export async function resetPassword(email: string, password: string): Promise<ResetResult> {
  await dbConnect();

  const filter = { email: email.toLowerCase().trim() };
  const user = await userModel
    .findOne(filter)
    .select("lockout_until failed_login_attempts is_active")
    .lean<{ lockout_until?: Date | null; failed_login_attempts?: number; is_active?: boolean }>();
  if (!user) return { found: false, wasLocked: false, hadFailedAttempts: false, suspended: false };

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await userModel.updateOne(
    filter,
    { $set: { password: hashed, failed_login_attempts: 0, lockout_until: null } }
  );

  return {
    found: true,
    wasLocked: !!user.lockout_until && new Date(user.lockout_until).getTime() > Date.now(),
    hadFailedAttempts: (user.failed_login_attempts ?? 0) > 0,
    suspended: user.is_active === false,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const [email, password] = args.length >= 2 ? args : [DEFAULT_EMAIL, args[0]];

  if (!password || password.length < 8) {
    console.error("ใช้งาน: npx tsx scripts/reset-owner-password.ts [email] <new-password>");
    console.error("(new-password ต้องยาวอย่างน้อย 8 ตัวอักษร)");
    process.exitCode = 1;
    return;
  }

  const result = await resetPassword(email, password);

  if (!result.found) {
    console.error(`ไม่พบ user ที่ email: ${email}`);
    process.exitCode = 1;
    return;
  }

  console.log(`ตั้งรหัสผ่านใหม่ให้ ${email} สำเร็จ`);
  if (result.wasLocked) console.log("ปลดล็อกบัญชีแล้ว (บัญชีถูกล็อกจากการเข้าสู่ระบบผิดหลายครั้ง)");
  else if (result.hadFailedAttempts) console.log("ล้างจำนวนครั้งที่เข้าสู่ระบบผิดแล้ว");
  if (result.suspended) {
    console.warn("⚠️  บัญชีนี้ถูกระงับ (is_active = false) — ยังเข้าสู่ระบบไม่ได้ ต้องเปิดใช้งานผ่านหน้าจัดการพนักงาน");
  }
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI — ไม่รันตอนถูก import ไปใช้จากที่อื่น (เช่น integration test)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .catch((err) => {
      console.error("\nreset-owner-password ล้มเหลว:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
