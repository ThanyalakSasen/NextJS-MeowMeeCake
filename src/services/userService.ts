/**
 * userService — จัดการผู้ใช้ (Users) ทั้งลูกค้าและพนักงาน + ตรรกะการยืนยันตัวตน
 *
 * - CRUD โปรไฟล์ผู้ใช้ (soft delete ผ่าน deleted_at)
 * - จัดการรหัสผ่าน (hash ด้วย bcryptjs — model ไม่มี pre-save hook จึงต้องทำที่ชั้นนี้)
 * - verifyCredentials(): ตรวจอีเมล/รหัสผ่าน พร้อมนับ failed_login_attempts และ lockout
 *
 * หมายเหตุ: service นี้ไม่ยุ่งกับ session/JWT/cookie — route handler (controller) เป็นผู้จัดการ
 */
import bcrypt from "bcryptjs";
import dbConnect from "../lib/dbConnect";
import { badRequest, forbidden, notFound, unauthorized, HttpError } from "../lib/httpError";
import { assertObjectId, pick } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import userModel from "../models/userModel";
import roleModel from "../models/roleModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── ค่าคงที่นโยบายรหัสผ่าน / การล็อกบัญชี ─────────────────────
export const BCRYPT_ROUNDS = 10;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

// ── ฟิลด์ลับที่ห้ามส่งกลับออก API และห้ามให้เขียนผ่าน CRUD ปกติ ──
const SECRET_FIELDS = [
  "password",
  "email_verify_token",
  "verification_token_expiry",
  "reset_password_token",
  "reset_password_token_expiry",
] as const;

const SELECT_PUBLIC = SECRET_FIELDS.map((f) => `-${f}`).join(" ");

const PROFILE_FIELDS = [
  "user_fullname",
  "user_birthdate",
  "user_phone",
  "user_img",
  "user_allergies",
] as const;

const EMPLOYMENT_FIELDS = [
  "start_working_date",
  "last_working_date",
  "employment_type",
  "emp_salary",
  "part_time_hours",
  "emp_status",
] as const;

// ── Types ────────────────────────────────────────────────────
export interface CreateUserInput {
  user_fullname: string;
  email: string;
  auth_provider: "local" | "google";
  role_id: string;
  password?: string;
  googleId?: string;
  user_birthdate?: string | Date | null;
  user_phone?: string | null;
  user_img?: string | null;
  user_allergies?: string[];
  is_active?: boolean;
  start_working_date?: string | Date | null;
  employment_type?: "full_time" | "part_time" | null;
  emp_salary?: number | null;
  part_time_hours?: number | null;
  emp_status?: boolean | null;
}

export interface ListUserQuery {
  pagination: Pagination;
  search?: string;
  role_id?: string;
  is_active?: boolean;
  employment_type?: "full_time" | "part_time";
  includeDeleted?: boolean;
  sort?: Record<string, 1 | -1>;
}

// ── Helpers ──────────────────────────────────────────────────
function stripSecrets<T extends Record<string, any>>(doc: T): Partial<T> {
  const clone: Record<string, any> = { ...doc };
  for (const f of SECRET_FIELDS) delete clone[f];
  return clone as Partial<T>;
}

