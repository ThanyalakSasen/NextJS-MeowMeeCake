import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/cronAuth";

const ORIGINAL = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

const req = (auth?: string) =>
  new NextRequest("http://localhost:3000/api/cron/preorder-reminders", {
    headers: auth ? { authorization: auth } : {},
  });

describe("assertCronAuthorized", () => {
  it("ไม่ตั้ง CRON_SECRET → ปิด endpoint (401) แม้ส่ง header มา", () => {
    delete process.env.CRON_SECRET;
    expect(() => assertCronAuthorized(req("Bearer anything"))).toThrow(/CRON_SECRET/);
  });

  it("secret ถูก → ผ่าน", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(() => assertCronAuthorized(req("Bearer s3cret-value"))).not.toThrow();
  });

  it("ไม่มี header / secret ผิด / ผิดรูปแบบ → 401", () => {
    process.env.CRON_SECRET = "s3cret-value";
    for (const h of [undefined, "Bearer wrong", "s3cret-value", "Basic s3cret-value", "Bearer "]) {
      try {
        assertCronAuthorized(req(h));
        throw new Error(`ควร throw สำหรับ ${h}`);
      } catch (err) {
        expect((err as { status?: number }).status).toBe(401);
      }
    }
  });
});
