import { describe, it, expect, afterEach, vi } from "vitest";
import { pushLineMessage } from "@/lib/line";

const ORIGINAL_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ORIGINAL_TARGET = process.env.LINE_TARGET_ID;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  else process.env.LINE_CHANNEL_ACCESS_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_TARGET === undefined) delete process.env.LINE_TARGET_ID;
  else process.env.LINE_TARGET_ID = ORIGINAL_TARGET;
  vi.unstubAllGlobals();
});

describe("pushLineMessage", () => {
  it("ไม่ตั้งค่า token/target → คืน ok:false ไม่ยิง fetch", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_TARGET_ID;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await pushLineMessage("hello");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/LINE_CHANNEL_ACCESS_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ตั้งค่าครบ + LINE ตอบ 200 → ok:true", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "token123";
    process.env.LINE_TARGET_ID = "U123";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await pushLineMessage("hello");

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token123" }),
      })
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({ to: "U123", messages: [{ type: "text", text: "hello" }] });
  });

  it("LINE ตอบ error status → ok:false พร้อม error", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "token123";
    process.env.LINE_TARGET_ID = "U123";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "invalid token" })
    );

    const result = await pushLineMessage("hello");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });

  it("fetch throw (network error) → ok:false ไม่ throw ต่อ", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "token123";
    process.env.LINE_TARGET_ID = "U123";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await pushLineMessage("hello");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("ข้อความยาวเกิน 5000 ตัวอักษร → ตัดก่อนส่ง", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "token123";
    process.env.LINE_TARGET_ID = "U123";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await pushLineMessage("x".repeat(6000));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages[0].text.length).toBe(5000);
  });
});
