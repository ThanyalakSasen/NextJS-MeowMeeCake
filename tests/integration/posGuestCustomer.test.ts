import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import { GUEST_CUSTOMER_EMAIL } from "@/lib/posGuest";
import { GET as guestGET } from "@/app/api/admin/pos/guest-customer/route";
import { makeUser } from "./helpers";

/**
 * GET /api/admin/pos/guest-customer — POS หาบัญชี "ลูกค้าทั่วไป" ด้วยสิทธิ์ orders.view
 * (เดิมต้องค้นผ่าน /admin/users = employees.view — frontend Final-Backlog P3)
 */

async function staff(perms: Record<string, Record<string, boolean>>) {
  const role = await roleModel.create({ role_name: `pos-${Math.random()}`, role_type: "staff" });
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

async function call(session: SessionUser) {
  const req = new NextRequest("http://localhost:3000/api/admin/pos/guest-customer", {
    headers: { [USER_HEADER]: JSON.stringify(session) },
  });
  const res = await (guestGET as unknown as (r: NextRequest) => Promise<Response>)(req);
  return { status: res.status, body: await res.json() };
}

async function seedGuest(over: Record<string, unknown> = {}) {
  const role = await roleModel.create({ role_name: `customer-${Math.random()}`, role_type: "customer" });
  return makeUser({ email: GUEST_CUSTOMER_EMAIL, user_fullname: "ลูกค้าทั่วไป", role_id: role._id, ...over });
}

describe("GET /api/admin/pos/guest-customer", () => {
  it("พนักงานที่มีแค่ orders.view ได้ id บัญชีลูกค้าทั่วไป — ไม่ต้องมี employees", async () => {
    const guest = await seedGuest();
    const { status, body } = await call(await staff({ orders: { can_view: true } }));
    expect(status).toBe(200);
    expect(body.data._id).toBe(String(guest._id));
    expect(body.data.email).toBe(GUEST_CUSTOMER_EMAIL);
    expect(body.data.password).toBeUndefined();
  });

  it("ไม่มี orders.view = 403 (มีแค่ employees ก็ไม่ได้)", async () => {
    await seedGuest();
    expect((await call(await staff({ employees: { can_view: true } }))).status).toBe(403);
  });

  it("ยังไม่ได้ seed หรือบัญชีถูกปิดใช้งาน = 404", async () => {
    const session = await staff({ orders: { can_view: true } });
    expect((await call(session)).status).toBe(404);
    await seedGuest({ is_active: false });
    expect((await call(session)).status).toBe(404);
  });
});
