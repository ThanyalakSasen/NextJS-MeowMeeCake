import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import permissionModel from "@/models/permissionModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission, getMenuAccess } from "@/services/permissionService";
import { POST as permissionsPOST } from "@/app/api/admin/permissions/route";
import { PATCH as permissionPATCH, DELETE as permissionDELETE } from "@/app/api/admin/permissions/[id]/route";
import { POST as permissionRestorePOST } from "@/app/api/admin/permissions/[id]/restore/route";
import { POST as usersPOST } from "@/app/api/admin/users/route";
import { PATCH as userPATCH, DELETE as userDELETE } from "@/app/api/admin/users/[id]/route";
import { PUT as userPasswordPUT } from "@/app/api/admin/users/[id]/password/route";
import { POST as userUnlockPOST } from "@/app/api/admin/users/[id]/unlock/route";
import { POST as userRestorePOST } from "@/app/api/admin/users/[id]/restore/route";
import { makeUser } from "./helpers";

/**
 * permissionCeiling (issue #81) — คนที่ไม่ใช่ owner ให้หรือจัดการได้ไม่เกินสิทธิ์ที่ตัวเองมี
 * actor ในเทส = staff ที่มี employees ครบ + products ดูอย่างเดียว (ไม่มี payments)
 */

const FULL = { can_view: true, can_create: true, can_update: true, can_delete: true, can_approve: true };

let seq = 0;
const name = (p: string) => `${p}-${++seq}-${Math.random()}`;

async function staffRole(perms: Record<string, Record<string, boolean>>, grantedBy?: unknown) {
  const role = await roleModel.create({ role_name: name("staff"), role_type: "staff" });
  const granter = grantedBy ?? (await makeUser({ role_id: role._id }))._id;
  for (const [menu_key, flags] of Object.entries(perms)) {
    await createPermission({ role_id: String(role._id), menu_key: menu_key as never, granted_by: String(granter), ...flags });
  }
  return role;
}

/** HR: employees ครบ · products ดูอย่างเดียว */
async function hrActor() {
  const role = await roleModel.create({ role_name: name("hr"), role_type: "staff" });
  const user = await makeUser({ role_id: role._id });
  await createPermission({ role_id: String(role._id), menu_key: "employees", granted_by: String(user._id), ...FULL });
  await createPermission({ role_id: String(role._id), menu_key: "products", granted_by: String(user._id), can_view: true });
  return { session: sessionOf(user, role, "staff"), role, user };
}

async function ownerActor() {
  const role = await roleModel.create({ role_name: name("owner"), role_type: "owner" });
  const user = await makeUser({ role_id: role._id });
  return { session: sessionOf(user, role, "owner"), role, user };
}

function sessionOf(user: { _id: unknown; email: string }, role: { _id: unknown }, role_type: "owner" | "staff"): SessionUser {
  return { user_id: String(user._id), role_id: String(role._id), role_type, email: user.email, source: "jwt", auth_time: Date.now() };
}

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const h = <T,>(x: T) => x as unknown as Handler;

async function call(handler: Handler, session: SessionUser, method: string, id: unknown, body?: unknown) {
  const req = new NextRequest(`http://localhost:3000/api/x/${id ?? ""}`, {
    method,
    headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve({ id: String(id ?? "") }) });
  return res.status;
}

