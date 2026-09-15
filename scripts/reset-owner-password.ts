import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dbConnect from "../src/lib/dbConnect";
import userModel from "../src/models/userModel";

/**
 * รีเซ็ตรหัสผ่านของ user คนเดียว (ดีฟอลต์ = บัญชี owner) ตรง ๆ ใน DB
 * ใช้ตอนลืมรหัสผ่านจริง แล้วยังไม่มี route /api/auth/forgot-password ให้ใช้
 *
 * รัน: npx tsx scripts/reset-owner-password.ts [email] <new-password>
 *   ไม่ใส่ email = ใช้ค่า default ด้านล่าง
 */
const DEFAULT_EMAIL = "thanyalak.sas@kkumail.com";

async function main() {
  const args = process.argv.slice(2);
  const [email, password] = args.length >= 2 ? args : [DEFAULT_EMAIL, args[0]];

  if (!password || password.length < 8) {
    console.error("ใช้งาน: npx tsx scripts/reset-owner-password.ts [email] <new-password>");
    console.error("(new-password ต้องยาวอย่างน้อย 8 ตัวอักษร)");
    process.exitCode = 1;
    return;
  }

  await dbConnect();

  const hashed = await bcrypt.hash(password, 10);
  const result = await userModel.updateOne(
    { email: email.toLowerCase() },
    { $set: { password: hashed } }
  );

  if (result.matchedCount === 0) {
    console.error(`ไม่พบ user ที่ email: ${email}`);
    process.exitCode = 1;
    return;
  }

  console.log(`ตั้งรหัสผ่านใหม่ให้ ${email} สำเร็จ`);
}

main()
  .catch((err) => {
    console.error("\nreset-owner-password ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
