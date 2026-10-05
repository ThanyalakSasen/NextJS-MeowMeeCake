/**
 * accountService — สมัครสมาชิกแบบยืนยันอีเมล · ยืนยันอีเมล · ลืมรหัสผ่าน / ตั้งรหัสใหม่
 * ย้ายมาจาก backend ฝั่งลูกค้า (authController · docs/customer-backend-merge.md §8.9)
 *
 * กติกา (ผู้ใช้เลือก 2026-10-05):
 *   - สมัครแล้ว **ไม่ล็อกอินให้** — ส่งลิงก์ยืนยัน (24 ชม.) · ส่งอีเมลไม่ได้ = ยกเลิกการสมัคร (soft delete) สมัครใหม่ได้
 *   - ลูกค้าที่ยังไม่ยืนยันอีเมลล็อกอินด้วยรหัสผ่านไม่ได้ (userService.verifyCredentials) · พนักงาน/เจ้าของร้านไม่กระทบ
 *   - ลืมรหัสผ่าน: ลิงก์ 1 ชม. ใช้ครั้งเดียว · ตอบเหมือนกันไม่ว่าอีเมลจะมีในระบบไหม (กันเดาอีเมล)
 *   - ตั้งรหัสใหม่ → password_changed_at = ตอนนี้ (session next-auth เดิมทุกเครื่องหลุด — authGuard)
 * token เก็บใน DB เป็น SHA-256 · ยังรับ token ดิบที่ backend ฝั่งลูกค้าออกไว้ก่อนย้าย (ช่วงเปลี่ยนผ่าน)
 */
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, HttpError } from "../lib/httpError";
import { log } from "../lib/logger";
import { sendResetPasswordEmail, sendVerificationEmail } from "../lib/mailer";
import userModel from "../models/userModel";
import roleModel from "../models/roleModel";
import { assertPasswordStrength, hashPassword } from "./userService";
import { isPlaceholderEmail } from "./oauthService";
import { awardWelcomeBonus, safely } from "./pointsService";

/* eslint-disable @typescript-eslint/no-explicit-any */

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
/** token ใหม่ (ส่งในอีเมล) + ค่าที่เก็บ DB */
function newToken(): { token: string; stored: string } {
  const token = randomBytes(32).toString("hex");
  return { token, stored: hashToken(token) };
}
/** ค่าใน DB ที่ตรงกับ token นี้ — hash (ออกโดยหลัก) หรือ token ดิบ (ออกโดยฝั่งลูกค้าก่อนย้าย) */
const tokenCandidates = (token: string) => [hashToken(token), token];

async function customerRoleId(): Promise<unknown> {
  const role = await roleModel
    .findOne({ role_type: "customer", deleted_at: null, is_active: { $ne: false } })
    .select("_id")
    .lean<{ _id: unknown } | null>();
  if (!role) throw new HttpError("ระบบยังไม่พร้อมรับสมัครสมาชิก กรุณาลองใหม่ภายหลัง", 500, "BAD_REQUEST");
  return role._id;
}

export interface SignupInput {
  user_fullname: string;
  email: string;
  password: string;
  user_phone?: string | null;
  user_birthdate?: Date | null;
  user_allergies?: string[];
}

/**
 * สมัครสมาชิก (ลูกค้า) — สร้างบัญชียังไม่ยืนยัน แล้วส่งลิงก์ยืนยัน · ไม่ออก session
 * อีเมลซ้ำกับบัญชีที่ใช้งานอยู่ = 409 · บัญชีที่ "สมัครไม่สำเร็จ" ถูก soft delete ไว้ (ไม่เคยยืนยัน/ล็อกอิน) → ใช้เอกสารเดิมซ้ำ
 */
