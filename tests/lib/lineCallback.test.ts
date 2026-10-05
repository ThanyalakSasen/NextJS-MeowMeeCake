import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { USER_HEADER } from "@/lib/session";

/**
 * docs/LINE.md §9.8 ข้อ 6 — ไม่มี session / session หมดอายุตอน LINE พากลับมาที่ callback →
 * พากลับหน้าโปรไฟล์ด้วย ?line=error&reason=login_required (เดิม: JSON 401 ดิบ ๆ จาก middleware)
 */

// src/lib/jwt.ts (middleware import) throw ตั้งแต่ load ถ้าไม่มี JWT_SECRET — ตั้งก่อน dynamic import
process.env.JWT_SECRET ??= "test-jwt-secret-unit-only";

// unit test ไม่มี DB — ข้ามการตรวจบัญชีกับ DB (เทสแยกใน tests/integration/sessionValidation.test.ts)
vi.mock("@/lib/authGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authGuard")>()),
  assertSessionStillValid: async (s: unknown) => s,
}));

type Handler = (req: NextRequest) => Promise<Response>;
let callbackGET: Handler;
let middleware: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  callbackGET = (await import("@/app/api/shop/me/line/callback/route")).GET as Handler;
  middleware = (await import("@/middleware")).middleware;
});

const ORIGINAL_RETURN = process.env.LINE_LINK_RETURN_URL;
afterEach(() => {
  if (ORIGINAL_RETURN === undefined) delete process.env.LINE_LINK_RETURN_URL;
  else process.env.LINE_LINK_RETURN_URL = ORIGINAL_RETURN;
});

const CALLBACK = "http://localhost:3000/api/shop/me/line/callback";

describe("callback route — ตรวจ session เอง", () => {
  it("ไม่มี session → redirect ?line=error&reason=login_required", async () => {
    process.env.LINE_LINK_RETURN_URL = "http://localhost:3001/profile";
    const res = await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("http://localhost:3001/profile");
    expect(loc.searchParams.get("line")).toBe("error");
    expect(loc.searchParams.get("reason")).toBe("login_required");
  });

  it("ลูกค้ากดยกเลิกในหน้า LINE → cancelled แม้ไม่มี session", async () => {
    process.env.LINE_LINK_RETURN_URL = "http://localhost:3001/profile";
    const res = await callbackGET(new NextRequest(`${CALLBACK}?error=access_denied`));
    expect(new URL(res.headers.get("location")!).searchParams.get("line")).toBe("cancelled");
  });

  it("มี session แต่ state ไม่ใช่ของ user นี้ → error (ไม่มี reason)", async () => {
    process.env.LINE_LINK_RETURN_URL = "http://localhost:3001/profile";
    process.env.LINE_LOGIN_CHANNEL_ID = "123";
    process.env.LINE_LOGIN_CHANNEL_SECRET = "sec";
    process.env.LINE_LOGIN_CALLBACK_URL = CALLBACK;
    const session = { user_id: "u1", role_id: "r", role_type: "customer", email: "a@b.c" };
    const res = await callbackGET(
      new NextRequest(`${CALLBACK}?code=c&state=forged`, { headers: { [USER_HEADER]: JSON.stringify(session) } })
    );
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("line")).toBe("error");
    expect(loc.searchParams.get("reason")).toBeNull();
  });

  it("ไม่ตั้ง LINE_LINK_RETURN_URL → JSON 400 พร้อม reason", async () => {
    delete process.env.LINE_LINK_RETURN_URL;
    const res = await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toEqual({ line: "error", reason: "login_required" });
  });
});

describe("middleware — ยกเว้น callback ให้ถึง route", () => {
  it("callback ไม่มี cookie → ผ่านไปถึง route (ไม่ตัด 401)", async () => {
    const res = await middleware(new NextRequest(`${CALLBACK}?code=c&state=s`));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("callback + cookie session เสีย → ผ่านไปถึง route (ไม่ตัด 401)", async () => {
    const res = await middleware(
      new NextRequest(`${CALLBACK}?code=c&state=s`, { headers: { cookie: "session=broken.jwt.token" } })
    );
    expect(res.status).not.toBe(401);
  });

  it("path อื่นใต้ /api/shop ยังต้องล็อกอินเหมือนเดิม", async () => {
    for (const p of ["/api/shop/me/line", "/api/shop/me", "/api/shop/me/line/callback/extra"]) {
      const res = await middleware(new NextRequest(`http://localhost:3000${p}`));
      expect(res.status).toBe(401);
    }
  });
});
