/**
 * addressService — สมุดที่อยู่จัดส่งของลูกค้า (Addresses)
 * ทุกฟังก์ชันสโคปด้วย userId — ผู้ใช้เห็น/แก้ได้เฉพาะที่อยู่ของตัวเอง
 * มีที่อยู่ default ได้ 1 อันต่อผู้ใช้ (ตั้งใหม่ = ยกเลิกอันเดิม)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId, pick } from "../lib/objectId";
import addressModel from "../models/addressModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIELDS = [
  "house_no",
  "sub_district",
  "district",
  "province",
  "zip_code",
] as const;

export async function listByUser(userId: string) {
  await dbConnect();
  assertObjectId(userId, "user_id");
  return addressModel
    .find({ user_id: userId, deleted_at: null })
    .sort({ is_default: -1, created_at: -1 })
    .lean();
}

export async function getById(userId: string, id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await addressModel
    .findOne({ _id: id, user_id: userId, deleted_at: null })
    .lean();
  if (!doc) throw notFound("ไม่พบที่อยู่ที่ระบุ");
  return doc;
}

export async function create(userId: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(userId, "user_id");
  for (const f of FIELDS) {
    if (!input[f]) throw badRequest(`กรุณาระบุ ${f}`);
  }

  const count = await addressModel.countDocuments({ user_id: userId, deleted_at: null });
  const makeDefault = input.is_default === true || count === 0;

  if (makeDefault) {
    await addressModel.updateMany(
      { user_id: userId, deleted_at: null },
      { $set: { is_default: false } }
    );
  }

  const doc = await addressModel.create({
    ...pick(input, FIELDS),
    user_id: userId,
    is_default: makeDefault,
  });
  return doc.toObject();
}

export async function update(userId: string, id: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(id);

  const addr = await addressModel.findOne({ _id: id, user_id: userId, deleted_at: null });
  if (!addr) throw notFound("ไม่พบที่อยู่ที่ระบุ");

  Object.assign(addr, pick(input, FIELDS));

  if (input.is_default === true && !addr.is_default) {
    await addressModel.updateMany(
      { user_id: userId, deleted_at: null, _id: { $ne: id } },
      { $set: { is_default: false } }
    );
    addr.is_default = true;
  }

  await addr.save();
  return addr.toObject();
}

export async function setDefault(userId: string, id: string) {
  await dbConnect();
  assertObjectId(id);
  const exists = await addressModel.exists({ _id: id, user_id: userId, deleted_at: null });
  if (!exists) throw notFound("ไม่พบที่อยู่ที่ระบุ");

  await addressModel.updateMany(
    { user_id: userId, deleted_at: null },
    { $set: { is_default: false } }
  );
  const doc = await addressModel
    .findByIdAndUpdate(id, { $set: { is_default: true } }, { new: true })
    .lean();
  return doc;
}

export async function remove(userId: string, id: string) {
  await dbConnect();
  assertObjectId(id);

  const addr = await addressModel.findOne({ _id: id, user_id: userId, deleted_at: null });
  if (!addr) throw notFound("ไม่พบที่อยู่ที่ระบุ หรือถูกลบไปแล้ว");

  const wasDefault = addr.is_default;
  addr.deleted_at = new Date();
  addr.is_default = false;
  await addr.save();

  // ถ้าลบอันที่เป็น default ให้เลื่อนอันอื่นขึ้นเป็น default
  if (wasDefault) {
    const next = await addressModel
      .findOne({ user_id: userId, deleted_at: null })
      .sort({ created_at: -1 });
    if (next) {
      next.is_default = true;
      await next.save();
    }
  }
  return { deleted: true, _id: addr._id };
}
