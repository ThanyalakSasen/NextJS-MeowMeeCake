import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import orderModel from "@/models/orderModel";
import productModel from "@/models/productModel";
import promotionModel from "@/models/promotionModel";
import paymentModel from "@/models/paymentModel";
import * as orderService from "@/services/orderService";
import * as paymentService from "@/services/paymentService";
import { makeUser, makeProduct } from "./helpers";

async function makePromo(over: Record<string, unknown> = {}) {
  return promotionModel.create({
    promotion_code: "C" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    promotion_name: "cancel test",
    discount_type: "Amount",
    discount_value: 20,
    start_date: new Date(Date.now() - 86_400_000),
    end_date: new Date(Date.now() + 86_400_000),
    created_by: new mongoose.Types.ObjectId(),
    ...over,
  });
}

describe("orderService.updateOrderStatus — cancel path (integration)", () => {
  it("cancel ออเดอร์ที่ยังไม่จ่าย → คืนสต็อก + status=cancelled + cancelled_at", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 3 }],
    });
    expect((await productModel.findById(p._id).lean())!.product_stock_quantity).toBe(7);

    const cancelled = await orderService.cancelOrder(String(order._id), {
      cancelled_by: String(user._id),
      cancelled_reason: "เปลี่ยนใจ",
    });

    expect(cancelled.order_status).toBe("cancelled");
    expect(cancelled.cancelled_at).toBeTruthy();
    expect(cancelled.cancelled_reason).toBe("เปลี่ยนใจ");
    // สต็อกคืนครบ
    expect((await productModel.findById(p._id).lean())!.product_stock_quantity).toBe(10);
  });

  it("cancel ออเดอร์ที่ใช้โปรโมชัน → คืนสิทธิ์ (used_count กลับ)", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 200, product_stock_quantity: 5 });
    const promo = await makePromo({ usage_limit: 3 });

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      promotion_code: promo.promotion_code,
      items: [{ product_id: String(p._id), quantity: 1 }],
    });
    expect(order.discount_amount).toBe(20);
    expect((await promotionModel.findById(promo._id).lean())!.used_count).toBe(1);

    await orderService.cancelOrder(String(order._id), { cancelled_by: String(user._id) });
    expect((await promotionModel.findById(promo._id).lean())!.used_count).toBe(0);
  });

  it("cancel ออเดอร์ที่จ่ายเงินแล้ว (admin) → auto-refund: payment + order.payment_status = refunded", async () => {
    const customer = await makeUser();
    const admin = await makeUser();
    const p = await makeProduct({ product_price: 150, product_stock_quantity: 8 });

    const order = await orderService.createOrder(String(customer._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 2 }], // total 300
    });

    const payment = await paymentService.createPayment({
      user_id: String(customer._id),
      order_id: String(order._id),
      amount: order.total_amount,
      slip_image_url: "https://x/slip.jpg",
    });
    await paymentService.verifyPayment(String(payment._id), {
      verified_by: String(admin._id),
      approved: true,
    });
    expect((await orderModel.findById(order._id).lean())!.payment_status).toBe("paid");

    // admin ยกเลิก (updateOrderStatus ตรง — ไม่ผ่าน allowedFrom guard)
    const cancelled = await orderService.cancelOrder(String(order._id), {
      cancelled_by: String(admin._id),
    });

    expect(cancelled.order_status).toBe("cancelled");
    expect((await orderModel.findById(order._id).lean())!.payment_status).toBe("refunded");
    expect((await paymentModel.findById(payment._id).lean())!.status).toBe("refunded");
    // สต็อกคืน
    expect((await productModel.findById(p._id).lean())!.product_stock_quantity).toBe(8);
  });

  it("ลูกค้ายกเลิกออเดอร์ที่จ่ายแล้ว → 409 (ต้องติดต่อร้าน)", async () => {
    const customer = await makeUser();
    const admin = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 5 });

    const order = await orderService.createOrder(String(customer._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 1 }],
    });
    const payment = await paymentService.createPayment({
      user_id: String(customer._id),
      order_id: String(order._id),
      amount: order.total_amount,
      slip_image_url: "https://x/s.jpg",
    });
    await paymentService.verifyPayment(String(payment._id), {
      verified_by: String(admin._id),
      approved: true,
    });

    await expect(
      orderService.cancelOrder(String(order._id), {
        cancelled_by: String(customer._id),
        allowedFrom: orderService.CUSTOMER_CANCELABLE_STATUSES,
      })
    ).rejects.toThrow(/ชำระเงินแล้ว/);

    // ยังไม่ถูกยกเลิก
    expect((await orderModel.findById(order._id).lean())!.order_status).not.toBe("cancelled");
  });
});