export async function signup(input: SignupInput) {
  await dbConnect();
  assertPasswordStrength(input.password);
  const email = input.email.trim().toLowerCase();
  const role_id = await customerRoleId();

  const existing = await userModel
    .find({ email })
    .select("deleted_at is_email_verified last_login_at googleId line_user_id")
    .lean<any[]>();
  if (existing.some((u) => !u.deleted_at)) {
    throw conflict("อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบหรือใช้อีเมลอื่น");
  }
  const abandoned = existing.find(
    (u) => u.deleted_at && u.is_email_verified !== true && !u.last_login_at && !u.googleId && !u.line_user_id
  );

  const { token, stored } = newToken();
  const fields = {
    user_fullname: input.user_fullname.trim(),
    email,
    password: await hashPassword(input.password),
    auth_provider: "local",
    role_id,
    user_phone: input.user_phone ?? null,
    user_birthdate: input.user_birthdate ?? null,
    user_allergies: input.user_allergies ?? [],
    is_email_verified: false,
    email_verify_token: stored,
    verification_token_expiry: new Date(Date.now() + VERIFY_TTL_MS),
    is_active: true,
    failed_login_attempts: 0,
    lockout_until: null,
  };

  let user: any;
  try {
    user = abandoned
      ? await userModel.findOneAndUpdate(
          { _id: abandoned._id, deleted_at: { $ne: null } },
          { $set: { ...fields, deleted_at: null } },
          { returnDocument: "after" }
        )
      : await userModel.create(fields);
  } catch (err: any) {
    if (err?.code === 11000) throw conflict("อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบหรือใช้อีเมลอื่น");
    throw err;
  }
  if (!user) throw conflict("อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบหรือใช้อีเมลอื่น");

  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    log.error("account.signup_email_failed", { user_id: String(user._id), err });
    // ส่งไม่ได้ → ยกเลิกการสมัคร (soft delete — สมัครใหม่ด้วยอีเมลเดิมได้)
    await userModel.updateOne(
      { _id: user._id },
      { $set: { deleted_at: new Date(), is_active: false, email_verify_token: null, verification_token_expiry: null } }
    );
    throw new HttpError("ไม่สามารถส่งอีเมลยืนยันได้ กรุณาลองใหม่", 502, "BAD_REQUEST");
  }
  return { user_id: String(user._id), email, message: "สมัครสมาชิกสำเร็จ กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชี" };
}

/** ยืนยันอีเมลจากลิงก์ */
export async function verifyEmail(token: unknown) {
  if (typeof token !== "string" || !token) throw badRequest("ไม่พบ token");
  await dbConnect();
  const user = await userModel
    .findOne({ email_verify_token: { $in: tokenCandidates(token) }, is_email_verified: { $ne: true }, deleted_at: null })
    .select("verification_token_expiry")
    .lean<{ _id: unknown; verification_token_expiry?: Date | null } | null>();
  if (!user) throw badRequest("Token ไม่ถูกต้องหรือยืนยันแล้ว");
  if (user.verification_token_expiry && Date.now() > new Date(user.verification_token_expiry).getTime()) {
    throw badRequest("ลิงก์ยืนยันหมดอายุแล้ว กรุณาขอส่งอีเมลยืนยันใหม่");
  }
  await userModel.updateOne(
    { _id: user._id },
    { $set: { is_email_verified: true, email_verify_token: null, verification_token_expiry: null } }
  );
  // โบนัสสมาชิกใหม่ให้ตอนยืนยันอีเมล (ไม่ใช่ตอนสมัคร — กันสมัครด้วยอีเมลปลอมเก็บแต้ม · §8.11)
  await safely("welcome", () => awardWelcomeBonus(String(user._id)));
  return { message: "ยืนยันอีเมลสำเร็จ" };
}

/**
 * ขอส่งอีเมลยืนยันใหม่ (ลิงก์หมดอายุ / ลูกค้าเก่าที่สมัครก่อนบังคับยืนยัน) — ตอบเหมือนกันทุกกรณี (กันเดาอีเมล)
 */
