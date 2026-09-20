import { describe, it, expect, afterEach, vi } from "vitest";
import { NextResponse } from "next/server";
import { attachSession, clearSession, SESSION_COOKIE } from "@/lib/session";

/**
 * cookie ของ session ต้องถูกตั้ง/ล้างด้วย attribute ชุดเดียวกันเสมอ (Domain เป็นส่วนของตัวตน cookie —
 * ล้างด้วย Domain ไม่ตรง = ลบไม่ออก) และเลือก SameSite ตามโครงสร้างการ deploy:
 *   ไม่ตั้งอะไร → Lax host-only (same-origin) · ALLOWED_ORIGINS → None+Secure · COOKIE_DOMAIN → Lax+Domain+Secure
 */
function cookieOf(res: NextResponse) {
  return res.cookies.get(SESSION_COOKIE);
}

describe("session cookie options", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ไม่ตั้ง env → Lax, host-only (ไม่มี Domain), ไม่ Secure นอก production", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "");
    vi.stubEnv("COOKIE_DOMAIN", "");
    const c = cookieOf(attachSession(NextResponse.json({}), "tok"));
    expect(c).toMatchObject({ value: "tok", httpOnly: true, sameSite: "lax", path: "/" });
    expect(c?.domain).toBeUndefined();
    expect(c?.secure).toBeFalsy();
  });

  it("ALLOWED_ORIGINS อย่างเดียว (frontend คนละ origin) → SameSite=None + Secure, ไม่มี Domain", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:3001");
    vi.stubEnv("COOKIE_DOMAIN", "");
    const c = cookieOf(attachSession(NextResponse.json({}), "tok"));
    expect(c).toMatchObject({ sameSite: "none", secure: true });
    expect(c?.domain).toBeUndefined();
  });

  it("COOKIE_DOMAIN (subdomain ของ site เดียวกัน) → Lax + Domain + Secure แม้จะมี ALLOWED_ORIGINS ด้วย", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://app.meowmeecake.com");
    vi.stubEnv("COOKIE_DOMAIN", ".meowmeecake.com");
    const c = cookieOf(attachSession(NextResponse.json({}), "tok"));
    expect(c).toMatchObject({ sameSite: "lax", secure: true, domain: ".meowmeecake.com" });
  });

  it("clearSession ส่ง Domain/SameSite/Secure ชุดเดียวกับตอนตั้ง + maxAge 0 + ค่าว่าง", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://app.meowmeecake.com");
    vi.stubEnv("COOKIE_DOMAIN", ".meowmeecake.com");
    const set = cookieOf(attachSession(NextResponse.json({}), "tok"))!;
    const cleared = cookieOf(clearSession(NextResponse.json({})))!;
    expect(cleared).toMatchObject({ value: "", maxAge: 0, domain: set.domain, sameSite: set.sameSite, secure: set.secure, path: set.path });
  });
});
