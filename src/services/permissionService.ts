/**
 * permissionService — สิทธิ์การเข้าถึงเมนู (Permissions) แบบผูกกับบทบาท (role_id + menu_key)
 *
 * เขียนเองแทนการใช้ crudService เพราะ:
 *  - ตัวตนของเอกสารคือคู่ (role_id, menu_key) ที่มี partial unique index (unique เฉพาะที่ deleted_at: null)
 *    — ต้องแปลง duplicate key เป็น 409
 *  - soft delete ผ่าน deleted_at (ต้องมี field นี้ใน permissionModel)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, type Pagination } from "../lib/queryParams";
import { softDeleteDoc, restoreDoc } from "../lib/crudService";
import permissionModel from "../models/permissionModel";
import roleModel from "../models/roleModel";
import userModel from "../models/userModel";
import type { z } from "zod";
import type { permissionUpdate } from "../schemas/rbac";

/* eslint-disable @typescript-eslint/no-explicit-any */

type UpdatePermissionInput = z.infer<typeof permissionUpdate>;

export const MENU_KEYS = [
  "orders",
  "preorder",
  "payments",
  "products",
  "ingredients",
  "stock",
  "recipes",
  "production",
  "employees",
  "dashboard",
  "promotions",
  "reports",
] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

const FLAG_FIELDS = [
  "can_view",
  "can_create",
  "can_update",
  "can_delete",
  "can_approve",
] as const;

export interface CreatePermissionInput {
  role_id: string;
  menu_key: MenuKey;
  granted_by: string;
  expires_at?: string | Date | null;
  can_view?: boolean;
  can_create?: boolean;
  can_update?: boolean;
  can_delete?: boolean;
  can_approve?: boolean;
}

export interface ListPermissionQuery {
  pagination: Pagination;
  role_id?: string;
  menu_key?: MenuKey;
  includeDeleted?: boolean;
}

export interface EffectivePermissions {
  role_id: string;
  permissions: Record<string, Record<string, boolean>>;
}

// ── cache: สิทธิ์ที่ใช้ได้จริงต่อ role (BACKLOG3 §7) ────────────
// getEffectivePermissions() ถูกเรียกทุก request ที่ผ่าน authGuard.requirePermission()/withPermission()
// (แทบทุก mutation ของ /api/admin/*) — เดิมไม่มี cache เลย ยิง query ทุกครั้ง เพิ่ม TTL cache แบบเดียว
// กับ deliveryZoneService.ts แต่ keyed ด้วย role_id (แต่ละ role มีสิทธิ์ไม่เหมือนกัน) · invalidate ทันที
// ทุกจุดที่เขียน permission (create/update/delete/restore) — ล้างทั้ง cache ไม่ track เจาะจงว่า role
// ไหนถูกกระทบ (เขียน permission ไม่ใช่ path ที่ถี่ เทียบกับ read ที่ถี่กว่ามาก ล้างทั้งหมดไม่แพง)
// TTL ตั้งสั้นกว่า deliveryZoneService (30s ไม่ใช่ 60s) เพราะเป็น access-control ไม่ใช่แค่ตัวเลขค่าส่ง —
// ตั้ง PERMISSION_CACHE_TTL_MS=0 ปิด cache ได้ (เช่นตอนเทส) เหมือน DELIVERY_ZONE_CACHE_TTL_MS
// ⚠️ in-memory ต่อ instance เหมือน rateLimit.ts/deliveryZoneService.ts — deploy หลาย instance พร้อมกัน
// ต้องเปลี่ยนเป็น Redis (หรือ pub/sub invalidate ข้าม instance) ไม่งั้น instance อื่นเห็นสิทธิ์เก่าค้างได้
// จนกว่า TTL หมดอายุ
const envTtl = Number(process.env.PERMISSION_CACHE_TTL_MS);
const CACHE_TTL_MS = Number.isFinite(envTtl) && envTtl >= 0 ? envTtl : 30_000;
const permissionCache = new Map<string, { data: EffectivePermissions; expiresAt: number }>();

function invalidatePermissionCache(): void {
  permissionCache.clear();
}

// ── CREATE ───────────────────────────────────────────────────
export async function createPermission(input: CreatePermissionInput) {
  await dbConnect();

  if (!input.role_id) throw badRequest("กรุณาระบุ role_id");
  if (!input.menu_key || !MENU_KEYS.includes(input.menu_key)) {
    throw badRequest(`menu_key ต้องเป็นหนึ่งใน: ${MENU_KEYS.join(", ")}`);
  }
  if (!input.granted_by) throw badRequest("กรุณาระบุ granted_by (ผู้ให้สิทธิ์)");

  assertObjectId(input.role_id, "role_id");
  const role = await roleModel
    .findOne({ _id: input.role_id, deleted_at: null })
    .lean<{ role_type?: string }>();
  if (!role) throw notFound("ไม่พบบทบาทที่ระบุ");
  // สิทธิ์เมนูใช้กับพนักงานเท่านั้น — ลูกค้าเข้าถึงผ่าน /api/shop/* (ตรวจ ownership ไม่ใช่สิทธิ์เมนู)
  if (role.role_type === "customer") {
    throw badRequest('กำหนดสิทธิ์เมนูให้บทบาทประเภท "customer" ไม่ได้');
  }
  await assertRefExists(userModel, input.granted_by, "ผู้ให้สิทธิ์", "granted_by");

  try {
    const doc = await permissionModel.create({
      role_id: input.role_id,
      menu_key: input.menu_key,
      granted_by: input.granted_by,
      expires_at: input.expires_at ?? null,
      deleted_at: null,
      can_view: input.can_view,
      can_create: input.can_create,
      can_update: input.can_update,
      can_delete: input.can_delete,
      can_approve: input.can_approve,
    });
    invalidatePermissionCache();
    return doc.toObject();
  } catch (err: any) {
    if (err?.code === 11000) {
      throw conflict("บทบาทนี้มีสิทธิ์ของเมนูนี้อยู่แล้ว (ใช้การแก้ไขแทน)");
    }
    throw err;
  }
}

