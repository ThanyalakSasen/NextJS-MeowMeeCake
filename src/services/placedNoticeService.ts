/**
 * placedNoticeService — แจ้ง "ออเดอร์ใหม่ / พรีออเดอร์ใหม่" ของบิลที่สั่งจากหน้าเว็บ
 *
 * ผู้ใช้ขอ (2026-11-03): ไม่แจ้งทันทีที่กดสั่ง — แจ้งตอนลูกค้า "แนบสลิป" หรือ "กดชำระเงินภายหลัง" เท่านั้น
 * (กดสั่งแล้วกลับไปแก้ที่อยู่/วิธีรับ = ยกเลิกแล้วสั่งใหม่ · ปล่อยหมดเวลา → ไม่มีแจ้งเตือนรก ๆ ค้าง)
 * แจ้ง: ร้าน (หน้าแจ้งเตือนหลังร้าน — ข้อความเดิมของ persistOrder/createPreorder) + กระดิ่งลูกค้า ("ได้รับคำสั่งซื้อแล้ว")
 *
 * ครั้งเดียวต่อบิล: placed_notice_pending true → false แบบ atomic (findOneAndUpdate) — เรียกซ้ำ/พร้อมกันได้
 * บิลหลังร้าน/POS/ข้อมูลเก่า = false ตั้งแต่ต้น (แจ้งไปแล้วตอนสร้าง) · บิลที่ยกเลิกแล้ว = ไม่แจ้ง
 * ไม่ throw — ผู้เรียก (แนบสลิป / route) ห้ามล้มเพราะแจ้งเตือน
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { toBaht } from "../lib/money";
import { adminLinks } from "../lib/adminLinks";
import { isObjectId } from "../lib/objectId";
import { trackBackground } from "../lib/backgroundTasks";
import orderModel from "../models/orderModel";
import preorderModel from "../models/preorderModel";
import { notificationService } from "./notificationService";
import { customerWeb, notifyCustomerLater, type CustomerDocKind } from "./customerNotifyService";

/** แจ้งบิลนี้ถ้ายังรอแจ้งอยู่ — คืน true = แจ้งรอบนี้ */
export async function announcePlaced(kind: CustomerDocKind, id: unknown): Promise<boolean> {
  try {
    const docId = String(id ?? "");
    if (!isObjectId(docId)) return false;
    await dbConnect();
    const filter = { _id: docId, placed_notice_pending: true, order_status: { $ne: "cancelled" }, deleted_at: null };
    const update = { $set: { placed_notice_pending: false } };

    if (kind === "order") {
      const order = await orderModel
        .findOneAndUpdate(filter, update)
        .select("order_no total_amount user_id")
        .lean<{ _id: unknown; order_no: string; total_amount: number; user_id: unknown } | null>();
      if (!order) return false;
      await notificationService.notify({
        title: `ออเดอร์ใหม่ ${order.order_no}`,
        message: `ยอดรวม ${toBaht(order.total_amount).toLocaleString("th-TH")} บาท`,
        module: "order",
        type: "info",
        link: adminLinks.order(order._id),
        line: process.env.LINE_NOTIFY_NEW_ORDERS === "true",
      });
      notifyCustomerLater(order.user_id, null, customerWeb.created("order", order._id, order.order_no, order.total_amount));
      return true;
    }

    const preorder = await preorderModel
      .findOneAndUpdate(filter, update)
      .select("preorder_no total_amount user_id round_id")
      .populate("round_id", "round_name")
      .lean<{ _id: unknown; preorder_no: string; total_amount: number; user_id: unknown; round_id?: { round_name?: string } | null } | null>();
    if (!preorder) return false;
    await notificationService.notify({
      title: `พรีออเดอร์ใหม่ ${preorder.preorder_no}`,
      message: `รอบ ${preorder.round_id?.round_name ?? "-"} · ยอดรวม ${toBaht(preorder.total_amount).toLocaleString("th-TH")} บาท`,
      module: "order",
      type: "info",
      link: adminLinks.preorder(preorder._id),
      line: process.env.LINE_NOTIFY_NEW_ORDERS === "true",
    });
    notifyCustomerLater(preorder.user_id, null, customerWeb.created("preorder", preorder._id, preorder.preorder_no, preorder.total_amount));
    return true;
  } catch (err) {
    log.error("placed_notice.failed", { kind, id: String(id ?? ""), err });
    return false;
  }
}

/** fire-and-forget — ใช้หลังแนบสลิป (ไม่หน่วงคำตอบ) */
export function announcePlacedLater(kind: CustomerDocKind, id: unknown): void {
  void trackBackground(announcePlaced(kind, id));
}
