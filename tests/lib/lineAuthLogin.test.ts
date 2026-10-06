import { describe, it, expect, afterEach, vi } from "vitest";
import { SignJWT } from "jose";
import {
  buildAuthorizeUrl,
  exchangeCodeForLineProfile,
  lineAuthConfig,
  safeNextPath,
  signLinkState,
  signLoginState,
  verifyLoginState,
} from "@/lib/lineLogin";

// ล็อกอินด้วย LINE (/api/auth/line + /callback) — ส่วนที่ต่างจากการผูก LINE (tests/lib/lineLogin.test.ts)
const ORIGINAL = { ...process.env };
const config = { channelId: "123", channelSecret: "sec", callbackUrl: "http://localhost:3000/api/auth/line/callback" };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("lineAuthConfig", () => {
  it("ขาด LINE_AUTH_CALLBACK_URL หรือ LINE_AUTH_RETURN_URL → null", () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "123";
    process.env.LINE_LOGIN_CHANNEL_SECRET = "sec";
    process.env.LINE_AUTH_CALLBACK_URL = "http://cb";
    delete process.env.LINE_AUTH_RETURN_URL;
    expect(lineAuthConfig()).toBeNull();
  });

  it("ตั้งครบ → ใช้ channel เดียวกับการผูก แต่ callback ของการล็อกอิน", () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "123";
    process.env.LINE_LOGIN_CHANNEL_SECRET = "sec";
    process.env.LINE_LOGIN_CALLBACK_URL = "http://link-cb";
    process.env.LINE_AUTH_CALLBACK_URL = "http://login-cb";
    process.env.LINE_AUTH_RETURN_URL = "http://localhost:3001/login";
    expect(lineAuthConfig()).toEqual({
      channelId: "123",
      channelSecret: "sec",
      callbackUrl: "http://login-cb",
      returnUrl: "http://localhost:3001/login",
    });
  });
});

describe("safeNextPath", () => {
  it("รับเฉพาะ path ภายใน", () => {
    expect(safeNextPath("/customer/order/1?new=1")).toBe("/customer/order/1?new=1");
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("/" + "a".repeat(600))).toBeNull();
  });
});

describe("login state", () => {
  it("nonce ตรงกับ cookie → ผ่าน + คืน next", async () => {
    process.env.JWT_SECRET = "test-secret";
    const state = await signLoginState("N1", "/customer");
    expect(await verifyLoginState(state, "N1")).toEqual({ next: "/customer" });
  });

  it("ไม่มี next → next null", async () => {
    process.env.JWT_SECRET = "test-secret";
    expect(await verifyLoginState(await signLoginState("N1", null), "N1")).toEqual({ next: null });
  });

  it("nonce ไม่ตรง / ไม่มี cookie (เบราว์เซอร์อื่น — login CSRF) → null", async () => {
    process.env.JWT_SECRET = "test-secret";
    const state = await signLoginState("N1", "/customer");
    expect(await verifyLoginState(state, "N2")).toBeNull();
    expect(await verifyLoginState(state, undefined)).toBeNull();
  });

  it("state ของการผูก LINE (audience line-link) ใช้ล็อกอินไม่ได้", async () => {
    process.env.JWT_SECRET = "test-secret";
    expect(await verifyLoginState(await signLinkState("user-1"), "N1")).toBeNull();
  });

  it("เซ็นด้วย secret อื่น → null", async () => {
    process.env.JWT_SECRET = "test-secret";
    const forged = await new SignJWT({ nonce: "N1" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("line-login")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("other-secret"));
    expect(await verifyLoginState(forged, "N1")).toBeNull();
  });

  it("next ที่ฝังมาใน state ไม่ปลอดภัย → ตัดทิ้ง", async () => {
    process.env.JWT_SECRET = "test-secret";
    const state = await new SignJWT({ nonce: "N1", next: "//evil.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("line-login")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("test-secret"));
    expect(await verifyLoginState(state, "N1")).toEqual({ next: null });
  });
});

describe("buildAuthorizeUrl (ล็อกอิน)", () => {
  it("ขอ scope email เพิ่ม + redirect_uri ของการล็อกอิน", () => {
    const url = new URL(buildAuthorizeUrl(config, "STATE", "openid profile email"));
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/line/callback");
  });
});

describe("exchangeCodeForLineProfile", () => {
  it("คืน sub · name · email · picture จาก id_token ที่ LINE ตรวจแล้ว", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id_token: "IDT" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sub: "U1", name: "แมว", email: "a@b.com", picture: "http://img" }),
        })
    );
    expect(await exchangeCodeForLineProfile(config, "CODE")).toEqual({
      sub: "U1",
      name: "แมว",
      email: "a@b.com",
      picture: "http://img",
    });
  });

  it("ไม่มี email (ผู้ใช้ไม่ให้สิทธิ์) → email null", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id_token: "IDT" }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: "U1" }) })
    );
    expect((await exchangeCodeForLineProfile(config, "CODE")).email).toBeNull();
  });
});
