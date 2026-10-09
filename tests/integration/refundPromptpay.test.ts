import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import orderModel from "@/models/orderModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { parsePagination } from "@/lib/queryParams";
import * as userService from "@/services/userService";
import { GET as meGET, PATCH as mePATCH } from "@/app/api/shop/me/route";
import { GET as adminOrderGET } from "@/app/api/admin/orders/[id]/route";
import { GET as adminPreorderGET } from "@/app/api/admin/preorders/[id]/route";
import { makeUser, makePreorder } from "./helpers";

/**
 * บัญชีพร้อมเพย์รับเงินคืนของลูกค้า (frontend Q-BE12 · U9 · I2)
 *  - ลูกค้าตั้ง/ล้างเองที่ PATCH /shop/me · เห็นใน GET /shop/me
 *  - ไม่ออกทาง /admin/users (อาจเป็นเลขบัตรประชาชน)
 *  - หลังร้านเห็นเป็น refund_account ใน GET /admin/orders/:id · /admin/preorders/:id เฉพาะตอนรอโอนคืน
 */

async function sessionFor(roleType: "customer" | "owner") {
  const role = await roleModel.create({ role_name: `${roleType}-${Math.random()}`, role_type: roleType });
  const user = await makeUser({ role_id: role._id, is_email_verified: true });
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: roleType,
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return { user, session };
}

const req = (url: string, session: SessionUser, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const patchMe = async (session: SessionUser, body: unknown) => {
  const res = await mePATCH(req("/api/shop/me", session, { method: "PATCH", body }));
  return { status: res.status, body: await res.json() };
};

const ctx = (id: unknown) => ({ params: Promise.resolve({ id: String(id) }) });

describe("PATCH /api/shop/me — refund_promptpay_*", () => {
  it("ตั้งเบอร์มือถือ (ตัดขีด/ช่องว่างให้) + ชื่อบัญชี → GET /shop/me เห็นค่าเดียวกัน", async () => {
    const { session } = await sessionFor("customer");
    const res = await patchMe(session, { refund_promptpay_id: "081-234 5678", refund_promptpay_name: " สมชาย ใจดี " });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ refund_promptpay_id: "0812345678", refund_promptpay_name: "สมชาย ใจดี" });

    const me = await (await meGET(req("/api/shop/me", session))).json();
    expect(me.data.user).toMatchObject({ refund_promptpay_id: "0812345678", refund_promptpay_name: "สมชาย ใจดี" });
  });

  it("รับเลขบัตรประชาชน 13 หลัก", async () => {
    const { session } = await sessionFor("customer");
    const res = await patchMe(session, { refund_promptpay_id: "1-2345-67890-12-3" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.refund_promptpay_id).toBe("1234567890123");
  });

  it.each([["12345"], ["1812345678"], ["08123456789"], ["abcdefghij"], [""]])("รูปแบบผิด %s → 400", async (bad) => {
    const { session } = await sessionFor("customer");
    expect((await patchMe(session, { refund_promptpay_id: bad })).status).toBe(400);
  });

  it("ชื่อบัญชีว่าง → 400 · ส่ง null → ล้างค่าได้", async () => {
    const { session } = await sessionFor("customer");
    await patchMe(session, { refund_promptpay_id: "0812345678", refund_promptpay_name: "สมชาย" });
    expect((await patchMe(session, { refund_promptpay_name: "   " })).status).toBe(400);
    const cleared = await patchMe(session, { refund_promptpay_id: null, refund_promptpay_name: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.user).toMatchObject({ refund_promptpay_id: null, refund_promptpay_name: null });
  });

  it("ไม่ออกทางรายการ/รายละเอียดผู้ใช้ของหลังร้าน (/admin/users)", async () => {
    const { user, session } = await sessionFor("customer");
    await patchMe(session, { refund_promptpay_id: "0812345678", refund_promptpay_name: "สมชาย" });
    const list = await userService.listUsers({ pagination: parsePagination(new URLSearchParams()), search: user.email });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).not.toHaveProperty("refund_promptpay_id");
    expect(await userService.getUserById(String(user._id))).not.toHaveProperty("refund_promptpay_id");
  });
});

describe("GET /api/admin/orders/:id · /api/admin/preorders/:id — refund_account", () => {
  async function customerWithAccount() {
    const { user, session } = await sessionFor("customer");
    await patchMe(session, { refund_promptpay_id: "0812345678", refund_promptpay_name: "สมชาย ใจดี" });
    return user;
  }

  const makeOrder = (userId: unknown, over: Record<string, unknown>) =>
    orderModel.create({
      order_no: `ORD-REFUND-${Math.random()}`,
      user_id: userId,
      order_type: "takeaway",
      subtotal: 100,
      total_amount: 100,
      ...over,
    });

  const getOrder = async (session: SessionUser, id: unknown) =>
    (await (await adminOrderGET(req(`/api/admin/orders/${id}`, session), ctx(id))).json()).data;
  const getPreorder = async (session: SessionUser, id: unknown) =>
    (await (await adminPreorderGET(req(`/api/admin/preorders/${id}`, session), ctx(id))).json()).data;

  it("ออเดอร์รอโอนคืน (ยกเลิก + ชำระแล้ว) → refund_account ของลูกค้า", async () => {
    const customer = await customerWithAccount();
    const { session: owner } = await sessionFor("owner");
    const order = await makeOrder(customer._id, { order_status: "cancelled", payment_status: "paid" });
    expect((await getOrder(owner, order._id)).refund_account).toEqual({ promptpay_id: "0812345678", promptpay_name: "สมชาย ใจดี" });
  });

  it("สถานะอื่น (ยังไม่ยกเลิก / คืนเงินแล้ว / ยังไม่ชำระ) → null · ไม่มีบัญชีใน populate ของ user_id", async () => {
    const customer = await customerWithAccount();
    const { session: owner } = await sessionFor("owner");
    for (const [order_status, payment_status] of [["confirmed", "paid"], ["cancelled", "refunded"], ["cancelled", "pending"]]) {
      const order = await makeOrder(customer._id, { order_status, payment_status });
      const data = await getOrder(owner, order._id);
      expect(data.refund_account).toBeNull();
      expect(data.user_id).not.toHaveProperty("refund_promptpay_id");
    }
  });

  it("ลูกค้ายังไม่ตั้งบัญชี → null", async () => {
    const { user } = await sessionFor("customer");
    const { session: owner } = await sessionFor("owner");
    const order = await makeOrder(user._id, { order_status: "cancelled", payment_status: "paid" });
    expect((await getOrder(owner, order._id)).refund_account).toBeNull();
  });

  it("พรีออเดอร์รอโอนคืน → refund_account · สถานะอื่น → null", async () => {
    const customer = await customerWithAccount();
    const { session: owner } = await sessionFor("owner");
    const waiting = await makePreorder(String(customer._id), { order_status: "cancelled", payment_status: "paid" });
    const active = await makePreorder(String(customer._id), { order_status: "confirmed", payment_status: "paid" });
    expect((await getPreorder(owner, waiting._id)).refund_account).toEqual({ promptpay_id: "0812345678", promptpay_name: "สมชาย ใจดี" });
    expect((await getPreorder(owner, active._id)).refund_account).toBeNull();
  });
});
