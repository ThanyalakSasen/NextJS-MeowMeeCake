/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest";
import { authOptions } from "@/lib/nextAuth";
import { __resetRateLimit } from "@/lib/rateLimit";

/** ล็อกอินผ่าน next-auth (credentials) จำกัด 10 ครั้ง/นาที/IP โควตาเดียวกับ /api/auth/login (docs/BACKLOG5.md Y4) */

const credentials = authOptions.providers.find((p) => p.id === "credentials") as any;
const authorize = (email: string, ip: string) =>
  credentials.options.authorize({ email, password: "wrong-password" }, { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

beforeEach(() => __resetRateLimit());

describe("next-auth credentials rate limit", () => {
  it("IP เดียวสุ่มหลายบัญชี: 10 ครั้งแรกได้ error ปกติ · ครั้งที่ 11 = คำขอถี่เกินไป · IP อื่นยังใช้ได้", async () => {
    for (let i = 0; i < 10; i++) {
      await expect(authorize(`nobody${i}@test.local`, "203.0.113.7")).rejects.toThrow(/^(?!คำขอถี่เกินไป)/);
    }
    await expect(authorize("nobody-x@test.local", "203.0.113.7")).rejects.toThrow(/คำขอถี่เกินไป/);
    await expect(authorize("nobody-y@test.local", "198.51.100.2")).rejects.not.toThrow(/คำขอถี่เกินไป/);
  });
});
