import { describe, it, expect, vi } from "vitest";
import notificationModel from "@/models/notificationModel";
import * as orderService from "@/services/orderService";
import * as paymentService from "@/services/paymentService";
import { makeUser, makeProduct, makePreorder } from "./helpers";

/**
 * docs/LINE.md §9.11 — หัวข้อแจ้งเตือน "สลิปรอตรวจ" แสดงเลขเอกสาร (ORD-/POS-/PRE-…) ไม่ใช่ ObjectId
 * notify() เป็น fire-and-forget → รอด้วย vi.waitFor
 */

const slipNote = () =>
  notificationModel.findOne({ title: /^มีคำสั่งซื้อรอตรวจสอบสลิปโอนเงิน/ }).lean<{ title: string; module: string }>();

describe("แจ้งเตือนสลิปรอตรวจ — แสดงเลขออเดอร์", () => {
  it("ออเดอร์ → หัวข้อมี order_no ไม่มี ObjectId", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 5 });
    const order = (await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      channel: "online",
      items: [{ product_id: String(p._id), quantity: 1 }],
    })) as { _id: unknown; order_no: string; total_amount: number };
    const payment = (await paymentService.createPayment({
      user_id: String(user._id),
      order_id: String(order._id),
      amount: order.total_amount,
    })) as { _id: unknown };

    await paymentService.submitSlip(String(payment._id), { slip_image_url: "/api/files/slips/x.jpg" });

    await vi.waitFor(async () => expect(await slipNote()).toBeTruthy());
    const note = (await slipNote())!;
    expect(note.title).toContain(order.order_no);
    expect(note.title).not.toContain(String(order._id));
    expect(note.module).toBe("finance");
  });

  it("พรีออเดอร์ → หัวข้อมี preorder_no", async () => {
    const user = await makeUser();
    const pre = await makePreorder(String(user._id), { total_amount: 150 });
    const payment = (await paymentService.createPayment({
      user_id: String(user._id),
      preorder_id: String(pre._id),
      amount: 150,
    })) as { _id: unknown };

    await paymentService.submitSlip(String(payment._id), { slip_image_url: "/api/files/slips/y.jpg" });

    await vi.waitFor(async () => expect(await slipNote()).toBeTruthy());
    const note = (await slipNote())!;
    expect(note.title).toContain(pre.preorder_no);
    expect(note.title).not.toContain(String(pre._id));
  });
});
