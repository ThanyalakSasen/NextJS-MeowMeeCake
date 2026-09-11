import type { Model } from "mongoose";
import { assertObjectId } from "./objectId";
import { notFound } from "./httpError";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ยืนยันว่าเอกสารที่ id อ้างถึงมีอยู่จริงและยังไม่ถูก soft delete
 * ใช้ตรวจ foreign key ก่อน create/update เช่น product_id, category_id
 */
export async function assertRefExists(
  model: Model<any>,
  id: string,
  label: string,
  field = "id"
): Promise<void> {
  assertObjectId(id, field);
  const found = await model.exists({ _id: id, deleted_at: null }).lean();
  if (!found) throw notFound(`ไม่พบ${label}ที่ระบุ`);
}

/** เหมือน assertRefExists แต่ใช้กับ model ที่ไม่มีฟิลด์ deleted_at */
export async function assertRefExistsHard(
  model: Model<any>,
  id: string,
  label: string,
  field = "id"
): Promise<void> {
  assertObjectId(id, field);
  const found = await model.exists({ _id: id }).lean();
  if (!found) throw notFound(`ไม่พบ${label}ที่ระบุ`);
}