function assertPasswordStrength(pw: string): void {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`);
  }
}

function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

// ── CREATE ───────────────────────────────────────────────────
export async function createUser(input: CreateUserInput) {
  await dbConnect();

  for (const field of ["user_fullname", "email", "auth_provider", "role_id"] as const) {
    if (!input[field]) throw badRequest(`กรุณาระบุ ${field}`);
  }
  if (!["local", "google"].includes(input.auth_provider)) {
    throw badRequest('auth_provider ต้องเป็น "local" หรือ "google"');
  }
  await assertRefExists(roleModel, input.role_id, "บทบาท", "role_id");

  const payload: Record<string, any> = {
    user_fullname: input.user_fullname,
    email: input.email,
    auth_provider: input.auth_provider,
    role_id: input.role_id,
    ...pick(input as Record<string, any>, [...PROFILE_FIELDS, ...EMPLOYMENT_FIELDS]),
    is_active: input.is_active ?? true,
  };

  if (input.auth_provider === "local") {
    if (!input.password) throw badRequest("บัญชีแบบ local ต้องระบุ password");
    assertPasswordStrength(input.password);
    payload.password = await hashPassword(input.password);
  } else {
    if (!input.googleId) throw badRequest("บัญชีแบบ google ต้องระบุ googleId");
    payload.googleId = input.googleId;
    payload.password = null;
    payload.is_email_verified = true;
  }

  try {
    const doc = await userModel.create(payload);
    return stripSecrets(doc.toObject());
  } catch (err: any) {
    if (err?.code === 11000) throw new HttpError("อีเมลนี้ถูกใช้งานแล้ว", 409, "CONFLICT");
    throw err;
  }
}

// ── READ (list) ──────────────────────────────────────────────
export async function listUsers(query: ListUserQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (query.role_id) {
    assertObjectId(query.role_id, "role_id");
    filter.role_id = query.role_id;
  }
  if (typeof query.is_active === "boolean") filter.is_active = query.is_active;
  if (query.employment_type) filter.employment_type = query.employment_type;
  if (query.search) {
    const rx = new RegExp(escapeRegExp(query.search.trim()), "i");
    filter.$or = [{ user_fullname: rx }, { email: rx }, { user_phone: rx }];
  }

  const [items, total] = await Promise.all([
    userModel
      .find(filter)
      .select(SELECT_PUBLIC)
      .sort(query.sort ?? { created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("role_id", "role_name role_type")
      .lean(),
    userModel.countDocuments(filter),
  ]);

  return { items, meta: buildMeta(total, query.pagination) };
}

// ── READ (single) ────────────────────────────────────────────
export async function getUserById(id: string, opts: { includeDeleted?: boolean } = {}) {
  await dbConnect();
  assertObjectId(id);

  const filter: Record<string, any> = { _id: id };
  if (!opts.includeDeleted) filter.deleted_at = null;

  const user = await userModel
    .findOne(filter)
    .select(SELECT_PUBLIC)
    .populate("role_id", "role_name role_type")
    .lean();
  if (!user) throw notFound("ไม่พบผู้ใช้ที่ระบุ");
  return user;
}

// ── UPDATE (โปรไฟล์ + ข้อมูลการจ้างงาน ไม่รวมรหัสผ่าน) ────────
export async function updateUser(id: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(id);

  if (input.role_id) {
    await assertRefExists(roleModel, input.role_id, "บทบาท", "role_id");
  }

  const payload = pick(input, [
    ...PROFILE_FIELDS,
    ...EMPLOYMENT_FIELDS,
    "email",
    "role_id",
    "is_active",
  ]);

  try {
    const user = await userModel
      .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: payload }, {
        new: true,
        runValidators: true,
      })
      .select(SELECT_PUBLIC)
      .lean();
    if (!user) throw notFound("ไม่พบผู้ใช้ที่ระบุ");
    return user;
  } catch (err: any) {
    if (err?.code === 11000) throw new HttpError("อีเมลนี้ถูกใช้งานแล้ว", 409, "CONFLICT");
    throw err;
  }
}

// ── แก้โปรไฟล์ตัวเอง (ลูกค้า/พนักงาน) — เขียนได้เฉพาะฟิลด์โปรไฟล์ ────
export async function updateProfile(id: string, input: Record<string, unknown>) {
  await dbConnect();
  assertObjectId(id);

  const payload = pick(input, [...PROFILE_FIELDS]);
  const user = await userModel
    .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: payload }, {
      new: true,
      runValidators: true,
    })
    .select(SELECT_PUBLIC)
    .lean();
  if (!user) throw notFound("ไม่พบผู้ใช้ที่ระบุ");
  return user;
}

// ── เปลี่ยนรหัสผ่าน (ผู้ใช้ทำเอง ต้องยืนยันรหัสเดิม) ──────────
export async function changePassword(
  id: string,
  currentPassword: string,
  newPassword: string
) {
  await dbConnect();
  assertObjectId(id);

  const user = await userModel.findOne({ _id: id, deleted_at: null }).select("+password");
  if (!user) throw notFound("ไม่พบผู้ใช้ที่ระบุ");
  if (!user.password) {
    throw badRequest("บัญชีนี้เข้าสู่ระบบด้วย Google จึงไม่มีรหัสผ่านให้เปลี่ยน");
  }

  const matched = await bcrypt.compare(currentPassword ?? "", user.password);
  if (!matched) throw badRequest("รหัสผ่านเดิมไม่ถูกต้อง");

  assertPasswordStrength(newPassword);
  user.password = await hashPassword(newPassword);
  user.reset_password_token = null;
  user.reset_password_token_expiry = null;
  await user.save();
  return { success: true };
}

// ── ตั้งรหัสผ่านใหม่โดยแอดมิน (ไม่ต้องยืนยันรหัสเดิม + ปลดล็อกบัญชี) ──
export async function adminSetPassword(id: string, newPassword: string) {
  await dbConnect();
  assertObjectId(id);
  assertPasswordStrength(newPassword);

  const hashed = await hashPassword(newPassword);
  const user = await userModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null },
      {
        $set: {
          password: hashed,
          failed_login_attempts: 0,
          lockout_until: null,
          reset_password_token: null,
          reset_password_token_expiry: null,
        },
      },
      { new: true }
    )
    .select(SELECT_PUBLIC)
    .lean();
  if (!user) throw notFound("ไม่พบผู้ใช้ที่ระบุ");
  return user;
}

// ── DELETE (soft) / RESTORE ──────────────────────────────────
export async function deleteUser(id: string) {
  await dbConnect();
  assertObjectId(id);
  const user = await userModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null },
      { $set: { deleted_at: new Date(), is_active: false } },
      { new: true }
    )
    .select(SELECT_PUBLIC)
    .lean();
  if (!user) throw notFound("ไม่พบผู้ใช้ที่ระบุ หรือถูกลบไปแล้ว");
  return user;
}

export async function restoreUser(id: string) {
  await dbConnect();
  assertObjectId(id);
  const user = await userModel
    .findOneAndUpdate(
      { _id: id, deleted_at: { $ne: null } },
      { $set: { deleted_at: null, is_active: true } },
      { new: true }
    )
    .select(SELECT_PUBLIC)
    .lean();
  if (!user) throw notFound("ไม่พบผู้ใช้ที่ถูกลบไว้");
  return user;
}

// ─────────────────────────────────────────────────────────────
//  AUTHENTICATION — ตรวจสอบตัวตนด้วยอีเมล + รหัสผ่าน
// ─────────────────────────────────────────────────────────────

function isLockedOut(user: { lockout_until?: Date | null }): boolean {
  return !!user.lockout_until && new Date(user.lockout_until).getTime() > Date.now();
}

/**
 * ตรวจอีเมล/รหัสผ่าน
 *  - สำเร็จ  → คืนข้อมูลผู้ใช้ (ตัดฟิลด์ลับออก) + รีเซ็ตตัวนับ + อัปเดต last_login_at
 *  - ล้มเหลว → เพิ่ม failed_login_attempts, ล็อกบัญชีเมื่อครบ MAX_FAILED_ATTEMPTS, แล้ว throw
 */
export async function verifyCredentials(email: string, password: string) {
  await dbConnect();

  if (!email || !password) throw badRequest("กรุณากรอกอีเมลและรหัสผ่าน");

  const user = await userModel
    .findOne({ email: String(email).toLowerCase().trim(), deleted_at: null })
    .select("+password");

  // ข้อความเดียวกันทุกกรณีที่หา user ไม่เจอ/รหัสผิด กัน user enumeration
  if (!user) throw unauthorized("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  if (!user.is_active) throw forbidden("บัญชีนี้ถูกระงับการใช้งาน");
  if (isLockedOut(user)) {
    throw new HttpError(
      "บัญชีถูกล็อกชั่วคราวจากการเข้าสู่ระบบผิดหลายครั้ง กรุณาลองใหม่ภายหลัง",
      423,
      "FORBIDDEN"
    );
  }
  if (user.auth_provider !== "local" || !user.password) {
    throw badRequest("บัญชีนี้ต้องเข้าสู่ระบบด้วย Google");
  }

  const matched = await bcrypt.compare(password, user.password);
  if (!matched) {
    const attempts = (user.failed_login_attempts ?? 0) + 1;
    const update: Record<string, any> = { failed_login_attempts: attempts };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      update.lockout_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
      update.failed_login_attempts = 0;
    }
    await userModel.updateOne({ _id: user._id }, { $set: update });
    throw unauthorized("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }

  await userModel.updateOne(
    { _id: user._id },
    { $set: { failed_login_attempts: 0, lockout_until: null, last_login_at: new Date() } }
  );

  const obj = user.toObject();
  return stripSecrets(obj);
}

/** ปลดล็อกบัญชีด้วยมือ (แอดมิน) */
export async function unlockUser(id: string) {
  await dbConnect();
  assertObjectId(id);
  const user = await userModel
    .findByIdAndUpdate(
      id,
      { $set: { failed_login_attempts: 0, lockout_until: null } },
      { new: true }
    )
    .select(SELECT_PUBLIC)
    .lean();
  if (!user) throw notFound("ไม่พบผู้ใช้ที่ระบุ");
  return user;
}
