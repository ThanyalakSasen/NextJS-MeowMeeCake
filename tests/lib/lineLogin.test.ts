import { describe, it, expect, afterEach, vi } from "vitest";
import { SignJWT } from "jose";
import {
  buildAuthorizeUrl,
  exchangeCodeForLineUserId,
  lineLoginConfig,
  signLinkState,
  verifyLinkState,
} from "@/lib/lineLogin";

const ORIGINAL = { ...process.env };
const config = { channelId: "123", channelSecret: "sec", callbackUrl: "http://localhost:3000/cb" };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("lineLoginConfig", () => {
  it("ตั้งค่าไม่ครบ → null", () => {
    delete process.env.LINE_LOGIN_CHANNEL_SECRET;
    process.env.LINE_LOGIN_CHANNEL_ID = "123";
    process.env.LINE_LOGIN_CALLBACK_URL = "http://x";
    expect(lineLoginConfig()).toBeNull();
  });

  it("ตั้งครบ → คืน config", () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "123";
    process.env.LINE_LOGIN_CHANNEL_SECRET = "sec";
    process.env.LINE_LOGIN_CALLBACK_URL = "http://x";
    expect(lineLoginConfig()).toEqual({ channelId: "123", channelSecret: "sec", callbackUrl: "http://x" });
  });
});

describe("link state", () => {
  it("sign แล้ว verify ได้ user_id เดิม", async () => {
    process.env.JWT_SECRET = "test-secret";
    const state = await signLinkState("user-1");
    expect(await verifyLinkState(state)).toBe("user-1");
  });

  it("state ปลอม / เซ็นด้วย secret อื่น → null", async () => {
    process.env.JWT_SECRET = "test-secret";
    expect(await verifyLinkState("not-a-jwt")).toBeNull();
    const forged = await new SignJWT({ uid: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("line-link")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("other-secret"));
    expect(await verifyLinkState(forged)).toBeNull();
  });

  it("session JWT (ไม่มี audience line-link) เอามาใช้เป็น state ไม่ได้", async () => {
    process.env.JWT_SECRET = "test-secret";
    const sessionLike = await new SignJWT({ uid: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("test-secret"));
    expect(await verifyLinkState(sessionLike)).toBeNull();
  });
});

describe("buildAuthorizeUrl", () => {
  it("มี client_id/redirect_uri/state/scope openid + bot_prompt", () => {
    const url = new URL(buildAuthorizeUrl(config, "STATE"));
    expect(url.origin + url.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/cb");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("bot_prompt")).toBe("aggressive");
  });
});

describe("exchangeCodeForLineUserId", () => {
  it("แลก code → id_token → verify → คืน sub", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id_token: "IDT" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: "U_LINE" }) });
    vi.stubGlobal("fetch", fetchSpy);

    expect(await exchangeCodeForLineUserId(config, "CODE")).toBe("U_LINE");
    const tokenBody = new URLSearchParams(fetchSpy.mock.calls[0][1].body);
    expect(tokenBody.get("code")).toBe("CODE");
    expect(tokenBody.get("redirect_uri")).toBe("http://localhost:3000/cb");
    const verifyBody = new URLSearchParams(fetchSpy.mock.calls[1][1].body);
    expect(verifyBody.get("id_token")).toBe("IDT");
    expect(verifyBody.get("client_id")).toBe("123");
  });

  it("LINE ตอบ error ตอนแลก code → throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "invalid_grant" })
    );
    await expect(exchangeCodeForLineUserId(config, "BAD")).rejects.toThrow(/400/);
  });
});
