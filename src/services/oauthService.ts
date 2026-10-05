/**
 * oauthService — ล็อกอิน/สมัครด้วย Google และ LINE ผ่าน next-auth (หน้าเว็บลูกค้า)
 * ย้ายมาจาก backend ฝั่งลูกค้า (googleController · lineAuthController · docs/customer-backend-merge.md §8.9)
 *
 *   Google: หาจากอีเมล → ผูก googleId ให้บัญชีเดิม (ไม่เปลี่ยน auth_provider — ยังใช้รหัสผ่านได้) · ไม่มี = สร้างลูกค้าใหม่
 *           (อีเมลยืนยันแล้วโดย Google) · บัญชีที่ "สมัครไม่สำเร็จ" ถูก soft delete ไว้ → ใช้เอกสารเดิมซ้ำ (ล้างรหัสผ่านเดิม)
 *   LINE:   หาจาก **line_user_id** เท่านั้น (ผู้ใช้เลือก: ฟิลด์เดียวกับการผูก LINE ของหลัก) · ไม่ผูกบัญชีเดิมจากอีเมลอัตโนมัติ
 *           (ใครก็ตั้งอีเมลใน LINE ให้ตรงคนอื่นได้) · บัญชีใหม่ไม่มีอีเมลจาก LINE → อีเมลชั่วคราว *@line-user.invalid
 *           แล้วให้กรอกอีเมลจริงทีหลัง (accountService.setLineAccountEmail)
 * error ที่ตั้งใจให้ผู้ใช้เห็น (สถานะบัญชี) = OAuthAccountError · อย่างอื่นเป็นปัญหาระบบ
 */
import dbConnect from "../lib/dbConnect";
import userModel from "../models/userModel";
import roleModel from "../models/roleModel";
import type { SessionUser } from "../lib/session";
import { awardWelcomeBonus, safely } from "./pointsService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export class OAuthAccountError extends Error {}

const DELETED_ACCOUNT_MESSAGE = "อีเมลนี้เป็นของบัญชีที่ถูกปิดไปแล้ว กรุณาติดต่อร้าน";
const PLACEHOLDER_DOMAIN = "line-user.invalid";

export const linePlaceholderEmail = (lineId: string) => `line-${lineId.toLowerCase()}@${PLACEHOLDER_DOMAIN}`;
export const isPlaceholderEmail = (email: string | null | undefined) =>
  !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);

export interface OAuthUser extends SessionUser {
  name: string;
  image: string | null;
  profile_completed: boolean;
}

async function customerRole(): Promise<{ _id: unknown; role_type: string }> {
  const role = await roleModel
    .findOne({ role_type: "customer", deleted_at: null, is_active: { $ne: false } })
    .select("_id role_type")
    .lean<{ _id: unknown; role_type: string } | null>();
  if (!role) throw new Error("ไม่พบ role customer");
  return role;
}

function assertUsable(user: any): void {
  if (user.deleted_at) throw new OAuthAccountError(DELETED_ACCOUNT_MESSAGE);
  if (user.is_active === false) throw new OAuthAccountError("บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อร้าน");
  if (user.lockout_until && Date.now() < new Date(user.lockout_until).getTime()) {
    const minutes = Math.ceil((new Date(user.lockout_until).getTime() - Date.now()) / 60000);
    throw new OAuthAccountError(`บัญชีถูกล็อก กรุณารอ ${minutes} นาที`);
  }
}

async function toOAuthUser(userId: unknown): Promise<OAuthUser> {
  const user = await userModel
    .findById(userId)
    .populate("role_id", "role_type")
    .lean<any>();
  const roleType = user?.role_id?.role_type === "admin" ? "owner" : user?.role_id?.role_type;
  if (!user || !roleType) throw new Error("บัญชีไม่มีบทบาท (role)");
  return {
    user_id: String(user._id),
    role_id: String(user.role_id._id),
    role_type: roleType,
    email: isPlaceholderEmail(user.email) ? "" : user.email,
    name: user.user_fullname,
    image: user.user_img ?? null,
    profile_completed: !!(user.user_phone && user.user_birthdate),
  };
}

