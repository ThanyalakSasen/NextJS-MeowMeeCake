import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { PATCH as rolePATCH } from "@/app/api/admin/roles/[id]/route";
import { PATCH as userPATCH, DELETE as userDELETE } from "@/app/api/admin/users/[id]/route";
import { assertKeepsOwner } from "@/services/ownerProtection";
import { makeUser } from "./helpers";

/**
 * กันร้านล็อกตัวเองออก (ownerProtection.assertKeepsOwner / assertRoleKeepsOwner)
 *   - ลบ / ปิดใช้งาน / ย้ายบทบาทบัญชีตัวเองไม่ได้ (403)
 *   - เอาเจ้าของร้านคนสุดท้ายที่ใช้งานได้ออกไม่ได้ (409) — รวมปิดใช้งานบทบาท owner ที่เหลืออยู่
 */

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const h = <T,>(x: T) => x as unknown as Handler;

async function ownerActor() {
  const role = await roleModel.create({ role_name: `owner-${Math.random()}`, role_type: "owner" });
  const user = await makeUser({ role_id: role._id });
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: "owner",
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return { session, role, user };
}

async function call(handler: Handler, session: SessionUser, method: string, id: unknown, body?: unknown) {
  const req = new NextRequest(`http://localhost:3000/api/x/${String(id)}`, {
    method,
    headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve({ id: String(id) }) });
  return res.status;
}

const staffRole = () => roleModel.create({ role_name: `staff-${Math.random()}`, role_type: "staff" });

describe("ต้องเหลือเจ้าของร้านเสมอ", () => {
  it("ลบ / ปิดใช้งาน / ย้ายบทบาทบัญชีตัวเองไม่ได้ (403) · แก้ฟิลด์อื่นของตัวเองได้", async () => {
    const me = await ownerActor();
    const other = await staffRole();
    expect(await call(h(userDELETE), me.session, "DELETE", me.user._id)).toBe(403);
    expect(await call(h(userPATCH), me.session, "PATCH", me.user._id, { is_active: false })).toBe(403);
    expect(await call(h(userPATCH), me.session, "PATCH", me.user._id, { role_id: String(other._id) })).toBe(403);
    expect(await call(h(userPATCH), me.session, "PATCH", me.user._id, { user_fullname: "ชื่อใหม่" })).toBe(200);
  });

  it("ปิดใช้งานบทบาท owner ที่มีเจ้าของร้านคนสุดท้าย → 409 · มีเจ้าของในบทบาท owner อื่น = ทำได้", async () => {
    // DB ใช้ร่วมกับเทสอื่น — ปิดบัญชีที่ค้างอยู่ทั้งหมดก่อน ให้เหลือเฉพาะชุดของเทสนี้
    await userModel.updateMany({}, { $set: { is_active: false } });
    const me = await ownerActor();

    expect(await call(h(rolePATCH), me.session, "PATCH", me.role._id, { is_active: false })).toBe(409);
    expect((await roleModel.findById(me.role._id).lean<{ is_active: boolean }>())!.is_active).toBe(true);

    const second = await ownerActor(); // เจ้าของร้านอีกคนในบทบาท owner อีกบทบาท
    void second;
    expect(await call(h(rolePATCH), me.session, "PATCH", me.role._id, { is_active: false })).toBe(200);
  });

  it("assertKeepsOwner: เอาเจ้าของร้านคนสุดท้ายออกไม่ได้ (409) แม้ผู้ทำรายการไม่ใช่บัญชีนั้น", async () => {
    await userModel.updateMany({}, { $set: { is_active: false } });
    const ownerRole = await roleModel.create({ role_name: `ร้าน-${Math.random()}`, role_type: "owner" });
    const lastOwner = await makeUser({ role_id: ownerRole._id });
    const other = await staffRole();
    // session ของระบบ/บัญชีที่ไม่นับเป็นเจ้าของที่ใช้งานได้ (ทางเดียวที่ไปถึงเงื่อนไขนี้ได้ถ้าข้ามการตรวจบัญชีตัวเอง)
    const sys: SessionUser = { user_id: String(other._id), role_id: String(ownerRole._id), role_type: "owner", source: "jwt", auth_time: Date.now() } as SessionUser;
    const id = String(lastOwner._id);

    await expect(assertKeepsOwner(sys, id, { is_active: false })).rejects.toMatchObject({ status: 409 });
    await expect(assertKeepsOwner(sys, id, { remove: true })).rejects.toMatchObject({ status: 409 });
    await expect(assertKeepsOwner(sys, id, { role_id: String(other._id) })).rejects.toMatchObject({ status: 409 });
    // ย้ายไปบทบาท owner อื่น = ยังเป็นเจ้าของ → ผ่าน · แก้ฟิลด์อื่น → ผ่าน
    const ownerRole2 = await roleModel.create({ role_name: `ร้าน2-${Math.random()}`, role_type: "owner" });
    await expect(assertKeepsOwner(sys, id, { role_id: String(ownerRole2._id) })).resolves.toBeUndefined();
    await expect(assertKeepsOwner(sys, id, {})).resolves.toBeUndefined();

    await makeUser({ role_id: ownerRole._id }); // เจ้าของร้านคนที่สอง
    await expect(assertKeepsOwner(sys, id, { remove: true })).resolves.toBeUndefined();
  });
});