export async function resendVerification(rawEmail: unknown) {
  const generic = { message: "หากอีเมลนี้มีบัญชีที่ยังไม่ยืนยัน เราได้ส่งลิงก์ยืนยันไปแล้ว" };
  if (typeof rawEmail !== "string" || !rawEmail.trim()) throw badRequest("กรุณากรอกอีเมล");
  await dbConnect();
  const user = await userModel
    .findOne({ email: rawEmail.trim().toLowerCase(), deleted_at: null, is_active: { $ne: false }, is_email_verified: { $ne: true } })
    .select("email")
    .lean<{ _id: unknown; email: string } | null>();
  if (!user || isPlaceholderEmail(user.email)) return generic;
  const { token, stored } = newToken();
  await userModel.updateOne(
    { _id: user._id },
    { $set: { email_verify_token: stored, verification_token_expiry: new Date(Date.now() + VERIFY_TTL_MS) } }
  );
  try {
    await sendVerificationEmail(user.email, token);
  } catch (err) {
    log.error("account.resend_email_failed", { user_id: String(user._id), err });
    throw new HttpError("ไม่สามารถส่งอีเมลได้ กรุณาลองใหม่", 502, "BAD_REQUEST");
  }
  return generic;
}

/** ขอลิงก์รีเซ็ตรหัสผ่าน — ไม่บอกว่าอีเมลมีในระบบไหม · บัญชี Google/LINE ที่ไม่มีรหัสผ่าน = 400 (แบบฝั่งลูกค้า) */
export async function requestPasswordReset(rawEmail: unknown) {
  const generic = { message: "หากอีเมลนี้มีในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปแล้ว" };
  if (typeof rawEmail !== "string" || !rawEmail.trim()) throw badRequest("กรุณากรอกอีเมล");
  await dbConnect();
  const user = await userModel
    .findOne({ email: rawEmail.trim().toLowerCase(), deleted_at: null, is_active: { $ne: false } })
    .select("password email user_fullname auth_provider")
    .lean<{ _id: unknown; email: string; user_fullname?: string; auth_provider?: string; password?: string | null } | null>();
  if (!user) return generic;
  if (!user.password) {
    throw badRequest(
      user.auth_provider === "line"
        ? "ไม่สามารถเปลี่ยนรหัสผ่านได้เนื่องจากบัญชีนี้สมัครด้วย LINE กรุณาเข้าสู่ระบบด้วย LINE"
        : "ไม่สามารถเปลี่ยนรหัสผ่านได้เนื่องจากบัญชีนี้สมัครด้วย Google"
    );
  }
  const { token, stored } = newToken();
  await userModel.updateOne(
    { _id: user._id },
    { $set: { reset_password_token: stored, reset_password_token_expiry: new Date(Date.now() + RESET_TTL_MS) } }
  );
  try {
    await sendResetPasswordEmail(user.email, token, user.user_fullname ?? "");
  } catch (err) {
    log.error("account.reset_email_failed", { user_id: String(user._id), err });
    throw new HttpError("ไม่สามารถส่งอีเมลได้ กรุณาลองใหม่", 502, "BAD_REQUEST");
  }
  return generic;
}

async function findByResetToken(token: string) {
  return userModel
    .findOne({
      reset_password_token: { $in: tokenCandidates(token) },
      reset_password_token_expiry: { $gt: new Date() },
      deleted_at: null,
    })
    .select("+password");
}

/** ลิงก์รีเซ็ตยังใช้ได้ไหม (หน้าเว็บเช็คก่อนแสดงฟอร์ม) */
export async function checkResetToken(token: unknown) {
  if (typeof token !== "string" || !token) throw badRequest("ไม่พบ token");
  await dbConnect();
  if (!(await findByResetToken(token))) throw badRequest("ลิงก์หมดอายุหรือถูกใช้งานแล้ว");
  return { message: "Token ถูกต้อง" };
}