const isAbandoned = (u: any) =>
  !!u?.deleted_at && u.is_email_verified !== true && !u.last_login_at && !u.googleId && !u.line_user_id;

export async function signInWithGoogle(profile: {
  email: string;
  name?: string | null;
  sub: string;
  picture?: string | null;
  email_verified?: boolean;
}): Promise<OAuthUser> {
  await dbConnect();
  const email = String(profile.email ?? "").trim().toLowerCase();
  if (!email) throw new OAuthAccountError("บัญชี Google นี้ไม่มีอีเมล");
  if (profile.email_verified === false) throw new OAuthAccountError("อีเมลของบัญชี Google นี้ยังไม่ได้ยืนยัน");
  const googleId = String(profile.sub);
  const now = new Date();

  const candidates = await userModel.find({ email }).lean<any[]>();
  const active = candidates.find((u) => !u.deleted_at);
  if (active) {
    assertUsable(active);
    await userModel.updateOne(
      { _id: active._id },
      { $set: { googleId: active.googleId || googleId, is_email_verified: true, last_login_at: now } }
    );
    return toOAuthUser(active._id);
  }

  const role = await customerRole();
  const fields = {
    user_fullname: profile.name?.trim() || email,
    email,
    password: null,
    googleId,
    auth_provider: "google",
    role_id: role._id,
    user_img: profile.picture || null,
    is_email_verified: true,
    is_active: true,
    last_login_at: now,
  };
  const abandoned = candidates.find(isAbandoned);
  if (abandoned) {
    // รหัสผ่านที่ตั้งไว้ตอนสมัครไม่สำเร็จอาจไม่ใช่ของเจ้าของอีเมลจริง (Google เพิ่งยืนยันตัวตน) → ล้างทิ้งทั้งหมด
    await userModel.updateOne(
      { _id: abandoned._id },
      {
        $set: {
          ...fields, deleted_at: null, user_phone: null, user_birthdate: null, user_allergies: [],
          email_verify_token: null, verification_token_expiry: null, failed_login_attempts: 0, lockout_until: null,
        },
      }
    );
    // Google ยืนยันอีเมลให้แล้ว → โบนัสสมาชิกใหม่ทันที (§8.11)
    await safely("welcome", () => awardWelcomeBonus(String(abandoned._id)));
    return toOAuthUser(abandoned._id);
  }
  if (candidates.length) throw new OAuthAccountError(DELETED_ACCOUNT_MESSAGE);
  const created = await userModel.create(fields);
  await safely("welcome", () => awardWelcomeBonus(String(created._id)));
  return toOAuthUser(created._id);
}

export async function signInWithLine(profile: {
  sub: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
}): Promise<OAuthUser> {
  await dbConnect();
  const lineId = String(profile.sub ?? "").trim();
  if (!lineId) throw new Error("LINE profile ไม่มี sub");

  const existing = await userModel.findOne({ line_user_id: lineId, deleted_at: null }).lean<any>();
  if (existing) {
    assertUsable(existing);
    await userModel.updateOne({ _id: existing._id }, { $set: { last_login_at: new Date() } });
    return toOAuthUser(existing._id);
  }

  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  if (email && (await userModel.exists({ email, deleted_at: null }))) {
    throw new OAuthAccountError(
      'อีเมลของ LINE นี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม แล้วกด "เชื่อมต่อ LINE" ในหน้าบัญชีของคุณ'
    );
  }
  const role = await customerRole();
  const created = await userModel.create({
    user_fullname: (profile.name ?? "").trim() || "ลูกค้า LINE",
    email: email || linePlaceholderEmail(lineId),
    password: null,
    line_user_id: lineId,
    auth_provider: "line",
    role_id: role._id,
    user_img: profile.picture || null,
    // อีเมลจาก LINE ยังไม่ถือว่ายืนยัน — ยืนยันผ่านลิงก์ (accountService.setLineAccountEmail)
    is_email_verified: false,
    is_active: true,
    last_login_at: new Date(),
  });
  return toOAuthUser(created._id);
}
