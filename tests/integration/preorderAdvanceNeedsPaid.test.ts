import { describe, it, expect } from "vitest";
import preorderModel from "@/models/preorderModel";
import * as preorderService from "@/services/preorderService";
import { makeUser, makePreorder } from "./helpers";

/**
 * พรีออเดอร์ที่ยังไม่ชำระเลื่อนสถานะไปข้างหน้าไม่ได้ (ยกเลิกได้อย่างเดียว) — เดิมแอดมินเลื่อนไปจน completed ได้
 * แล้วหลุดการยกเลิกอัตโนมัติ (cancelUnpaidPreorders ข้าม completed) ไม่นับรายรับ ไม่เข้าใบผลิต
 */
async function preorder(over: Record<string, unknown>) {
  const user = await makeUser();
  return String((await makePreorder(String(user._id), over))._id);
}

describe("เลื่อนสถานะพรีออเดอร์ต้องชำระแล้ว", () => {
  it("ยังไม่ชำระ → 409 และสถานะไม่เปลี่ยน", async () => {
    for (const payment_status of ["pending", "failed"]) {
      const id = await preorder({ order_status: "pending", payment_status });
      await expect(preorderService.updatePreorderStatus(id, "confirmed")).rejects.toMatchObject({ status: 409 });
      expect((await preorderModel.findById(id).lean())?.order_status).toBe("pending");
    }
  });

  it("ยืนยันแล้วแต่ยังไม่ชำระ (ข้อมูลเก่า) → เลื่อนต่อไม่ได้", async () => {
    const id = await preorder({ order_status: "confirmed", payment_status: "pending" });
    await expect(preorderService.updatePreorderStatus(id, "preparing")).rejects.toMatchObject({ status: 409 });
  });

  it("ยังไม่ชำระ → ยกเลิกได้", async () => {
    const id = await preorder({ order_status: "pending", payment_status: "pending" });
    await preorderService.updatePreorderStatus(id, "cancelled");
    expect((await preorderModel.findById(id).lean())?.order_status).toBe("cancelled");
  });

  it("ชำระแล้ว → เลื่อนได้ตามปกติ", async () => {
    const id = await preorder({ order_status: "preparing", payment_status: "paid" });
    await preorderService.updatePreorderStatus(id, "ready");
    expect((await preorderModel.findById(id).lean())?.order_status).toBe("ready");
  });
});