describe("ให้สิทธิ์ (permissions) — staff ที่มี employees ครบ", () => {
  it("ให้สิทธิ์ที่ตัวเองไม่มีกับบทบาทตัวเองไม่ได้ (403) — ไม่มีแถวใหม่ · สิทธิ์ไม่เพิ่ม", async () => {
    const { session, role } = await hrActor();
    expect(await call(h(permissionsPOST), session, "POST", null, { role_id: String(role._id), menu_key: "payments", can_view: true, can_approve: true })).toBe(403);
    expect(await permissionModel.countDocuments({ role_id: role._id, menu_key: "payments" })).toBe(0);
    expect((await getMenuAccess(session)).payments.can_approve).toBe(false);
  });

  it("ให้สิทธิ์ที่ตัวเองมีได้ · เกินในเมนูเดียวกันไม่ได้", async () => {
    const { session } = await hrActor();
    const target = await staffRole({});
    expect(await call(h(permissionsPOST), session, "POST", null, { role_id: String(target._id), menu_key: "products", can_view: true })).toBe(201);
    const other = await staffRole({});
    expect(await call(h(permissionsPOST), session, "POST", null, { role_id: String(other._id), menu_key: "products", can_view: true, can_create: true })).toBe(403);
    expect(await call(h(permissionsPOST), session, "POST", null, { role_id: String(other._id), menu_key: "employees", ...FULL })).toBe(201);
  });

  it("เปิด flag ที่ตัวเองไม่มีในแถวเดิมไม่ได้ (403) · ปิด flag / ลบแถวได้", async () => {
    const { session } = await hrActor();
    const target = await staffRole({ payments: { can_view: true }, products: { can_view: true, can_create: true } });
    const payRow = await permissionModel.findOne({ role_id: target._id, menu_key: "payments" }).lean<{ _id: unknown }>();
    const prodRow = await permissionModel.findOne({ role_id: target._id, menu_key: "products" }).lean<{ _id: unknown }>();
    expect(await call(h(permissionPATCH), session, "PATCH", payRow?._id, { can_approve: true })).toBe(403);
    expect((await permissionModel.findById(payRow?._id).lean<{ can_approve?: boolean }>())?.can_approve).not.toBe(true);
    // ถอน = ไม่ใช่การยกระดับ
    expect(await call(h(permissionPATCH), session, "PATCH", prodRow?._id, { can_create: false })).toBe(200);
    expect(await call(h(permissionDELETE), session, "DELETE", payRow?._id)).toBe(200);
  });

  it("กู้คืนแถวสิทธิ์ที่เกินสิทธิ์ตัวเองไม่ได้ (403) · แถวที่ไม่เกินกู้ได้", async () => {
    const { session, role } = await hrActor();
    const owner = await ownerActor();
    const pay = await permissionModel.create({ role_id: role._id, menu_key: "payments", granted_by: owner.user._id, can_view: true, can_approve: true, deleted_at: new Date() });
    expect(await call(h(permissionRestorePOST), session, "POST", pay._id)).toBe(403);
    expect((await permissionModel.findById(pay._id).lean<{ deleted_at: Date | null }>())?.deleted_at).not.toBeNull();

    const target = await staffRole({});
    const prod = await permissionModel.create({ role_id: target._id, menu_key: "products", granted_by: owner.user._id, can_view: true, deleted_at: new Date() });
    expect(await call(h(permissionRestorePOST), session, "POST", prod._id)).toBe(200);
  });

  it("owner ให้สิทธิ์อะไรก็ได้", async () => {
    const { session } = await ownerActor();
    const target = await staffRole({});
    expect(await call(h(permissionsPOST), session, "POST", null, { role_id: String(target._id), menu_key: "payments", ...FULL })).toBe(201);
  });
});

