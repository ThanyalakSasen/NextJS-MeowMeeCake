/**
 * addressService — สมุดที่อยู่จัดส่งของลูกค้า (Addresses)
 * ทุกฟังก์ชันสโคปด้วย userId — ผู้ใช้เห็น/แก้ได้เฉพาะที่อยู่ของตัวเอง
 * มีที่อยู่ default ได้ 1 อันต่อผู้ใช้ (ตั้งใหม่ = ยกเลิกอันเดิม)
 */
import dbConnect from "../lib/dbConnect";
import { notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import addressModel from "../models/addressModel";
import type { z } from "zod";
import type { addressCreate, addressUpdate } from "../schemas/address";

type CreateAddressInput = z.infer<typeof addressCreate>;
type UpdateAddressInput = z.infer<typeof addressUpdate>;

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

export async function create(userId: string, input: CreateAddressInput) {
  await dbConnect();
  assertObjectId(userId, "user_id");
  // required field ทั้งหมด (house_no/sub_district/district/province/zip_code) validate ที่
  // route ผ่าน schemas/address.ts addressCreate แล้ว (ไม่ .optional()) — ไม่ต้องเช็คซ้ำที่นี่

  const count = await addressModel.countDocuments({ user_id: userId, deleted_at: null });
  const makeDefault = input.is_default === true || count === 0;

  if (makeDefault) {
    await addressModel.updateMany(
      { user_id: userId, deleted_at: null },
      { $set: { is_default: false } }
    );
  }

  const doc = await addressModel.create({
    ...input,
    user_id: userId,
    is_default: makeDefault, // เขียนทับ input.is_default เสมอ — คำนวณเองข้างบนแล้ว
  });
  return doc.toObject();
}

export async function update(userId: string, id: string, input: UpdateAddressInput) {
  await dbConnect();
  assertObjectId(id);

  const addr = await addressModel.findOne({ _id: id, user_id: userId, deleted_at: null });
  if (!addr) throw notFound("ไม่พบที่อยู่ที่ระบุ");

  // is_default แยกจัดการเอง (ด้านล่าง) — ไม่ assign ตรงจาก input เพื่อไม่ให้ client
  // ส่ง is_default: false มาปลดธงเองได้ (ต้องผ่าน setDefault ของที่อยู่อื่นแทนเท่านั้น)
  const { is_default, ...rest } = input;
  Object.assign(addr, rest);

  if (is_default === true && !addr.is_default) {
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

/** สแนปช็อตที่อยู่ลง order (BACKLOG §3.8) — รับ address_id (จากสมุดที่อยู่) หรือ delivery_address
 *  (กรอกใหม่ทั้งก้อน) อย่างใดอย่างหนึ่ง (route validate oneOf ไว้แล้วผ่าน zod) แล้วคืนเป็น flat record
 *  รูปแบบเดียวกับที่ orderService.persistOrder คาดหวัง (ADDRESS_FIELDS: recipient_name/recipient_phone/
 *  house_no/sub_district/district/province/zip_code) — สมุดที่อยู่เก็บแค่ตำแหน่ง ไม่เก็บชื่อ/เบอร์ผู้รับ
 *  (สั่งให้คนอื่นได้) เลยต้องรับ recipient_name/recipient_phone แยกมาต่างหากเมื่อใช้ address_id */
export async function resolveDeliverySnapshot(
  userId: string,
  input: {
    address_id?: string | null;
    recipient_name?: string | null;
    recipient_phone?: string | null;
    delivery_address?: Record<string, string> | null;
  }
): Promise<Record<string, string> | null> {
  if (!input.address_id) return input.delivery_address ?? null;

  const addr = await getById(userId, input.address_id);
  return {
    recipient_name: input.recipient_name ?? "",
    recipient_phone: input.recipient_phone ?? "",
    house_no: addr.house_no,
    sub_district: addr.sub_district,
    district: addr.district,
    province: addr.province,
    zip_code: addr.zip_code,
  };
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
