import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import orderModel from "@/models/orderModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import { GET as usersGET } from "@/app/api/admin/users/route";
import { GET as recipesGET } from "@/app/api/admin/recipes/route";
import { GET as roundsGET } from "@/app/api/admin/preorder-rounds/route";
import { GET as orderGET } from "@/app/api/admin/orders/[id]/route";
import { PATCH as orderStatusPATCH } from "@/app/api/admin/orders/[id]/status/route";
import { makeUser } from "./helpers";

/**
 * พนักงานที่มีสิทธิ์แค่หน้าเดียว ต้องใช้หน้านั้นได้ครบ — API ของเมนูอื่นที่หน้านั้นต้องอ่าน/ทำ
 *   production: สูตร (สินค้าที่สร้างใบสั่งผลิตได้) · รอบพรีออเดอร์ (สร้างจากรอบ) · รายชื่อทีมงาน (ผู้รับผิดชอบ — ไม่เห็นลูกค้า)
 *   pos: อ่าน/ยกเลิกบิลหน้าร้าน (POS-) ที่ยังไม่ชำระ — ออเดอร์อื่นยังต้องมีสิทธิ์ orders
 */

let seq = 0;

async function actor(perms: Record<string, Record<string, boolean>>) {
  const role = await roleModel.create({ role_name: `cross-${++seq}-${Math.random()}`, role_type: "staff" });
  const user = await makeUser({ role_id: role._id });
  for (const [menu_key, flags] of Object.entries(perms)) {
    await createPermission({ role_id: String(role._id), menu_key: menu_key as never, granted_by: String(user._id), ...flags });
  }
  const session: SessionUser = {
    user_id: String(user._id), role_id: String(role._id), role_type: "staff", email: user.email, source: "jwt", auth_time: Date.now(),
  };
  return { session, user, role };
}

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const h = <T,>(x: T) => x as unknown as Handler;

async function call(handler: Handler, session: SessionUser, method: string, opts: { id?: unknown; query?: string; body?: unknown } = {}) {
  const req = new NextRequest(`http://localhost:3000/api/x/${opts.id ?? ""}${opts.query ?? ""}`, {
    method,
    headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve({ id: String(opts.id ?? "") }) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function makeOrder(order_no: string, over: Record<string, unknown> = {}) {
  const customer = await makeUser();
  return orderModel.create({ order_no, user_id: customer._id, order_type: "takeaway", subtotal: 10000, total_amount: 10000, ...over });
}

describe("สิทธิ์หน้าผลิตอย่างเดียว", () => {
  it("อ่านสูตร / รอบพรีออเดอร์ / ทีมงานได้ · แก้ไม่ได้", async () => {
    const { session } = await actor({ production: { can_view: true, can_create: true } });
    expect((await call(h(recipesGET), session, "GET")).status).toBe(200);
    expect((await call(h(roundsGET), session, "GET")).status).toBe(200);
    expect((await call(h(usersGET), session, "GET")).status).toBe(200);
  });

  it("รายชื่อผู้ใช้เห็นเฉพาะเจ้าของ/พนักงาน แม้ขอ role_type=customer", async () => {
    const { session, user } = await actor({ production: { can_view: true } });
    const customerRole = await roleModel.create({ role_name: `cust-${Math.random()}`, role_type: "customer" });
    const customer = await makeUser({ role_id: customerRole._id });

    for (const query of ["", "?role_type=customer", "?includeDeleted=true"]) {
      const res = await call(h(usersGET), session, "GET", { query });
      expect(res.status, query).toBe(200);
      const ids = (res.body.data.items as { _id: string }[]).map((u) => String(u._id));
      expect(ids, query).not.toContain(String(customer._id));
      if (!query) expect(ids).toContain(String(user._id));
    }
  });

  it("ไม่มีสิทธิ์หน้าผลิต/สูตร = อ่านสูตรไม่ได้เหมือนเดิม", async () => {
    const { session } = await actor({ products: { can_view: true } });
    expect((await call(h(recipesGET), session, "GET")).status).toBe(403);
    expect((await call(h(usersGET), session, "GET")).status).toBe(403);
  });
});

describe("สิทธิ์ POS อย่างเดียว", () => {
  it("อ่านบิลหน้าร้านได้ · ออเดอร์เว็บไม่ได้", async () => {
    const { session } = await actor({ pos: { can_view: true, can_create: true } });
    const pos = await makeOrder(`POS-${Date.now()}`);
    const web = await makeOrder(`ORD-${Date.now()}`);
    expect((await call(h(orderGET), session, "GET", { id: pos._id })).status).toBe(200);
    expect((await call(h(orderGET), session, "GET", { id: web._id })).status).toBe(403);
  });

  it("ยกเลิกบิลหน้าร้านที่ยังไม่ชำระได้ · ที่ชำระแล้ว/ออเดอร์เว็บ/เปลี่ยนเป็นสถานะอื่นไม่ได้", async () => {
    const { session } = await actor({ pos: { can_view: true, can_create: true } });
    const cancel = { order_status: "cancelled", cancelled_reason: "ทิ้งบิล" };

    const unpaid = await makeOrder(`POS-${Date.now()}-a`);
    expect((await call(h(orderStatusPATCH), session, "PATCH", { id: unpaid._id, body: cancel })).status).toBe(200);
    expect((await orderModel.findById(unpaid._id).lean())!.order_status).toBe("cancelled");

    const paid = await makeOrder(`POS-${Date.now()}-b`, { payment_status: "paid" });
    expect((await call(h(orderStatusPATCH), session, "PATCH", { id: paid._id, body: cancel })).status).toBe(403);

    const web = await makeOrder(`ORD-${Date.now()}`);
    expect((await call(h(orderStatusPATCH), session, "PATCH", { id: web._id, body: cancel })).status).toBe(403);

    const other = await makeOrder(`POS-${Date.now()}-c`);
    expect((await call(h(orderStatusPATCH), session, "PATCH", { id: other._id, body: { order_status: "confirmed" } })).status).toBe(403);
  });

  it("POS ที่ไม่มีสิทธิ์ขาย (create) ยกเลิกไม่ได้", async () => {
    const { session } = await actor({ pos: { can_view: true } });
    const unpaid = await makeOrder(`POS-${Date.now()}`);
    expect((await call(h(orderStatusPATCH), session, "PATCH", { id: unpaid._id, body: { order_status: "cancelled" } })).status).toBe(403);
  });
});
