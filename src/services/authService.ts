/**
 * authService — เข้าสู่ระบบ / สมัครสมาชิก / ออก session token
 *
 * ตรรกะการตรวจรหัสผ่าน + นับ failed login อยู่ใน userService.verifyCredentials() แล้ว
 * ที่นี่ทำหน้าที่: แปลง user → SessionUser → เซ็น JWT + เขียน userLog
 */
import { jwtVerify, createRemoteJWKSet } from "jose";
import { badRequest, forbidden } from "../lib/httpError";
import { signSession } from "../lib/jwt";
import type { SessionUser } from "../lib/session";
import * as userService from "./userService";
import * as userLogService from "./userLogService";
import userModel from "../models/userModel";
import roleModel from "../models/roleModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── helper: user (lean/plain) → SessionUser ─────────────────
async function toSessionUser(user: any): Promise<SessionUser> {
  const roleId = String(user?.role_id?._id ?? user?.role_id ?? "");
  let roleType: string | undefined = user?.role_id?.role_type;
  if (!roleType && roleId) {
    const role = await roleModel.findById(roleId).lean<any>();
    roleType = role?.role_type;
  }
  if (!roleType) throw badRequest("บัญชีนี้ยังไม่ได้กำหนดบทบาท (role)");
  return {
    user_id: String(user._id),
    role_id: roleId,
    role_type: roleType as SessionUser["role_type"],
    email: user.email,
  };
}

async function issue(user: any) {
  const session = await toSessionUser(user);
  const token = await signSession(session);
  return { session, token };
}

// ── LOGIN (email + password) ───────────────────────────────
export async function login(email: string, password: string, ctx: { ip?: string | null } = {}) {
  const user = await userService.verifyCredentials(email, password); // throw ถ้าผิด/ถูกล็อก
  const { session, token } = await issue(user);
  await userLogService.writeLog({
    user_id: session.user_id,
    action: "เข้าสู่ระบบ",
    action_type: "LOGIN",
    ip_address: ctx.ip ?? null,
  });
  const safeUser = await userService.getUserById(session.user_id);
  return { user: safeUser, token, session };
}

// ── REGISTER (ลูกค้าสมัครเอง) ──────────────────────────────
export interface RegisterInput {
  user_fullname: string;
  email: string;
  password: string;
  user_phone?: string | null;
}

export async function register(input: RegisterInput, ctx: { ip?: string | null } = {}) {
  const role = await roleModel.findOne({ role_name: "customer", deleted_at: null }).lean<any>();
  if (!role) throw badRequest("ระบบยังไม่ได้ตั้งค่าบทบาท 'customer' (รัน npm run seed)");

  const user = await userService.createUser({
    user_fullname: input.user_fullname,
    email: input.email,
    password: input.password,
    user_phone: input.user_phone ?? null,
    auth_provider: "local",
    role_id: String(role._id),
  });

  const { session, token } = await issue({ ...user, role_id: role });
  await userLogService.writeLog({
    user_id: session.user_id,
    action: "สมัครสมาชิก",
    action_type: "CREATE",
    entity: "User",
    entity_id: session.user_id,
    ip_address: ctx.ip ?? null,
  });
  return { user, token, session };
}

export async function me(session: SessionUser) {
  return userService.getUserById(session.user_id);
}

// ── LOGIN ด้วย Google (รับ ID token จาก Google Identity Services) ──
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

export async function loginWithGoogle(credential: string, ctx: { ip?: string | null } = {}) {
  if (!credential) throw badRequest("ไม่พบ credential จาก Google");
  if (!process.env.GOOGLE_CLIENT_ID) throw badRequest("ระบบยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID");

  let claims: any;
  try {
    const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    claims = payload;
  } catch {
    throw badRequest("credential จาก Google ไม่ถูกต้องหรือหมดอายุ");
  }

  const googleId = String(claims.sub);
  const email = String(claims.email ?? "").toLowerCase();
  const name = String(claims.name ?? email);
  if (!email) throw badRequest("บัญชี Google นี้ไม่มีอีเมล");
  // Google บอกว่าอีเมลนี้ยังไม่ยืนยัน → ไม่ให้ผูก/สร้างบัญชีด้วยอีเมลนี้ (กันสวมสิทธิ์)
  if (claims.email_verified === false) throw badRequest("อีเมลของบัญชี Google นี้ยังไม่ได้ยืนยัน");

  let user: any = await userModel
    .findOne({ $or: [{ googleId }, { email }], deleted_at: null })
    .lean();

  if (user) {
    if (!user.is_active) throw forbidden("บัญชีนี้ถูกระงับการใช้งาน");
    if (!user.googleId) {
      await userModel.updateOne(
        { _id: user._id },
        { $set: { googleId, is_email_verified: true } }
      );
    }
  } else {
    const role = await roleModel.findOne({ role_name: "customer", deleted_at: null }).lean<any>();
    if (!role) throw badRequest("ระบบยังไม่ได้ตั้งค่าบทบาท 'customer'");
    user = await userService.createUser({
      user_fullname: name,
      email,
      auth_provider: "google",
      googleId,
      role_id: String(role._id),
    });
  }

  const { session, token } = await issue(user);
  await userLogService.writeLog({
    user_id: session.user_id,
    action: "เข้าสู่ระบบผ่าน Google",
    action_type: "LOGIN",
    ip_address: ctx.ip ?? null,
  });
  const safeUser = await userService.getUserById(session.user_id);
  return { user: safeUser, token, session };
}
