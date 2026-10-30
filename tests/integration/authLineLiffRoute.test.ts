import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import { POST } from "@/app/api/auth/line/liff/route";

/**
 * POST /api/auth/line/liff — ลูกค้าเปิดหน้าร้านใน LINE (LIFF) → ส่ง id_token จาก liff.getIDToken()
 * → ให้ LINE ตรวจ → ล็อกอิน/สร้างบัญชีจาก line_user_id (บัญชีเดียวกับปุ่ม "เข้าสู่ระบบด้วย LINE") + เซ็ต cookie session
 */
const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

const post = (body: unknown, ip = `10.0.0.${Math.floor(Math.random() * 250)}`) =>
  POST(
    new NextRequest("http://localhost:3000/api/auth/line/liff", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })
  );

const stubVerify = (res: { ok: boolean; status?: number; json?: unknown }) => {
  const spy = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status ?? 200,
    json: async () => res.json,
    text: async () => JSON.stringify(res.json ?? {}),
  });
  vi.stubGlobal("fetch", spy);
  return spy;
};

describe("POST /api/auth/line/liff", () => {
  it("id_token ถูกต้อง → 200 + cookie session + บัญชีลูกค้าผูก line_user_id · ส่ง client_id = LINE_LOGIN_CHANNEL_ID ไปตรวจ", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "2012229103";
    await roleModel.create({ role_name: "customer", role_type: "customer" });
    const spy = stubVerify({ ok: true, json: { sub: "U_LIFF", name: "แมว", email: "liff@example.com" } });

    const res = await post({ idToken: "IDT" });

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/session=/);
    const verifyBody = new URLSearchParams(spy.mock.calls[0][1].body);
    expect(verifyBody.get("id_token")).toBe("IDT");
    expect(verifyBody.get("client_id")).toBe("2012229103");
    expect(await userModel.countDocuments({ line_user_id: "U_LIFF" })).toBe(1);
  });

  it("LINE ตรวจไม่ผ่าน (หมดอายุ/aud ไม่ตรง) → 401 ไม่เซ็ต cookie", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "2012229103";
    stubVerify({ ok: false, status: 400, json: { error: "invalid_request", error_description: "IdToken expired." } });

    const res = await post({ idToken: "OLD" });

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session=[^;]/);
  });

  it("ไม่ส่ง idToken → 400 (ไม่เรียก LINE)", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "2012229103";
    const spy = stubVerify({ ok: true, json: {} });
    const res = await post({});
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("บัญชีถูกปิด → 400 พร้อมข้อความสถานะบัญชี", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "2012229103";
    await roleModel.create({ role_name: "customer", role_type: "customer" });
    stubVerify({ ok: true, json: { sub: "U_LIFF_OFF" } });
    expect((await post({ idToken: "IDT" })).status).toBe(200);
    await userModel.updateOne({ line_user_id: "U_LIFF_OFF" }, { $set: { is_active: false } });

    const res = await post({ idToken: "IDT" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("ปิดใช้งาน");
  });
});
