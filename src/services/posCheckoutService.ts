/**
 * posCheckoutService — รับเงินที่เคาน์เตอร์หน้าร้าน (POS) แล้วปิดออเดอร์ในคำขอเดียว
 *
 * นโยบายร้าน: พนักงานที่เข้าถึงคำสั่งซื้อหน้าร้านได้ (orders.create = ขายที่ POS) รับเงินแล้วถือว่าอนุมัติการชำระ
 * อัตโนมัติ — ไม่ต้องมี payments.create / payments.approve แยก (เดิม POS ยิง POST /payments + /verify
 * ตรง ๆ จึงต้องให้สิทธิ์อนุมัติการชำระเงินทั้งระบบ รวมยืนยันสลิปโอนของออเดอร์เว็บไปด้วย)
 * สิทธิ์นี้ใช้ได้เฉพาะออเดอร์หน้าร้าน (เลข POS-) เท่านั้น — สลิปของออเดอร์เว็บ/พรีออเดอร์ยังต้องมี payments.approve
 *
 * ขั้นตอน (เหมือนที่ POS เคยยิงทีละขั้น): สร้าง payment ยอดเท่าออเดอร์ → ยืนยันจ่าย (verified_by = ผู้ขาย ·
 * ออเดอร์ pending → confirmed อัตโนมัติ) → preparing → ready → completed (ลูกค้ารับของที่เคาน์เตอร์แล้ว)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import orderModel from "../models/orderModel";
import * as orderService from "./orderService";
import * as paymentService from "./paymentService";

/** ออเดอร์หน้าร้าน — ดูจาก prefix เลขออเดอร์ (orderService.orderNoPrefix: channel instore = POS-) */
export function isPosOrderNo(orderNo: unknown): boolean {
  return typeof orderNo === "string" && orderNo.startsWith(`${orderService.orderNoPrefix("instore")}-`);
}

export async function checkoutPosOrder(orderId: string, sellerId: string) {
  await dbConnect();
  assertObjectId(orderId, "order_id");
  const order = await orderModel
    .findOne({ _id: orderId, deleted_at: null })
    .select("order_no user_id total_amount order_status payment_status")
    .lean<{ order_no: string; user_id: unknown; total_amount: number; order_status: string; payment_status: string } | null>();
  if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");
  if (!isPosOrderNo(order.order_no)) {
    throw badRequest("รับเงินแบบนี้ได้เฉพาะออเดอร์หน้าร้าน (POS) — ออเดอร์อื่นต้องตรวจสลิปโดยผู้มีสิทธิ์อนุมัติการชำระเงิน");
  }
  if (order.payment_status === "paid") throw conflict("ออเดอร์นี้ชำระเงินแล้ว");
  if (order.order_status === "cancelled") throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว");

  const payment = await paymentService.createPayment({
    user_id: String(order.user_id),
    order_id: orderId,
    amount: order.total_amount,
  });
  const paid = await paymentService.verifyPayment(String(payment._id), { verified_by: sellerId, approved: true });

  // state machine เดินทีละสถานะ (ห้ามข้าม) — verify แล้วออเดอร์เป็น confirmed
  for (const next of ["preparing", "ready", "completed"] as const) {
    await orderService.updateOrderStatus(orderId, next);
  }
  return { order: await orderService.getOrderById(orderId), payment: paid };
}
