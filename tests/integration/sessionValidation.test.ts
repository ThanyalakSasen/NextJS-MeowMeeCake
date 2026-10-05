import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import { assertSessionStillValid } from "@/lib/authGuard";
import { signSession, verifySession } from "@/lib/jwt";
import { SESSION_COOKIE, USER_HEADER, type SessionUser } from "@/lib/session";
import { hashPassword } from "@/services/userService";
import { GET as notificationsGET } from "@/app/api/admin/notifications/route";
import { PATCH as passwordPATCH } from "@/app/api/shop/me/password/route";
import { makeUser } from "./helpers";

/** session แบบ cookie ของหลัก (JWT) ตรวจบัญชีกับ DB ทุก request (docs/BACKLOG5.md Y1) */

async function staff(over: Record<string, unknown> = {}) {
  const role = await roleModel.create({ role_name: `staff-${Math.random()}`, role_type: "staff" });
  const user = await makeUser({ role_id: role._id, ...over });
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: "staff",
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return { role, user, session };
}

const withHeader = (url: string, session: SessionUser, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe("assertSessionStillValid — cookie session (JWT)", () => {
  it("role จาก DB เสมอ: token อ้างว่า owner แต่ DB เป็น staff → staff · ย้าย role แล้วได้ role ใหม่ทันที", async () => {
    const { session } = await staff();
    expect((await assertSessionStillValid({ ...session, role_type: "owner" })).role_type).toBe("staff");

    const ownerRole = await roleModel.create({ role_name: `owner-${Math.random()}`, role_type: "owner" });
    await userModel.updateOne({ _id: session.user_id }, { $set: { role_id: ownerRole._id } });
    expect(await assertSessionStillValid(session)).toMatchObject({ role_id: String(ownerRole._id), role_type: "owner" });
  });

  it("ปิดใช้งาน / ลบบัญชี → 401 · role ถูกปิด → 403", async () => {
    const a = await staff({ is_active: false });
    await expect(assertSessionStillValid(a.session)).rejects.toMatchObject({ status: 401 });
    const b = await staff({ deleted_at: new Date() });
    await expect(assertSessionStillValid(b.session)).rejects.toMatchObject({ status: 401 });
    const c = await staff();
    await roleModel.updateOne({ _id: c.role._id }, { $set: { is_active: false } });
    await expect(assertSessionStillValid(c.session)).rejects.toMatchObject({ status: 403 });
  });

  it("เปลี่ยนรหัสหลังออก token → 401 · วินาทีเดียวกัน (token ใหม่หลังเปลี่ยน) ยังใช้ได้", async () => {
    const { session } = await staff();
    const changed = new Date();
    await userModel.updateOne({ _id: session.user_id }, { $set: { password_changed_at: changed } });
    await expect(assertSessionStillValid({ ...session, auth_time: changed.getTime() - 5000 })).rejects.toMatchObject({ status: 401 });
    await expect(assertSessionStillValid({ ...session, auth_time: Math.floor(changed.getTime() / 1000) * 1000 })).resolves.toBeTruthy();
  });

  it("JWT จริง: verifySession ให้ source jwt + auth_time จาก iat", async () => {
    const { session } = await staff();
    const parsed = await verifySession(await signSession(session));
    expect(parsed.source).toBe("jwt");
    expect(Math.abs((parsed.auth_time ?? 0) - Date.now())).toBeLessThan(5000);
  });
});

describe("route ที่เคยใช้ requireAuth ตรง ๆ", () => {
  it("GET /api/admin/notifications: บัญชีถูกปิดระหว่างที่ cookie ยังไม่หมดอายุ → 401", async () => {
    const { session } = await staff();
    expect((await notificationsGET(withHeader("/api/admin/notifications", session))).status).toBe(200);
    await userModel.updateOne({ _id: session.user_id }, { $set: { is_active: false } });
    expect((await notificationsGET(withHeader("/api/admin/notifications", session))).status).toBe(401);
  });
});

describe("เปลี่ยนรหัสผ่านตัวเอง", () => {
  it("ได้ cookie ใหม่ที่ใช้ต่อได้ · token เดิม (ออกก่อนเปลี่ยน) ใช้ไม่ได้", async () => {
    const { session } = await staff({ password: await hashPassword("old-password-1") });
    const old = { ...session, auth_time: Date.now() - 10_000 };
    const res = await passwordPATCH(
      withHeader("/api/shop/me/password", old, {
        method: "PATCH",
        body: { current_password: "old-password-1", new_password: "new-password-2" },
      })
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    const token = cookie.split(";")[0].slice(SESSION_COOKIE.length + 1);
    await expect(assertSessionStillValid(await verifySession(token))).resolves.toMatchObject({ user_id: session.user_id });
    await expect(assertSessionStillValid(old)).rejects.toMatchObject({ status: 401 });
  });
});
