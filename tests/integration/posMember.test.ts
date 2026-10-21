import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import * as orderService from "@/services/orderService";
import * as pointsService from "@/services/pointsService";
import { checkoutPosOrder } from "@/services/posCheckoutService";
import { GUEST_CUSTOMER_EMAIL } from "@/lib/posGuest";
import { GET as memberGET } from "@/app/api/admin/pos/member/route";
import { makeUser, makeProduct } from "./helpers";

/**
 * GET /api/admin/pos/member?phone= — POS หาสมาชิกด้วยเบอร์มือถือ แล้วผูกออเดอร์หน้าร้านกับสมาชิกให้ได้แต้มสะสม
 */

async function staff(perms: Record<string, Record<string, boolean>>) {
  const role = await roleModel.create({ role_name: `pos-m-${Math.random()}`, role_type: "staff" });
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

async function customer(over: Record<string, unknown> = {}) {
  const role = await roleModel.create({ role_name: `customer-${Math.random()}`, role_type: "customer" });
  return makeUser({ role_id: role._id, ...over });
}

async function call(session: SessionUser, phone: string) {
  const req = new NextRequest(`http://localhost:3000/api/admin/pos/member?phone=${encodeURIComponent(phone)}`, {
    headers: { [USER_HEADER]: JSON.stringify(session) },
  });
  const res = await (memberGET as unknown as (r: NextRequest) => Promise<Response>)(req);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/admin/pos/member", () => {
  it("เจอสมาชิกจากเบอร์ (รับเบอร์มีขีด) + แต้มคงเหลือ · ไม่คืนอีเมล", async () => {
    const m = await customer({ user_fullname: "แมว เหมียว", user_phone: "0812345678" });
    await pointsService.awardPoints({ userId: String(m._id), source: "welcome", points: 50, dedupeKey: "welcome", description: "t" });
    const { status, body } = await call(await staff({ pos: { can_view: true } }), "081-234-5678");
    expect(status).toBe(200);
    expect(body.data.baht_per_point).toBe(pointsService.POINT_RULES.BAHT_PER_POINT);
    expect(body.data.members).toHaveLength(1);
    expect(body.data.members[0]).toMatchObject({ _id: String(m._id), user_fullname: "แมว เหมียว", points_balance: 50 });
    expect(body.data.members[0].email).toBeUndefined();
  });

  it("ไม่นับพนักงาน · บัญชีลูกค้าทั่วไป · บัญชีที่ลบ/ปิดใช้งาน — ไม่พบ = members ว่าง (200)", async () => {
    const session = await staff({ pos: { can_view: true } });
    const staffRole = await roleModel.create({ role_name: `st-${Math.random()}`, role_type: "staff" });
    await makeUser({ role_id: staffRole._id, user_phone: "0899999999" });
    await customer({ email: GUEST_CUSTOMER_EMAIL, user_phone: "0899999999" });
    await customer({ user_phone: "0899999999", deleted_at: new Date() });
    await customer({ user_phone: "0899999999", is_active: false });
    const { status, body } = await call(session, "0899999999");
    expect(status).toBe(200);
    expect(body.data.members).toEqual([]);
  });

  it("เบอร์ผิดรูปแบบ = 400 · ไม่มีสิทธิ์ pos.view = 403", async () => {
    expect((await call(await staff({ pos: { can_view: true } }), "12345")).status).toBe(400);
    expect((await call(await staff({ orders: { can_view: true } }), "0812345678")).status).toBe(403);
  });

  it("ออเดอร์หน้าร้านที่ผูกกับสมาชิก — รับเงินแล้วสมาชิกได้แต้มตามยอด", async () => {
    const m = await customer({ user_phone: "0811111111" });
    const seller = await staff({ pos: { can_view: true, can_create: true } });
    const p = await makeProduct({ product_price: 120, product_stock_quantity: 10 });
    const order = (await orderService.createOrder(String(m._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 2 }],
      channel: "instore",
    })) as { _id: unknown };
    await checkoutPosOrder(String(order._id), seller.user_id);
    expect(await pointsService.getBalance(String(m._id))).toBe(pointsService.pointsEarnedFor(240));
  });
});
