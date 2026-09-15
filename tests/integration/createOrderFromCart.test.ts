import { describe, it, expect, vi, afterEach } from "vitest";
import orderModel from "@/models/orderModel";
import * as orderService from "@/services/orderService";
import * as cartService from "@/services/cartService";
import { makeUser, makeProduct } from "./helpers";

/**
 * BACKLOG §2c.1 — createOrderFromCart() เดิมไม่มี .catch() ห่อ cartService.clearCart()
 * (ต่างจากจุดอื่นในไฟล์เดียวกันที่รันหลัง order commit แล้ว เช่น notificationService.notify)
 * ถ้า clearCart throw ทั้งที่ order สร้างสำเร็จ client จะเห็น 500 ทั้งที่จริงสำเร็จแล้ว
 * เทสนี้ยืนยันว่าตอนนี้ clearCart พัง ไม่ทำให้ createOrderFromCart throw ตาม (order ยังคืนกลับมาปกติ)
 */
describe("orderService.createOrderFromCart — clearCart best-effort (BACKLOG 2c.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clearCart throw หลัง order commit แล้ว → createOrderFromCart ยังสำเร็จ (ไม่ throw ตาม)", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });
    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 2 });

    vi.spyOn(cartService, "clearCart").mockRejectedValueOnce(new Error("DB สะดุดชั่วคราว"));

    const order = await orderService.createOrderFromCart(String(user._id), { order_type: "takeaway" });

    expect(order).toBeTruthy();
    expect(order.total_amount).toBe(200);
    // order ถูกบันทึกจริงใน DB แม้ clearCart จะพัง
    expect(await orderModel.findById(order._id).lean()).toBeTruthy();
  });

  it("กรณีปกติ (clearCart ไม่พัง) → ตะกร้าว่างหลังสร้างออเดอร์เหมือนเดิม", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 1 });

    await orderService.createOrderFromCart(String(user._id), { order_type: "takeaway" });

    const detail = await cartService.getCartDetail(String(user._id));
    expect(detail.items.length).toBe(0);
  });
});
