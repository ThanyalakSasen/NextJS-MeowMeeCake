import { describe, it, expect, afterEach } from "vitest";
import productModel from "@/models/productModel";
import orderModel from "@/models/orderModel";
import paymentModel from "@/models/paymentModel";
import notificationModel from "@/models/notificationModel";
import * as orderService from "@/services/orderService";
import * as paymentService from "@/services/paymentService";
import * as paymentLinkService from "@/services/paymentLinkService";
import { makeUser, makeProduct } from "./helpers";

/** ขั้น 5 — ออเดอร์เว็บ: หมดเวลาชำระ 30 นาที · แนบสลิปย้อนหลัง · นโยบายยกเลิก · ลิงก์ชำระเงิน · QR (§8.8) */

const MIN = 60 * 1000;
const stock = async (id: unknown) =>
  (await productModel.findById(id).lean<{ product_stock_quantity: number }>())!.product_stock_quantity;

async function webOrder(qty = 2, stockQty = 10) {
  const user = await makeUser();
  const p = await makeProduct({ product_price: 100, product_stock_quantity: stockQty });
  const order = (await orderService.createOrder(String(user._id), {
    order_type: "takeaway",
    items: [{ product_id: String(p._id), quantity: qty }],
    storefront: true,
  })) as { _id: unknown; order_no: string; total_amount: number; payment_due_at: Date };
  return { user, p, order, uid: String(user._id), oid: String(order._id) };
}

const later = (ms: number) => new Date(Date.now() + ms);

afterEach(() => {
  delete process.env.PROMPTPAY_ID;
});

describe("หมดเวลาชำระ 30 นาที", () => {
  it("มีกำหนดชำระ 30 นาที · เลยกำหนดไม่ส่งสลิป → ยกเลิก + คืนสต็อก · ส่งสลิปแล้วไม่ถูกยกเลิก", async () => {
    const a = await webOrder();
    const b = await webOrder();
    const due = new Date(a.order.payment_due_at).getTime() - Date.now();
    expect(due).toBeGreaterThan(29 * MIN);
    expect(due).toBeLessThanOrEqual(30 * MIN);
    expect(await stock(a.p._id)).toBe(8);

    await paymentService.createPayment({
      user_id: b.uid, order_id: b.oid, amount: b.order.total_amount, slip_image_url: "/api/files/slips/b.jpg",
    });

    expect((await orderService.expireUnpaidOrders({ now: later(20 * MIN) })).expired).toEqual([]);
    const res = await orderService.expireUnpaidOrders({ now: later(31 * MIN) });
    expect(res.expired).toEqual([a.order.order_no]);

    const after = await orderModel.findById(a.order._id).lean<{ order_status: string; cancelled_reason: string }>();
    expect(after!.order_status).toBe("cancelled");
    expect(after!.cancelled_reason).toBe(orderService.PAYMENT_EXPIRED_REASON);
    expect(await stock(a.p._id)).toBe(10);
    expect((await orderModel.findById(b.order._id).lean<{ order_status: string }>())!.order_status).toBe("pending");
  });

  it("แนบสลิปย้อนหลัง → ตัดสต็อกใหม่ + กลับเป็น pending · ไม่แนบสลิป = 400 · ของหมด = 409", async () => {
    const a = await webOrder(2, 10);
    await orderService.expireUnpaidOrders({ now: later(31 * MIN) });
    expect(await stock(a.p._id)).toBe(10);

    await expect(
      paymentService.createPayment({ user_id: a.uid, order_id: a.oid, amount: a.order.total_amount })
    ).rejects.toMatchObject({ status: 400 });

    await paymentService.createPayment({
      user_id: a.uid, order_id: a.oid, amount: a.order.total_amount, slip_image_url: "/api/files/slips/a.jpg",
    });
    const reopened = await orderModel.findById(a.order._id).lean<{ order_status: string; cancelled_reason: unknown }>();
    expect(reopened!.order_status).toBe("pending");
    expect(reopened!.cancelled_reason).toBeNull();
    expect(await stock(a.p._id)).toBe(8);

    // ของหมดระหว่างนั้น → เปิดกลับไม่ได้ ไม่สร้าง payment
    const c = await webOrder(2, 2);
    await orderService.expireUnpaidOrders({ now: later(31 * MIN) });
    await productModel.updateOne({ _id: c.p._id }, { $set: { product_stock_quantity: 1 } });
    await expect(
      paymentService.createPayment({
        user_id: c.uid, order_id: c.oid, amount: c.order.total_amount, slip_image_url: "/api/files/slips/c.jpg",
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(await paymentModel.countDocuments({ order_id: c.order._id })).toBe(0);
    expect((await orderModel.findById(c.order._id).lean<{ order_status: string }>())!.order_status).toBe("cancelled");
  });
});

describe("นโยบายยกเลิกของลูกค้า", () => {
  it("ชำระแล้วยกเลิกได้ → ยกเลิก + ชำระแล้ว (รอโอนคืน) · payment ยัง paid · แจ้งร้าน · ร้านกดคืนเงินทีหลังได้", async () => {
    const a = await webOrder();
    const admin = await makeUser();
    const pay = (await paymentService.createPayment({
      user_id: a.uid, order_id: a.oid, amount: a.order.total_amount, slip_image_url: "/api/files/slips/a.jpg",
    })) as { _id: unknown };
    await paymentService.verifyPayment(String(pay._id), { verified_by: String(admin._id), approved: true });

    await orderService.cancelOrderByCustomer(a.oid, a.uid, "เปลี่ยนใจ");
    const o = await orderModel.findById(a.order._id).lean<{ order_status: string; payment_status: string }>();
    expect(o).toMatchObject({ order_status: "cancelled", payment_status: "paid" });
    expect((await paymentModel.findById(pay._id).lean<{ status: string }>())!.status).toBe("paid");
    expect(await stock(a.p._id)).toBe(10);
    for (let i = 0; i < 40 && !(await notificationModel.exists({ title: /รอโอนเงินคืน/ })); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(await notificationModel.exists({ title: new RegExp(`${a.order.order_no} — รอโอนเงินคืน`) })).toBeTruthy();

    await paymentService.refundPayment(String(pay._id), { verified_by: String(admin._id) });
    expect((await orderModel.findById(a.order._id).lean<{ payment_status: string }>())!.payment_status).toBe("refunded");
  });

  it("ร้านเริ่มเตรียมแล้ว / ออเดอร์หน้าร้าน → 409", async () => {
    const a = await webOrder();
    await orderService.updateOrderStatus(a.oid, "confirmed");
    await orderService.updateOrderStatus(a.oid, "preparing");
    await expect(orderService.cancelOrderByCustomer(a.oid, a.uid)).rejects.toMatchObject({ status: 409 });

    const user = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 5 });
    const pos = (await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      channel: "instore",
      items: [{ product_id: String(p._id), quantity: 1 }],
    })) as { _id: unknown };
    await expect(orderService.cancelOrderByCustomer(String(pos._id), String(user._id))).rejects.toMatchObject({ status: 409 });
  });
});

