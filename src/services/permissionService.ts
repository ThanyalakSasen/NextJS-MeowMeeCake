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
import { assertObjectId, pick } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, type Pagination } from "../lib/queryParams";
import permissionModel from "../models/permissionModel";
import roleModel from "../models/roleModel";
import userModel from "../models/userModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
      ...pick(input as Record<string, any>, FLAG_FIELDS),
    });
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
export async function updatePermission(id: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(id);

  const payload = pick(input, [...FLAG_FIELDS, "expires_at"]);
  if (Object.keys(payload).length === 0) {
    throw badRequest("ไม่มีฟิลด์ที่อนุญาตให้แก้ไข (can_view/can_create/.../expires_at)");
  }

  const doc = await permissionModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null },
      { $set: payload },
      { new: true, runValidators: true }
    )
    .lean();
  if (!doc) throw notFound("ไม่พบสิทธิ์ที่ระบุ");
  return doc;
}

// ── DELETE (soft) ───────────────────────────────────────────
export async function deletePermission(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await permissionModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null },
      { $set: { deleted_at: new Date() } },
      { new: true }
    )
    .lean();
  if (!doc) throw notFound("ไม่พบสิทธิ์ที่ระบุ หรือถูกลบไปแล้ว");
  return doc;
}

// ── RESTORE ─────────────────────────────────────────────────
export async function restorePermission(id: string) {
  await dbConnect();
  assertObjectId(id);
  try {
    const doc = await permissionModel
      .findOneAndUpdate(
        { _id: id, deleted_at: { $ne: null } },
        { $set: { deleted_at: null } },
        { new: true }
      )
      .lean();
    if (!doc) throw notFound("ไม่พบสิทธิ์ที่ถูกลบไว้");
    return doc;
  } catch (err: any) {
    if (err?.code === 11000) {
      throw conflict("มีสิทธิ์ที่ใช้งานอยู่ของบทบาท+เมนูนี้แล้ว จึงกู้คืนรายการนี้ไม่ได้");
    }
    throw err;
  }
}

// ── สิทธิ์ที่ใช้ได้จริงของบทบาทหนึ่ง (ตัดที่หมดอายุออก) ──────
export async function getEffectivePermissions(roleId: string) {
  await dbConnect();
  assertObjectId(roleId, "role_id");

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
  return { role_id: roleId, permissions: byMenu };
}
