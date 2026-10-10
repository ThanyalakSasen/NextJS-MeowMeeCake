import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import { POST as rolesPOST } from "@/app/api/admin/roles/route";
import { PATCH as rolePATCH, DELETE as roleDELETE } from "@/app/api/admin/roles/[id]/route";
import { POST as roleRestorePOST } from "@/app/api/admin/roles/[id]/restore/route";
import { POST as usersPOST } from "@/app/api/admin/users/route";
import { PATCH as userPATCH, DELETE as userDELETE } from "@/app/api/admin/users/[id]/route";
import { PUT as userPasswordPUT } from "@/app/api/admin/users/[id]/password/route";
import { POST as userUnlockPOST } from "@/app/api/admin/users/[id]/unlock/route";
import { POST as userRestorePOST } from "@/app/api/admin/users/[id]/restore/route";
import { makeUser } from "./helpers";

/**
 * ownerProtection — คนที่ไม่ใช่ owner (แม้มีสิทธิ์ employees ครบ) ยกระดับตัวเองเป็น owner / ยึดหรือปิดบัญชี owner ไม่ได้
 * owner ทำได้ทุกอย่างตามเดิม
 */

const FULL = { can_view: true, can_create: true, can_update: true, can_delete: true };

async function actor(roleType: "owner" | "staff") {
  const role = await roleModel.create({ role_name: `${roleType}-${Math.random()}`, role_type: roleType });
  const user = await makeUser({ role_id: role._id });
  if (roleType === "staff") {
    await createPermission({ role_id: String(role._id), menu_key: "employees", granted_by: String(user._id), ...FULL });
  }
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: roleType,
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return { session, role, user };
}

async function call(
  handler: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  session: SessionUser,
  method: string,
  id: unknown,
  body?: unknown
) {
  const req = new NextRequest(`http://localhost:3000/api/x/${id ?? ""}`, {
    method,
    headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve({ id: String(id ?? "") }) });
  return res.status;
}

const anyHandler = <T,>(h: T) => h as unknown as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

/** บทบาท owner + บัญชีเจ้าของร้านที่เป็นเป้าหมาย */
async function ownerTarget() {
  const ownerRole = await roleModel.create({ role_name: `ร้าน-${Math.random()}`, role_type: "owner" });
  const owner = await makeUser({ role_id: ownerRole._id });
  return { ownerRole, owner };
}

describe("บทบาท (roles) — staff ที่มี employees ครบ", () => {
  it("สร้างบทบาทประเภท owner ไม่ได้ (403) · ประเภท staff ได้", async () => {
    const { session } = await actor("staff");
    expect(await call(anyHandler(rolesPOST), session, "POST", null, { role_name: "บอส", role_type: "owner" })).toBe(403);
    expect(await roleModel.countDocuments({ role_name: "บอส" })).toBe(0);
    expect(await call(anyHandler(rolesPOST), session, "POST", null, { role_name: "เบเกอร์", role_type: "staff" })).toBe(201);
  });

  it("แก้ชื่อ / ปิดใช้งาน / ลบ / กู้คืน บทบาท owner ไม่ได้ (403) · บทบาท staff ได้", async () => {
    const { session } = await actor("staff");
    const { ownerRole } = await ownerTarget();
    const spare = await roleModel.create({ role_name: `เจ้าของสำรอง-${Math.random()}`, role_type: "owner", deleted_at: new Date() });
    expect(await call(anyHandler(rolePATCH), session, "PATCH", ownerRole._id, { role_name: "อื่น" })).toBe(403);
    expect(await call(anyHandler(rolePATCH), session, "PATCH", ownerRole._id, { is_active: false })).toBe(403);
    expect(await call(anyHandler(roleDELETE), session, "DELETE", ownerRole._id)).toBe(403);
    expect(await call(anyHandler(roleRestorePOST), session, "POST", spare._id)).toBe(403);
    expect((await roleModel.findById(ownerRole._id).lean<{ is_active: boolean }>())?.is_active).toBe(true);

    const staffRole = await roleModel.create({ role_name: `กะดึก-${Math.random()}`, role_type: "staff" });
    expect(await call(anyHandler(rolePATCH), session, "PATCH", staffRole._id, { role_name: "กะดึกใหม่" })).toBe(200);
  });

  it("owner ทำได้ทุกอย่าง", async () => {
    const { session } = await actor("owner");
    expect(await call(anyHandler(rolesPOST), session, "POST", null, { role_name: "หุ้นส่วน", role_type: "owner" })).toBe(201);
    const created = await roleModel.findOne({ role_name: "หุ้นส่วน" }).lean<{ _id: unknown }>();
    expect(await call(anyHandler(rolePATCH), session, "PATCH", created?._id, { role_name: "หุ้นส่วนใหญ่" })).toBe(200);
  });
});