describe("ผู้ใช้ (users) — staff ที่มี employees ครบ", () => {
  const base = { user_fullname: "ใหม่", auth_provider: "local", password: "password123" };

  it("สร้างผู้ใช้ในบทบาทที่สิทธิ์เกินตัวเองไม่ได้ (403) · บทบาทที่ไม่เกินได้", async () => {
    const { session } = await hrActor();
    const cashier = await staffRole({ payments: { can_view: true, can_approve: true } });
    const viewer = await staffRole({ products: { can_view: true } });
    expect(await call(h(usersPOST), session, "POST", null, { ...base, email: `pay-${seq}@test.local`, role_id: String(cashier._id) })).toBe(403);
    expect(await call(h(usersPOST), session, "POST", null, { ...base, email: `view-${seq}@test.local`, role_id: String(viewer._id) })).toBe(201);
  });

  it("สร้างบทบาทใหม่ให้สิทธิ์เต็มแล้วย้ายตัวเองเข้าไปไม่ได้ — ติดตั้งแต่ขั้นให้สิทธิ์", async () => {
    const { session } = await hrActor();
    const mine = await staffRole({});
    expect(await call(h(permissionsPOST), session, "POST", null, { role_id: String(mine._id), menu_key: "payments", ...FULL })).toBe(403);
  });

  it("ย้ายตัวเองเข้าบทบาทที่สิทธิ์สูงกว่าไม่ได้ (403) · แก้ข้อมูลตัวเองโดยส่ง role_id เดิมได้", async () => {
    const { session, user: me, role } = await hrActor();
    const manager = await staffRole({ employees: FULL, payments: FULL });
    expect(await call(h(userPATCH), session, "PATCH", me._id, { role_id: String(manager._id) })).toBe(403);
    expect(String((await userModel.findById(me._id).lean<{ role_id: unknown }>())?.role_id)).toBe(String(role._id));
    expect(await call(h(userPATCH), session, "PATCH", me._id, { user_fullname: "ชื่อใหม่", role_id: String(role._id) })).toBe(200);
  });

  it("ตั้งรหัสผ่าน / แก้ / ปลดล็อก / ลบ / กู้คืน พนักงานที่สิทธิ์สูงกว่าไม่ได้ (403) — บัญชีไม่ถูกแตะ", async () => {
    const { session } = await hrActor();
    const manager = await staffRole({ payments: FULL });
    const boss = await makeUser({ role_id: manager._id });
    const gone = await makeUser({ role_id: manager._id, deleted_at: new Date() });
    expect(await call(h(userPasswordPUT), session, "PUT", boss._id, { new_password: "hijacked123" })).toBe(403);
    expect(await call(h(userPATCH), session, "PATCH", boss._id, { email: "takeover@test.local", role_id: String(manager._id) })).toBe(403);
    expect(await call(h(userUnlockPOST), session, "POST", boss._id)).toBe(403);
    expect(await call(h(userDELETE), session, "DELETE", boss._id)).toBe(403);
    expect(await call(h(userRestorePOST), session, "POST", gone._id)).toBe(403);

    const after = await userModel.findById(boss._id).select("+password email is_active deleted_at").lean<Record<string, unknown>>();
    expect(after).toMatchObject({ email: boss.email, is_active: true, deleted_at: null });
    expect(after?.password ?? null).toBe(boss.password ?? null);
  });

  it("จัดการพนักงานที่สิทธิ์ไม่เกินตัวเองได้ตามปกติ (ฟอร์มส่ง role_id เดิมมาด้วย)", async () => {
    const { session } = await hrActor();
    const viewer = await staffRole({ products: { can_view: true } });
    const peer = await makeUser({ role_id: viewer._id });
    expect(await call(h(userPATCH), session, "PATCH", peer._id, { user_fullname: "ชื่อใหม่", role_id: String(viewer._id) })).toBe(200);
    expect(await call(h(userPasswordPUT), session, "PUT", peer._id, { new_password: "newpassword1" })).toBe(200);
    expect(await call(h(userUnlockPOST), session, "POST", peer._id)).toBe(200);
  });

  it("owner จัดการพนักงานทุกระดับและย้ายบทบาทได้", async () => {
    const { session } = await ownerActor();
    const manager = await staffRole({ payments: FULL });
    const viewer = await staffRole({ products: { can_view: true } });
    const peer = await makeUser({ role_id: viewer._id });
    expect(await call(h(userPATCH), session, "PATCH", peer._id, { role_id: String(manager._id) })).toBe(200);
    expect(await call(h(userPasswordPUT), session, "PUT", peer._id, { new_password: "ownerpass123" })).toBe(200);
  });
});
