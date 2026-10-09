import { describe, it, expect, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import * as authService from "@/services/authService";
import { PATCH as rolePATCH } from "@/app/api/admin/roles/[id]/route";
import { makeUser } from "./helpers";

/**
 * แก้ชื่อบทบาท — PATCH /api/admin/roles/:id (หน้าจัดการสิทธิ์ของ frontend)
 *   - เปลี่ยนชื่อได้ · ชื่อซ้ำ = 409
 *   - เปลี่ยนประเภท (role_type) ไม่ได้ = 400 — กัน employees.update ยกบทบาทตัวเองเป็น owner
 *   - สมัครด้วย Google หาบทบาทลูกค้าจาก role_type (ไม่พังเมื่อบทบาท customer ถูกเปลี่ยนชื่อ)
 */

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, jwtVerify: vi.fn() };
});

async function sessionFor(roleType: "owner" | "staff", perms: { can_view?: boolean; can_update?: boolean } = {}) {
  const role = await roleModel.create({ role_name: `${roleType}-${Math.random()}`, role_type: roleType });
  const user = await makeUser({ role_id: role._id });
  if (roleType === "staff" && (perms.can_view || perms.can_update)) {
    await createPermission({ role_id: String(role._id), menu_key: "employees", granted_by: String(user._id), ...perms });
  }
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: roleType,
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return { session, role };
}

async function patch(session: SessionUser, id: unknown, body: unknown) {
  const res = await rolePATCH(
    new NextRequest(`http://localhost:3000/api/admin/roles/${id}`, {
      method: "PATCH",
      headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  return { status: res.status, body: await res.json() };
}

describe("PATCH /api/admin/roles/:id — แก้ชื่อบทบาท", () => {
  it("owner เปลี่ยนชื่อได้ (ตัดช่องว่าง) · ประเภทเดิมคงอยู่", async () => {
    const { session } = await sessionFor("owner");
    const cashier = await roleModel.create({ role_name: "แคชเชียร์", role_type: "staff" });
    const res = await patch(session, cashier._id, { role_name: "  พนักงานหน้าร้าน  " });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ role_name: "พนักงานหน้าร้าน", role_type: "staff" });
  });

  it("ชื่อซ้ำกับบทบาทอื่นที่ยังไม่ลบ → 409 · ชื่อซ้ำกับบทบาทที่ลบแล้วได้", async () => {
    const { session } = await sessionFor("owner");
    await roleModel.create({ role_name: "ผู้จัดการ", role_type: "staff" });
    await roleModel.create({ role_name: "เลิกใช้", role_type: "staff", deleted_at: new Date() });
    const target = await roleModel.create({ role_name: "เบเกอร์", role_type: "staff" });
    expect((await patch(session, target._id, { role_name: "ผู้จัดการ" })).status).toBe(409);
    expect((await patch(session, target._id, { role_name: "เลิกใช้" })).status).toBe(200);
  });

  it("ชื่อว่าง / ยาวเกิน 60 → 400", async () => {
    const { session } = await sessionFor("owner");
    const target = await roleModel.create({ role_name: "เบเกอร์", role_type: "staff" });
    expect((await patch(session, target._id, { role_name: "   " })).status).toBe(400);
    expect((await patch(session, target._id, { role_name: "ก".repeat(61) })).status).toBe(400);
  });

  it("เปลี่ยน role_type → 400 (ข้อมูลไม่เปลี่ยน) · ส่งค่าเดิมมาด้วยได้", async () => {
    const { session } = await sessionFor("owner");
    const target = await roleModel.create({ role_name: "เบเกอร์", role_type: "staff" });
    expect((await patch(session, target._id, { role_type: "owner" })).status).toBe(400);
    expect((await roleModel.findById(target._id).lean<{ role_type: string }>())?.role_type).toBe("staff");
    expect((await patch(session, target._id, { role_name: "เบเกอร์อาวุโส", role_type: "staff" })).status).toBe(200);
  });

  it("พนักงานที่มี employees.update ยกบทบาทตัวเองเป็น owner ไม่ได้ · แต่เปลี่ยนชื่อได้", async () => {
    const { session, role } = await sessionFor("staff", { can_view: true, can_update: true });
    expect((await patch(session, role._id, { role_type: "owner" })).status).toBe(400);
    expect((await patch(session, role._id, { role_name: "หัวหน้ากะ" })).status).toBe(200);
  });

  it("พนักงานไม่มี employees.update → 403", async () => {
    const { session } = await sessionFor("staff", { can_view: true });
    const target = await roleModel.create({ role_name: "เบเกอร์", role_type: "staff" });
    expect((await patch(session, target._id, { role_name: "อื่น" })).status).toBe(403);
  });
});

describe("สมัครด้วย Google หลังเปลี่ยนชื่อบทบาทลูกค้า", () => {
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
  });

  it("บทบาท customer ถูกเปลี่ยนชื่อแล้ว → สมัครใหม่ยังได้บทบาทลูกค้า", async () => {
    await roleModel.create({ role_name: "สมาชิก", role_type: "customer" });
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: "g-renamed-1", email: "renamed-role@test.local", name: "ลูกค้าใหม่", email_verified: true },
      protectedHeader: {},
      key: {},
    } as never);
    const result = await authService.loginWithGoogle("dummy-credential");
    expect(result.session.role_type).toBe("customer");
  });
});
