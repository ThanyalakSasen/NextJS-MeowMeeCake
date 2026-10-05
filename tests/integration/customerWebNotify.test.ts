import { describe, it, expect } from "vitest";
import customerNotificationModel from "@/models/customerNotificationModel";
import * as orderService from "@/services/orderService";
import * as customerNotifyService from "@/services/customerNotifyService";
import { makeUser, makeProduct } from "./helpers";

/** กระดิ่งแจ้งเตือนในเว็บของลูกค้า (customer-backend-merge.md §8.12) — ไม่ได้ตั้ง LINE token ในเทส = กระดิ่งอย่างเดียว */

type Notice = { title: string; message: string; type: string; link: string; ref_type: string };

/** notifyCustomerLater เป็น fire-and-forget → รอจนครบจำนวน */
async function waitNotices(userId: unknown, count: number): Promise<Notice[]> {
  for (let i = 0; i < 60; i++) {
    const docs = await customerNotificationModel.find({ user_id: userId }).sort({ created_at: 1, _id: 1 }).lean<Notice[]>();
    if (docs.length >= count) return docs;
    await new Promise((r) => setTimeout(r, 25));
  }
  return customerNotificationModel.find({ user_id: userId }).sort({ created_at: 1, _id: 1 }).lean<Notice[]>();
}

async function webOrder(channel: "online" | "instore" = "online") {
  const user = await makeUser();
  const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });
  const order = (await orderService.createOrder(String(user._id), {
    order_type: "takeaway",
    channel,
    storefront: channel === "online",
    items: [{ product_id: String(p._id), quantity: 1 }],
  })) as { _id: unknown; order_no: string };
  return { user, order, oid: String(order._id) };
}

describe("กระดิ่งในเว็บของลูกค้า", () => {
  it("แจ้งทุกสถานะของออเดอร์เว็บ (รวมกำลังเตรียม/สำเร็จที่ไม่ส่ง LINE) · ลิงก์ไปหน้ารายละเอียด", async () => {
    const { user, order, oid } = await webOrder();
    for (const st of ["confirmed", "preparing", "ready", "completed"] as const) {
      await orderService.updateOrderStatus(oid, st);
    }
    const notices = await waitNotices(user._id, 5);
    expect(notices.map((n) => n.message.split("\n")[0])).toEqual([
      "🧾 ได้รับออเดอร์แล้ว ยอดรวม 100 บาท",
      "🧾 ร้านรับคำสั่งซื้อของคุณแล้ว",
      "👩‍🍳 ร้านกำลังเตรียมสินค้าของคุณ",
      "🛍️ สินค้าพร้อมให้มารับแล้ว",
      "🎉 คำสั่งซื้อสำเร็จแล้ว ขอบคุณที่อุดหนุนนะคะ",
    ]);
    expect(notices[0]).toMatchObject({ title: `คำสั่งซื้อ #${order.order_no}`, link: `/customer/account/purchases/${oid}`, ref_type: "order" });
    expect(notices[4].type).toBe("success");
  });

  it("หมดเวลาชำระ → แจ้งพร้อมคำแนะนำแนบสลิป · ลูกค้ายกเลิกเองไม่แจ้งกลับ · บิลหน้าร้านไม่แจ้ง", async () => {
    const a = await webOrder();
    await orderService.expireUnpaidOrders({ now: new Date(Date.now() + 31 * 60 * 1000) });
    const expired = await waitNotices(a.user._id, 2);
    expect(expired[1].type).toBe("error");
    expect(expired[1].message).toContain("แนบสลิป");

    const b = await webOrder();
    await waitNotices(b.user._id, 1);
    await orderService.cancelOrderByCustomer(b.oid, String(b.user._id));
    await new Promise((r) => setTimeout(r, 150));
    expect(await customerNotificationModel.countDocuments({ user_id: b.user._id })).toBe(1);

    const pos = await webOrder("instore");
    await orderService.updateOrderStatus(pos.oid, "confirmed");
    await new Promise((r) => setTimeout(r, 150));
    expect(await customerNotificationModel.countDocuments({ user_id: pos.user._id })).toBe(0);
  });

  it("รายการของฉัน + ยังไม่อ่าน · อ่านรายการเดียว / อ่านทั้งหมด · คนอื่นอ่านแทนไม่ได้ · ที่บันทึกล่วงหน้ายังไม่แสดง", async () => {
    const { user, oid } = await webOrder();
    await orderService.updateOrderStatus(oid, "confirmed");
    await waitNotices(user._id, 2);
    await customerNotificationModel.create({
      user_id: user._id, title: "รอบใหม่", message: "เปิดพรุ่งนี้", visible_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const uid = String(user._id);

    const list = await customerNotifyService.listMyNotifications(uid);
    expect(list.items).toHaveLength(2);
    expect(list.unread_count).toBe(2);

    const other = await makeUser();
    const firstId = String((list.items[0] as { _id: unknown })._id);
    await expect(customerNotifyService.markRead(String(other._id), firstId)).rejects.toMatchObject({ status: 404 });
    expect((await customerNotifyService.markRead(uid, firstId)).unread_count).toBe(1);
    await customerNotifyService.markAllRead(uid);
    expect((await customerNotifyService.listMyNotifications(uid)).unread_count).toBe(0);
    expect(await customerNotificationModel.countDocuments({ user_id: user._id, read_at: null })).toBe(1); // ล่วงหน้ายังไม่นับ
  });
});
