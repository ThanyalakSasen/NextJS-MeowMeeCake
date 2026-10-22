import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import paymentModel from "@/models/paymentModel";
import { parsePagination } from "@/lib/queryParams";
import * as orderService from "@/services/orderService";
import { makeUser } from "./helpers";

/**
 * GET /admin/orders — slip_pending_review แยก "แนบสลิปแล้ว รอตรวจ" ออกจาก "ยังไม่แนบสลิป"
 * (order.payment_status = pending ทั้งคู่) ให้หน้าจัดการคำสั่งซื้อแบ่งรายการได้
 */
describe("orderService.listOrders — slip_pending_review", () => {
  it("true เฉพาะ payment ใบล่าสุดที่ยัง pending และมีสลิป", async () => {
    const u = await makeUser();
    const make = (no: string) =>
      orderModel.create({ order_no: no, user_id: u._id, order_type: "delivery", subtotal: 100, total_amount: 100 });

    const noPayment = await make("ORD-SLIP-NONE");
    const noSlip = await make("ORD-SLIP-EMPTY");
    const withSlip = await make("ORD-SLIP-PENDING");
    const rejected = await make("ORD-SLIP-FAILED");

    const pay = async (orderId: unknown, status: string, slip: string | null) => {
      const p = await paymentModel.create({ order_id: orderId, user_id: u._id, amount: 100, status, slip_image_url: slip });
      await orderModel.updateOne({ _id: orderId }, { $set: { payment_id: p._id } });
    };
    await pay(noSlip._id, "pending", null);
    await pay(withSlip._id, "pending", "slips/a.jpg");
    await pay(rejected._id, "failed", "slips/b.jpg");

    const { items } = await orderService.listOrders({ pagination: parsePagination(new URLSearchParams()) } as never);
    const rows = items as { _id: unknown; slip_pending_review?: boolean }[];
    const flag = (id: unknown) => rows.find((o) => String(o._id) === String(id))?.slip_pending_review;

    expect(flag(noPayment._id)).toBe(false);
    expect(flag(noSlip._id)).toBe(false);
    expect(flag(withSlip._id)).toBe(true);
    expect(flag(rejected._id)).toBe(false);
  });
});
