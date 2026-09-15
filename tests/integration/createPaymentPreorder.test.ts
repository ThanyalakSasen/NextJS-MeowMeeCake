import { describe, it, expect } from "vitest";
import * as paymentService from "@/services/paymentService";
import { makeUser, makePreorder } from "./helpers";

/**
 * BACKLOG §2b.1 — createPayment() branch preorder เคยไม่เช็ค ownership / cancelled-status /
 * amount-tolerance เหมือน branch order (paymentService.ts) — ผู้ใช้คนไหนก็ได้ยิง preorder_id
 * ของคนอื่นแล้วสร้าง payment แทนได้ (IDOR) เทสนี้ยืนยันว่า 3 เช็คที่เพิ่มเข้าไปทำงานจริง
 */
describe("paymentService.createPayment — preorder branch (BACKLOG 2b.1)", () => {
  it("preorder_id ของคนอื่น → 400 ไม่ให้สร้าง payment", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    // total_amount เป็นสตางค์ (BACKLOG §3.11) — 25000 = 250 บาท · amount ที่ paymentService.createPayment
    // รับยังเป็นบาทเหมือนเดิม (API ไม่เปลี่ยน) แปลงเป็นสตางค์เทียบกันภายใน
    const preorder = await makePreorder(String(owner._id), { total_amount: 25000 });

    await expect(
      paymentService.createPayment({
        user_id: String(stranger._id), // คนละคนกับเจ้าของพรีออเดอร์
        preorder_id: String(preorder._id),
        amount: 250,
      })
    ).rejects.toThrow(/ไม่ได้เป็นของผู้ใช้/);
  });

  it("พรีออเดอร์ที่ถูกยกเลิกแล้ว → 409 ไม่ให้สร้าง payment", async () => {
    const owner = await makeUser();
    const preorder = await makePreorder(String(owner._id), {
      total_amount: 15000,
      order_status: "cancelled",
    });

    await expect(
      paymentService.createPayment({
        user_id: String(owner._id),
        preorder_id: String(preorder._id),
        amount: 150,
      })
    ).rejects.toThrow(/ถูกยกเลิกแล้ว/);
  });

  it("amount ไม่ตรงกับ total_amount → 400", async () => {
    const owner = await makeUser();
    const preorder = await makePreorder(String(owner._id), { total_amount: 30000 });

    await expect(
      paymentService.createPayment({
        user_id: String(owner._id),
        preorder_id: String(preorder._id),
        amount: 999, // ไม่ตรงยอด
      })
    ).rejects.toThrow(/ยอดชำระต้องเท่ากับยอดพรีออเดอร์/);
  });

  it("เจ้าของจริง + สถานะปกติ + amount ตรง → สร้าง payment สำเร็จ", async () => {
    const owner = await makeUser();
    const preorder = await makePreorder(String(owner._id), { total_amount: 18000 });

    const payment = await paymentService.createPayment({
      user_id: String(owner._id),
      preorder_id: String(preorder._id),
      amount: 180,
    });

    expect(payment.status).toBe("pending");
    expect(payment.amount).toBe(180); // presentPayment แปลงกลับเป็นบาทให้แล้ว
    expect(String(payment.preorder_id)).toBe(String(preorder._id));
  });
});
