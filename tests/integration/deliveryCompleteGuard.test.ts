import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import * as orderService from "@/services/orderService";
import * as preorderService from "@/services/preorderService";
import { makeUser, makeProduct, makePreorder } from "./helpers";

/**
 * ออเดอร์/พรีออเดอร์แบบจัดส่งปิดเป็น completed ได้ต้องระบุขนส่งแล้ว + เลขพัสดุ (เฉพาะขนส่งพัสดุ)
 * — lib/orderLifecycle.ts assertDeliveryReadyToComplete · รับเอง/POS ไม่เช็ค
 */

async function readyOrder(over: Record<string, unknown>, channel: "online" | "instore" = "online") {
  const user = await makeUser();
  const p = await makeProduct({ product_price: 100, product_stock_quantity: 50 });
  const order = (await orderService.createOrder(String(user._id), {
    order_type: "takeaway",
    channel,
    storefront: channel === "online",
    items: [{ product_id: String(p._id), quantity: 1 }],
  })) as { _id: unknown };
  const id = String(order._id);
  // ข้ามขั้นชำระ/เตรียม — เทสนี้ดูแค่การปิด ready → completed
  await orderModel.updateOne({ _id: id }, { $set: { order_status: "ready", payment_status: "paid", ...over } });
  return id;
}

async function readyPreorder(over: Record<string, unknown>) {
  const user = await makeUser();
  const pre = await makePreorder(String(user._id), { order_status: "ready", payment_status: "paid", ...over });
  return String(pre._id);
}

describe("ออเดอร์แบบจัดส่ง ready → completed", () => {
  it("ยังไม่ระบุขนส่ง → 400 และสถานะไม่เปลี่ยน", async () => {
    const id = await readyOrder({ order_type: "delivery" });
    await expect(orderService.updateOrderStatus(id, "completed")).rejects.toMatchObject({ status: 400 });
    expect((await orderModel.findById(id).lean())?.order_status).toBe("ready");
  });

  it("ขนส่งพัสดุแต่ไม่มีเลขพัสดุ → 400", async () => {
    const id = await readyOrder({ order_type: "delivery", shipping_carrier: "kerry" });
    await expect(orderService.updateOrderStatus(id, "completed")).rejects.toMatchObject({ status: 400 });
  });

  it("ขนส่งพัสดุ + เลขพัสดุ → ปิดได้", async () => {
    const id = await readyOrder({ order_type: "delivery", shipping_carrier: "kerry", tracking_no: "KEX123" });
    await orderService.updateOrderStatus(id, "completed");
    expect((await orderModel.findById(id).lean())?.order_status).toBe("completed");
  });

  it("ไรเดอร์/ร้านส่งเอง ไม่ต้องมีเลขพัสดุ", async () => {
    for (const carrier of ["grab", "store"]) {
      const id = await readyOrder({ order_type: "delivery", shipping_carrier: carrier });
      await orderService.updateOrderStatus(id, "completed");
      expect((await orderModel.findById(id).lean())?.order_status).toBe("completed");
    }
  });

  it("รับเอง และออเดอร์หน้าร้าน (POS) ไม่เช็ค", async () => {
    const takeaway = await readyOrder({});
    await orderService.updateOrderStatus(takeaway, "completed");
    const pos = await readyOrder({ order_type: "delivery" }, "instore");
    await orderService.updateOrderStatus(pos, "completed");
    expect((await orderModel.findById(pos).lean())?.order_status).toBe("completed");
  });
});

describe("พรีออเดอร์แบบจัดส่ง ready → completed", () => {
  it("ยังไม่ระบุขนส่ง → 400", async () => {
    const id = await readyPreorder({ order_type: "delivery" });
    await expect(preorderService.updatePreorderStatus(id, "completed")).rejects.toMatchObject({ status: 400 });
  });

  it("ขนส่งพัสดุ + เลขพัสดุ → ปิดได้ · รับเองไม่เช็ค", async () => {
    const delivery = await readyPreorder({ order_type: "delivery", shipping_carrier: "flash", tracking_no: "TH01" });
    await preorderService.updatePreorderStatus(delivery, "completed");
    const takeaway = await readyPreorder({});
    await preorderService.updatePreorderStatus(takeaway, "completed");
  });
});
