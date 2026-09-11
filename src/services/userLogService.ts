/**
 * userLogService — บันทึกกิจกรรมผู้ใช้เพื่อการตรวจสอบย้อนหลัง (UserLogs)
 *
 * เป็น log แบบ append-only: เขียนเข้าอย่างเดียว อ่าน/ค้นได้ แต่ไม่มีการแก้ไข/ลบผ่าน API
 * (model นี้ไม่มีฟิลด์ deleted_at)
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId, isObjectId } from "../lib/objectId";
import { buildMeta, type Pagination } from "../lib/queryParams";
import userLogModel from "../models/userLogModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ACTION_TYPES = ["CREATE", "READ", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "OTHER"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface WriteLogInput {
  user_id: string;
  action: string;
  action_type: ActionType;
  entity?: string;
  entity_id?: string | null;
  ip_address?: string | null;
  details?: unknown;
  before?: unknown;
  after?: unknown;
}

export interface ListLogQuery {
  pagination: Pagination;
  user_id?: string;
  entity?: string;
  entity_id?: string;
  action_type?: ActionType;
  date_from?: string;
  date_to?: string;
}

/**
 * เขียน log 1 รายการ
 * ตั้งใจให้ไม่ throw ออกไปรบกวน flow หลัก — ถ้าอยากได้ error ให้ใช้ writeLogStrict()
 */
export async function writeLog(input: WriteLogInput) {
  try {
    return await writeLogStrict(input);
  } catch (err) {
    log.error("userlog.write_failed", { err });
    return null;
  }
}

export async function writeLogStrict(input: WriteLogInput) {
  await dbConnect();

  if (!input.user_id) throw badRequest("กรุณาระบุ user_id");
  if (!input.action) throw badRequest("กรุณาระบุ action");
  if (!ACTION_TYPES.includes(input.action_type)) {
    throw badRequest(`action_type ต้องเป็นหนึ่งใน: ${ACTION_TYPES.join(", ")}`);
  }
  if (input.entity_id != null && !isObjectId(input.entity_id)) {
    throw badRequest("entity_id ต้องเป็น ObjectId ที่ถูกต้อง");
  }

  const doc = await userLogModel.create({
    user_id: input.user_id,
    action: input.action,
    action_type: input.action_type,
    entity: input.entity,
    entity_id: input.entity_id ?? null,
    ip_address: input.ip_address ?? null,
    details: input.details,
    before: input.before,
    after: input.after,
  });
  return doc.toObject();
}

export async function listLogs(query: ListLogQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (query.user_id) {
    assertObjectId(query.user_id, "user_id");
    filter.user_id = query.user_id;
  }
  if (query.entity) filter.entity = query.entity;
  if (query.entity_id) {
    assertObjectId(query.entity_id, "entity_id");
    filter.entity_id = query.entity_id;
  }
  if (query.action_type) {
    if (!ACTION_TYPES.includes(query.action_type)) {
      throw badRequest(`action_type ต้องเป็นหนึ่งใน: ${ACTION_TYPES.join(", ")}`);
    }
    filter.action_type = query.action_type;
  }
  if (query.date_from || query.date_to) {
    filter.created_at = {};
    if (query.date_from) filter.created_at.$gte = new Date(query.date_from);
    if (query.date_to) filter.created_at.$lte = new Date(query.date_to);
  }

  const [items, total] = await Promise.all([
    userLogModel
      .find(filter)
      .sort({ created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("user_id", "user_fullname email")
      .lean(),
    userLogModel.countDocuments(filter),
  ]);

  return { items, meta: buildMeta(total, query.pagination) };
}

export async function getLogById(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await userLogModel
    .findById(id)
    .populate("user_id", "user_fullname email")
    .lean();
  if (!doc) throw notFound("ไม่พบ log ที่ระบุ");
  return doc;
}
