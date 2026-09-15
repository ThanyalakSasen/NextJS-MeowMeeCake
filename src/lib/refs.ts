import type { Model } from "mongoose";
import { assertObjectId } from "./objectId";
import { notFound } from "./httpError";

/**
 * ยืนยันว่าเอกสารที่ id อ้างถึงมีอยู่จริงและยังไม่ถูก soft delete
 * ใช้ตรวจ foreign key ก่อน create/update เช่น product_id, category_id
 * generic <T> แทน Model<any> — โมเดลแต่ละตัวในโปรเจกต์นี้ export เป็น
 * `mongoose.models.X || mongoose.model(...)` (ไม่มี doc type ระบุ) เรียกด้วยโมเดลไหนก็ได้
 */
export async function assertRefExists<T>(
  model: Model<T>,
  id: string,
  label: string,
  field = "id"
): Promise<void> {
  assertObjectId(id, field);
  const found = await model.exists({ _id: id, deleted_at: null }).lean();
  if (!found) throw notFound(`ไม่พบ${label}ที่ระบุ`);
}

/** เหมือน assertRefExists แต่ใช้กับ model ที่ไม่มีฟิลด์ deleted_at */
export async function assertRefExistsHard<T>(
  model: Model<T>,
  id: string,
  label: string,
  field = "id"
): Promise<void> {
  assertObjectId(id, field);
  const found = await model.exists({ _id: id }).lean();
  if (!found) throw notFound(`ไม่พบ${label}ที่ระบุ`);
}