// ── READ (list) ──────────────────────────────────────────────
export async function listPermissions(query: ListPermissionQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (query.role_id) {
    assertObjectId(query.role_id, "role_id");
    filter.role_id = query.role_id;
  }
  if (query.menu_key) filter.menu_key = query.menu_key;

  const [items, total] = await Promise.all([
    permissionModel
      .find(filter)
      .sort({ menu_key: 1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("role_id", "role_name role_type")
      .populate("granted_by", "user_fullname email")
      .lean(),
    permissionModel.countDocuments(filter),
  ]);

  return { items, meta: buildMeta(total, query.pagination) };
}

export async function getPermissionById(
  id: string,
  opts: { includeDeleted?: boolean } = {}
) {
  await dbConnect();
  assertObjectId(id);

  const filter: Record<string, any> = { _id: id };
  if (!opts.includeDeleted) filter.deleted_at = null;

  const doc = await permissionModel
    .findOne(filter)
    .populate("role_id", "role_name role_type")
    .populate("granted_by", "user_fullname email")
    .lean();
  if (!doc) throw notFound("ไม่พบสิทธิ์ที่ระบุ");
  return doc;
}

// ── UPDATE (แก้ได้เฉพาะ flag การอนุญาต + วันหมดอายุ) ─────────
// "ต้องมีอย่างน้อย 1 ฟิลด์" validate ที่ route ผ่าน schemas/rbac.ts permissionUpdate แล้ว (.refine)
export async function updatePermission(id: string, input: UpdatePermissionInput) {
  await dbConnect();
  assertObjectId(id);

  const payload = { ...input };
  const doc = await permissionModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null },
      { $set: payload },
      { new: true, runValidators: true }
    )
    .lean();
  if (!doc) throw notFound("ไม่พบสิทธิ์ที่ระบุ");
  invalidatePermissionCache();
  return doc;
}

// BACKLOG3 §9 — soft-delete/restore เป็น pattern เดียวกับ service อื่นทุกจุด ใช้ primitive กลางแทน
// ── DELETE (soft) ───────────────────────────────────────────
export async function deletePermission(id: string) {
  const doc = await softDeleteDoc(permissionModel, id, {
    notFoundMsg: "ไม่พบสิทธิ์ที่ระบุ หรือถูกลบไปแล้ว",
  });
  invalidatePermissionCache();
  return doc;
}

// ── RESTORE ─────────────────────────────────────────────────
export async function restorePermission(id: string) {
  try {
    const doc = await restoreDoc(permissionModel, id, { notFoundMsg: "ไม่พบสิทธิ์ที่ถูกลบไว้" });
    invalidatePermissionCache();
    return doc;
  } catch (err: any) {
    if (err?.code === 11000) {
      throw conflict("มีสิทธิ์ที่ใช้งานอยู่ของบทบาท+เมนูนี้แล้ว จึงกู้คืนรายการนี้ไม่ได้");
    }
    throw err;
  }
}

// ── สิทธิ์ที่ใช้ได้จริงของบทบาทหนึ่ง (ตัดที่หมดอายุออก) ──────
// ⚠️ cache TTL หมายความว่า permission ที่ตั้ง expires_at ไว้ อาจยังถูกนับว่า "ใช้ได้" เกินเวลาจริงไป
// ได้สูงสุด CACHE_TTL_MS (ผลลัพธ์ query ถูก bake ไว้ตอน cache-write ไม่ได้ประเมิน expires_at ใหม่ทุก
// ครั้งที่อ่านจาก cache) — ยอมรับได้เพราะ TTL สั้น (30s) และเป็นเคสที่พบไม่บ่อย (permission ชั่วคราว) ต่าง
// จากการถอนสิทธิ์ผ่านแอดมินโดยตรง (delete/update) ที่ invalidate ทันทีเสมอ ไม่มี grace period เลย
export async function getEffectivePermissions(roleId: string): Promise<EffectivePermissions> {
  await dbConnect();
  assertObjectId(roleId, "role_id");

  const cached = permissionCache.get(roleId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const now = new Date();
  const rows = await permissionModel
    .find({
      role_id: roleId,
      deleted_at: null,
      $or: [{ expires_at: null }, { expires_at: { $gt: now } }],
    })
    .select(`menu_key ${FLAG_FIELDS.join(" ")} expires_at`)
    .lean<Array<Record<string, any>>>();

  const byMenu: Record<string, Record<string, boolean>> = {};
  for (const row of rows) {
    byMenu[row.menu_key] = Object.fromEntries(
      FLAG_FIELDS.map((f) => [f, !!row[f]])
    );
  }
  const result = { role_id: roleId, permissions: byMenu };
  permissionCache.set(roleId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
