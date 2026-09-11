import { describe, it, expect } from "vitest";
import preorderModel from "@/models/preorderModel";
import paymentModel from "@/models/paymentModel";
import * as preorderService from "@/services/preorderService";
import * as paymentService from "@/services/paymentService";
import { makeUser, makePreorder } from "./helpers";

/**
 * BACKLOG §2b.2–2b.4 — preorder payment/cancellation path ไม่เคยได้ hardening
 * แบบเดียวกับ order path (§2.7/2.8) มาก่อน เทสนี้ยืนยันทั้ง 3 จุดที่แก้:
 *   - 2b.2: จ่ายเงินพรีออเดอร์แล้ว auto-confirm order_status pending→confirmed
 *   - 2b.3: แอดมินยกเลิกพรีออเดอร์ที่จ่ายแล้ว → auto-refund
 *   - 2b.4: ลูกค้ายกเลิกพรีออเดอร์ที่จ่ายแล้วเองไม่ได้ (allowedFrom + payment guard)
 */
describe("preorderService — payment/cancellation hardening (BACKLOG 2b)", () => {
  it("2b.2: verify payment ของพรีออเดอร์ → payment_status=paid + order_status pending→confirmed อัตโนมัติ", async () => {
    const customer = await makeUser();
    const admin = await makeUser();
    const preorder = await makePreorder(String(customer._id), { total_amount: 200 });

    const payment = await paymentService.createPayment({
      user_id: String(customer._id),
      preorder_id: String(preorder._id),
      amount: 200,
    });
    await paymentService.verifyPayment(String(payment._id), {
      verified_by: String(admin._id),
      approved: true,
    });

    const updated = await preorderModel
      .findById(preorder._id)
      .lean<{ payment_status: string; order_status: string } | null>();
    expect(updated!.payment_status).toBe("paid");
    expect(updated!.order_status).toBe("confirmed"); // auto-advance จาก pending
  });

  it("2b.3: แอดมินยกเลิกพรีออเดอร์ที่จ่ายแล้ว → auto-refund (payment + preorder.payment_status = refunded)", async () => {
    const customer = await makeUser();
    const admin = await makeUser();
    const preorder = await makePreorder(String(customer._id), { total_amount: 300 });

    const payment = await paymentService.createPayment({
      user_id: String(customer._id),
      preorder_id: String(preorder._id),
      amount: 300,
    });
    await paymentService.verifyPayment(String(payment._id), {
      verified_by: String(admin._id),
      approved: true,
    });

    const cancelled = await preorderService.updatePreorderStatus(String(preorder._id), "cancelled", {
      cancelled_by: String(admin._id),
    });

    expect(cancelled.order_status).toBe("cancelled");
    expect(
      (await preorderModel.findById(preorder._id).lean<{ payment_status: string } | null>())!
        .payment_status
    ).toBe("refunded");
    expect(
      (await paymentModel.findById(payment._id).lean<{ status: string } | null>())!.status
    ).toBe("refunded");
  });

  it("2b.4: ลูกค้ายกเลิกพรีออเดอร์ที่จ่ายแล้วเอง → 409 (ต้องติดต่อร้าน) ไม่ยกเลิกจริง", async () => {
    const customer = await makeUser();
    const admin = await makeUser();
    const preorder = await makePreorder(String(customer._id), { total_amount: 120 });

    const payment = await paymentService.createPayment({
      user_id: String(customer._id),
      preorder_id: String(preorder._id),
      amount: 120,
    });
    await paymentService.verifyPayment(String(payment._id), {
      verified_by: String(admin._id),
      approved: true,
    });

    await expect(
      preorderService.cancelPreorder(String(preorder._id), {
        cancelled_by: String(customer._id),
        allowedFrom: preorderService.CUSTOMER_CANCELABLE_STATUSES,
      })
    ).rejects.toThrow(/ชำระเงินแล้ว/);

    expect(
      (await preorderModel.findById(preorder._id).lean<{ order_status: string } | null>())!
        .order_status
    ).not.toBe("cancelled");
  });

  it("2b.4: ลูกค้ายกเลิกพรีออเดอร์ตอนสถานะ preparing (เกิน allowedFrom) เอง → 409", async () => {
    const customer = await makeUser();
    const preorder = await makePreorder(String(customer._id), {
      total_amount: 90,
      order_status: "preparing",
    });

    await expect(
      preorderService.cancelPreorder(String(preorder._id), {
        cancelled_by: String(customer._id),
        allowedFrom: preorderService.CUSTOMER_CANCELABLE_STATUSES,
      })
    ).rejects.toThrow(/ยกเลิกพรีออเดอร์เองได้เฉพาะ/);
  });

  it("2b.4: ลูกค้ายกเลิกพรีออเดอร์ตอนยังไม่จ่ายเงิน (pending) → ยกเลิกได้ปกติ", async () => {
    const customer = await makeUser();
    const preorder = await makePreorder(String(customer._id), { total_amount: 90 });

    const cancelled = await preorderService.cancelPreorder(String(preorder._id), {
      cancelled_by: String(customer._id),
      allowedFrom: preorderService.CUSTOMER_CANCELABLE_STATUSES,
    });

    expect(cancelled.order_status).toBe("cancelled");
  });
});
