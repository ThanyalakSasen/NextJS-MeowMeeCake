/**
 * orderItemService — รายการสินค้าในออเดอร์ (OrderItems)
 *
 * รายการถูกสร้าง/ลบผ่าน orderService เท่านั้น (ตอนสร้าง/ยกเลิกออเดอร์)
 * ที่นี่มีแค่การอ่านและแก้หมายเหตุ (special_request) รายรายการ
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import orderItemModel from "../models/orderItemModel";
import orderModel from "../models/orderModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function listByOrder(orderId: string) {
  await dbConnect();
  assertObjectId(orderId, "order_id");
  return orderItemModel.find({ order_id: orderId, deleted_at: null }).lean();
}

export async function getOrderItemById(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await orderItemModel.findOne({ _id: id, deleted_at: null }).lean();
  if (!doc) throw notFound("ไม่พบรายการสินค้าในออเดอร์");
  return doc;
}

export async function updateSpecialRequest(id: string, specialRequest: string | null) {
  await dbConnect();
  assertObjectId(id);

  const item = await orderItemModel.findOne({ _id: id, deleted_at: null }).lean<any>();
  if (!item) throw notFound("ไม่พบรายการสินค้าในออเดอร์");

  const order = await orderModel.findById(item.order_id).lean<any>();
  if (order && ["completed", "cancelled"].includes(order.order_status)) {
    throw badRequest("ออเดอร์นี้ปิดแล้ว แก้ไขหมายเหตุไม่ได้");
  }

  const updated = await orderItemModel
    .findByIdAndUpdate(
      id,
      { $set: { special_request: specialRequest?.trim() || null } },
      { new: true }
    )
    .lean();
  return updated;
}
