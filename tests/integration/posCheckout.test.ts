import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import orderModel from "@/models/orderModel";
import paymentModel from "@/models/paymentModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import * as orderService from "@/services/orderService";
import { POST as checkoutPOST } from "@/app/api/admin/pos/orders/[id]/checkout/route";
import { makeUser, makeProduct } from "./helpers";

/**
 * POST /api/admin/pos/orders/[id]/checkout — พนักงานที่ขายหน้าร้านได้ (orders.create) รับเงินแล้วอนุมัติการชำระอัตโนมัติ
 * ไม่ต้องมี payments.approve · ใช้ได้เฉพาะออเดอร์หน้าร้าน (POS-) — ออเดอร์เว็บยังต้องตรวจสลิปโดยผู้มีสิทธิ์อนุมัติ
 */

async function staff(perms: Record<string, Record<string, boolean>>) {
  const role = await roleModel.create({ role_name: `pos-co-${Math.random()}`, role_type: "staff" });
  const user = await makeUser({ role_id: role._id });
  for (const [menu_key, flags] of Object.entries(perms)) {
    await createPermission({ role_id: String(role._id), menu_key: menu_key as never, granted_by: String(user._id), ...flags });
  }
  const session: SessionUser = {
    user_id: String(user._id), role_id: String(role._id), role_type: "staff",
    email: user.email, source: "jwt", auth_time: Date.now(),
  };
  return session;
}

async function placeOrder(channel: "online" | "instore") {
  const customer = await makeUser();
  const p = await makeProduct({ product_price: 120, product_stock_quantity: 10 });
  const order = (await orderService.createOrder(String(customer._id), {
    order_type: "takeaway",
    items: [{ product_id: String(p._id), quantity: 2 }],
    channel,
  })) as { _id: unknown; order_no: string; total_amount: number };
  return String(order._id);
}

async function call(session: SessionUser, orderId: string) {
  const req = new NextRequest(`http://localhost:3000/api/admin/pos/orders/${orderId}/checkout`, {
    method: "POST",
    headers: { [USER_HEADER]: JSON.stringify(session) },
  });
  const res = await (checkoutPOST as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(req, {
    params: Promise.resolve({ id: orderId }),
  });
  return { status: res.status, body: await res.json() };
}

describe("POST /api/admin/pos/orders/[id]/checkout", () => {
  it("พนักงานหน้าร้าน (orders.create ไม่มีสิทธิ์การชำระเงินเลย) รับเงินได้ · ชำระแล้ว + ออเดอร์ completed · ผู้ยืนยัน = ผู้ขาย", async () => {
    const session = await staff({ orders: { can_view: true, can_create: true } });
    const oid = await placeOrder("instore");
    const { status, body } = await call(session, oid);
    expect(status).toBe(200);
    const order = await orderModel.findById(oid).lean<{ order_status: string; payment_status: string }>();
    expect(order!.order_status).toBe("completed");
    expect(order!.payment_status).toBe("paid");
    const payment = await paymentModel.findOne({ order_id: oid }).lean<{ status: string; verified_by: unknown; amount: number }>();
    expect(payment!.status).toBe("paid");
    expect(String(payment!.verified_by)).toBe(session.user_id);
    expect(payment!.amount).toBe(240);
    expect(body.data.payment.status).toBe("paid");
  });

  it("มีแค่ orders.view (ดูได้แต่ขายไม่ได้) = 403", async () => {
    const oid = await placeOrder("instore");
    expect((await call(await staff({ orders: { can_view: true } }), oid)).status).toBe(403);
  });

  it("ออเดอร์เว็บ (ORD-) = 400 — ยังต้องตรวจสลิปผ่าน payments.approve", async () => {
    const oid = await placeOrder("online");
    const { status } = await call(await staff({ orders: { can_view: true, can_create: true } }), oid);
    expect(status).toBe(400);
    expect(await paymentModel.countDocuments({ order_id: oid })).toBe(0);
  });

  it("กดรับเงินซ้ำ = 409 ไม่สร้างรายการชำระเพิ่ม", async () => {
    const session = await staff({ orders: { can_view: true, can_create: true } });
    const oid = await placeOrder("instore");
    expect((await call(session, oid)).status).toBe(200);
    expect((await call(session, oid)).status).toBe(409);
    expect(await paymentModel.countDocuments({ order_id: oid })).toBe(1);
  });
});