describe("ผู้ใช้ (users) — staff ที่มี employees ครบ", () => {
  it("สร้างผู้ใช้ในบทบาท owner ไม่ได้ (403) · บทบาท staff ได้", async () => {
    const { session } = await actor("staff");
    const { ownerRole } = await ownerTarget();
    const staffRole = await roleModel.create({ role_name: `แคชเชียร์-${Math.random()}`, role_type: "staff" });
    const base = { user_fullname: "ใหม่", auth_provider: "local", password: "password123" };
    expect(await call(anyHandler(usersPOST), session, "POST", null, { ...base, email: "boss@test.local", role_id: String(ownerRole._id) })).toBe(403);
    expect(await userModel.countDocuments({ email: "boss@test.local" })).toBe(0);
    expect(await call(anyHandler(usersPOST), session, "POST", null, { ...base, email: "cashier@test.local", role_id: String(staffRole._id) })).toBe(201);
  });

  it("ย้ายตัวเอง / คนอื่น เข้าบทบาท owner ไม่ได้ (403)", async () => {
    const { session, user: me } = await actor("staff");
    const { ownerRole } = await ownerTarget();
    const other = await makeUser({ role_id: (await roleModel.create({ role_name: `x-${Math.random()}`, role_type: "staff" }))._id });
    expect(await call(anyHandler(userPATCH), session, "PATCH", me._id, { role_id: String(ownerRole._id) })).toBe(403);
    expect(await call(anyHandler(userPATCH), session, "PATCH", other._id, { role_id: String(ownerRole._id) })).toBe(403);
    expect(String((await userModel.findById(me._id).lean<{ role_id: unknown }>())?.role_id)).not.toBe(String(ownerRole._id));
  });

  it("แก้ / ตั้งรหัสผ่าน / ปลดล็อก / ลบ / กู้คืน บัญชี owner ไม่ได้ (403) — บัญชีไม่ถูกแตะ", async () => {
    const { session } = await actor("staff");
    const { owner } = await ownerTarget();
    const deletedOwner = await makeUser({ role_id: owner.role_id, deleted_at: new Date() });
    expect(await call(anyHandler(userPATCH), session, "PATCH", owner._id, { email: "takeover@test.local" })).toBe(403);
    expect(await call(anyHandler(userPATCH), session, "PATCH", owner._id, { is_active: false })).toBe(403);
    expect(await call(anyHandler(userPasswordPUT), session, "PUT", owner._id, { new_password: "hijacked123" })).toBe(403);
    expect(await call(anyHandler(userUnlockPOST), session, "POST", owner._id)).toBe(403);
    expect(await call(anyHandler(userDELETE), session, "DELETE", owner._id)).toBe(403);
    expect(await call(anyHandler(userRestorePOST), session, "POST", deletedOwner._id)).toBe(403);

    const after = await userModel.findById(owner._id).select("+password email is_active deleted_at password").lean<Record<string, unknown>>();
    expect(after).toMatchObject({ email: owner.email, is_active: true, deleted_at: null });
    expect(after?.password ?? null).toBe(owner.password ?? null);
  });

  it("จัดการบัญชีพนักงานด้วยกันได้ตามปกติ", async () => {
    const { session } = await actor("staff");
    const staffRole = await roleModel.create({ role_name: `เบเกอร์-${Math.random()}`, role_type: "staff" });
    const peer = await makeUser({ role_id: staffRole._id });
    expect(await call(anyHandler(userPATCH), session, "PATCH", peer._id, { user_fullname: "ชื่อใหม่" })).toBe(200);
    expect(await call(anyHandler(userPasswordPUT), session, "PUT", peer._id, { new_password: "newpassword1" })).toBe(200);
    expect(await call(anyHandler(userUnlockPOST), session, "POST", peer._id)).toBe(200);
  });

  it("owner จัดการบัญชี owner คนอื่น และตั้งคนเข้าบทบาท owner ได้", async () => {
    const { session } = await actor("owner");
    const { ownerRole, owner } = await ownerTarget();
    const staff = await makeUser({ role_id: (await roleModel.create({ role_name: `y-${Math.random()}`, role_type: "staff" }))._id });
    expect(await call(anyHandler(userPATCH), session, "PATCH", owner._id, { user_fullname: "เจ้าของร่วม" })).toBe(200);
    expect(await call(anyHandler(userPasswordPUT), session, "PUT", owner._id, { new_password: "ownerpass123" })).toBe(200);
    expect(await call(anyHandler(userPATCH), session, "PATCH", staff._id, { role_id: String(ownerRole._id) })).toBe(200);
  });
});