/** ตั้งรหัสผ่านใหม่จากลิงก์ — ใช้ได้ครั้งเดียว · ห้ามซ้ำรหัสเดิม · ปลดล็อกบัญชี · ตัด session เดิม */
export async function resetPassword(token: unknown, newPassword: unknown) {
  // ต้องเป็น string เท่านั้น — กัน object เช่น { "$ne": "" } กลายเป็น query operator (NoSQL injection)
  if (typeof token !== "string" || typeof newPassword !== "string" || !token || !newPassword) {
    throw badRequest("ข้อมูลไม่ครบ");
  }
  assertPasswordStrength(newPassword);
  await dbConnect();
  const user = await findByResetToken(token);
  if (!user) throw badRequest("ลิงก์หมดอายุหรือถูกใช้งานแล้ว กรุณาขอลิงก์ใหม่");
  if (user.password && (await bcrypt.compare(newPassword, user.password))) {
    throw badRequest("ไม่สามารถใช้รหัสผ่านเดิมได้ กรุณาตั้งรหัสผ่านใหม่");
  }
  await userModel.updateOne(
    { _id: user._id },
    {
      $set: {
        password: await hashPassword(newPassword),
        password_changed_at: new Date(),
        failed_login_attempts: 0,
        lockout_until: null,
        reset_password_token: null,
        reset_password_token_expiry: null,
      },
    }
  );
  return { message: "เปลี่ยนรหัสผ่านสำเร็จ" };
}

// ── บัญชีที่สมัครด้วย LINE: ตั้งอีเมลจริง (ย้ายมาจากฝั่งลูกค้า lineAuthController.setLineAccountEmail) ──
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** สถานะอีเมลของบัญชี — หน้าเว็บใช้ตัดสินว่าต้องให้ลูกค้ากรอกอีเมลจริงไหม (บัญชี LINE ที่ใช้อีเมลชั่วคราว) */
export async function emailStatus(userId: string) {
  await dbConnect();
  const user = await userModel
    .findOne({ _id: userId, deleted_at: null })
    .select("email is_email_verified auth_provider line_user_id")
    .lean<{ email: string; is_email_verified?: boolean; auth_provider: string; line_user_id?: string | null } | null>();
  if (!user) throw badRequest("ไม่พบบัญชี");
  const needsEmail = isPlaceholderEmail(user.email);
  return {
    auth_provider: user.auth_provider,
    line_linked: !!user.line_user_id,
    needs_email: needsEmail,
    email: needsEmail ? null : user.email,
    email_verified: !needsEmail && user.is_email_verified === true,
  };
}

/**
 * บัญชีที่สมัครด้วย LINE ตั้ง/แก้อีเมลจริง (ได้เฉพาะตอนอีเมลยังไม่ถูกยืนยัน) แล้วส่งลิงก์ยืนยันไปที่อีเมลนั้น
 * อีเมลซ้ำกับบัญชีอื่น = 409 (ให้ล็อกอินบัญชีเดิมแล้วกดเชื่อมต่อ LINE แทน)
 */
export async function setLineAccountEmail(userId: string, rawEmail: unknown) {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email) || isPlaceholderEmail(email)) {
    throw badRequest("กรุณากรอกอีเมลให้ถูกต้อง");
  }
  await dbConnect();
  const user = await userModel.findOne({ _id: userId, deleted_at: null });
  if (!user) throw badRequest("ไม่พบบัญชี");
  if (user.auth_provider !== "line") throw badRequest("บัญชีนี้ไม่ได้สมัครด้วย LINE");
  if (user.is_email_verified && !isPlaceholderEmail(user.email)) throw badRequest("อีเมลของบัญชีนี้ยืนยันแล้ว");
  if (await userModel.exists({ email, _id: { $ne: user._id }, deleted_at: null })) {
    throw conflict('อีเมลนี้มีบัญชีอยู่แล้ว — ถ้าเป็นบัญชีของคุณ ให้เข้าสู่ระบบด้วยอีเมลนั้น แล้วกด "เชื่อมต่อ LINE" ในหน้าบัญชี');
  }
  const { token, stored } = newToken();
  user.email = email;
  user.is_email_verified = false;
  user.email_verify_token = stored;
  user.verification_token_expiry = new Date(Date.now() + VERIFY_TTL_MS);
  await user.save();
  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    log.error("account.line_email_failed", { user_id: userId, err });
    return { message: "บันทึกอีเมลแล้ว แต่ส่งอีเมลยืนยันไม่สำเร็จ กรุณาขอส่งใหม่อีกครั้ง" };
  }
  return { message: "บันทึกอีเมลแล้ว — กรุณากดลิงก์ยืนยันในอีเมล (ภายใน 24 ชั่วโมง)" };
}
