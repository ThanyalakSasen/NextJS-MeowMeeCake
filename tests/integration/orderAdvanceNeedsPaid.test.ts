import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import * as orderService from "@/services/orderService";
import { makeUser, makeProduct } from "./helpers";

/**
 * ออเดอร์ที่ยังไม่ชำระเลื่อนสถานะไปข้างหน้าไม่ได้ (ยกเลิกได้อย่างเดียว) — แบบเดียวกับพรีออเดอร์
 * เดิมเรียก API ตรงเลื่อนออเดอร์ที่ยังไม่จ่ายไปจน completed ได้ (ส่งของโดยไม่ได้เงิน)
 */
async function order(channel: "online" | "instore" = "online") {
  const user = await makeUser();
  const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });
  const o = (await orderService.createOrder(String(user._id), {
    order_type: "takeaway",
    channel,
    storefront: channel === "online",
    items: [{ product_id: String(p._id), quantity: 1 }],
  })) as { _id: unknown };
  return String(o._id);
}
const statusOf = async (id: string) => (await orderModel.findById(id).lean<{ order_status: string }>())?.order_status;

describe("เลื่อนสถานะออเดอร์ต้องชำระแล้ว", () => {
  it("ยังไม่ชำระ (ออนไลน์/หน้าร้าน) → 409 และสถานะไม่เปลี่ยน", async () => {
    for (const channel of ["online", "instore"] as const) {
      const id = await order(channel);
      await expect(orderService.updateOrderStatus(id, "confirmed")).rejects.toMatchObject({ status: 409 });
      expect(await statusOf(id)).toBe("pending");
    }
  });

  it("ยืนยันแล้วแต่ยังไม่ชำระ (ข้อมูลเก่า) → เลื่อนต่อไม่ได้", async () => {
    const id = await order();
    await orderModel.updateOne({ _id: id }, { $set: { order_status: "confirmed", payment_status: "failed" } });
    await expect(orderService.updateOrderStatus(id, "preparing")).rejects.toMatchObject({ status: 409 });
    expect(await statusOf(id)).toBe("confirmed");
  });

  it("ยังไม่ชำระ → ยกเลิกได้", async () => {
    const id = await order();
    await orderService.updateOrderStatus(id, "cancelled");
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("ชำระแล้ว → เลื่อนได้ตามปกติ", async () => {
    const id = await order();
    await orderModel.updateOne({ _id: id }, { $set: { payment_status: "paid" } });
    await orderService.updateOrderStatus(id, "confirmed");
    expect(await statusOf(id)).toBe("confirmed");
  });
});