describe("ลิงก์หน้าชำระเงิน + QR", () => {
  it("ออกลิงก์ → ใช้ได้ครั้งเดียว · คนอื่นใช้ไม่ได้ · เก็บเป็น hash", async () => {
    const a = await webOrder();
    const other = await makeUser();
    const { token } = await paymentLinkService.createPaymentLink(a.uid, "order", a.oid);
    const raw = await orderModel.findById(a.order._id).select("+payment_link_token").lean<{ payment_link_token: string }>();
    expect(raw!.payment_link_token).not.toBe(token);

    await expect(paymentLinkService.redeemPaymentLink(String(other._id), "order", token)).rejects.toMatchObject({ status: 410 });
    expect(await paymentLinkService.redeemPaymentLink(a.uid, "order", token)).toEqual({ kind: "order", id: a.oid });
    await expect(paymentLinkService.redeemPaymentLink(a.uid, "order", token)).rejects.toMatchObject({ status: 410 });
    await expect(paymentLinkService.createPaymentLink(String(other._id), "order", a.oid)).rejects.toMatchObject({ status: 404 });
  });

  it("หน้าชำระเงิน: มีเลขพร้อมเพย์ → QR · ไม่มี → qr_error · หมดเวลา → late_upload", async () => {
    const a = await webOrder();
    const noQr = await paymentService.getPaymentPage("order", a.oid, a.uid);
    expect(noQr).toMatchObject({ can_pay: true, qr_image: null, amount: 200 });
    expect(noQr.qr_error).toContain("พร้อมเพย์");

    process.env.PROMPTPAY_ID = "0812345678";
    const page = await paymentService.getPaymentPage("order", a.oid, a.uid);
    expect(page.qr_image).toMatch(/^data:image\/png;base64,/);
    expect(page.payment_due_at).toBeTruthy();

    await orderModel.updateOne({ _id: a.order._id }, { $set: { payment_due_at: new Date(Date.now() - MIN) } });
    const expired = await paymentService.getPaymentPage("order", a.oid, a.uid);
    expect(expired).toMatchObject({ order_status: "cancelled", can_pay: false, late_upload: true, qr_image: null });

    const other = await makeUser();
    await expect(paymentService.getPaymentPage("order", a.oid, String(other._id))).rejects.toMatchObject({ status: 404 });
  });
});
