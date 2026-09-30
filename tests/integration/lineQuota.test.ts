import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import notificationModel from "@/models/notificationModel";
import { notifyCustomer } from "@/services/customerNotifyService";
import { notificationService } from "@/services/notificationService";
import { getQuotaStatus, ownerQuotaReserve, resetQuotaCache } from "@/lib/lineQuota";
import { makeUser } from "./helpers";

/**
 * docs/LINE.md §9.6 — โควตาข้อความ LINE OA (ฟรี 300/เดือน)
 *   ข้อ ข: เหลือ ≤ reserve → หยุดส่งหาลูกค้า (เจ้าของร้านยังส่งได้)
 *   ข้อ ค: แจ้งในหน้าแจ้งเตือนเว็บ (ไม่กินโควตา) เดือนละครั้ง ตอนใกล้หมด / LINE ตอบ 429
 */

const PUSH_URL = "https://api.line.me/v2/bot/message/push";

/** fetch ปลอม: ตอบ quota/consumption ตามที่กำหนด · push ตอบตาม pushStatus */
function stubLine(opts: { limit?: number | null; used?: number; pushStatus?: number; quotaFails?: boolean }) {
  const spy = vi.fn(async (url: string) => {
    if (url.endsWith("/v2/bot/message/quota")) {
      if (opts.quotaFails) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        json: async () => (opts.limit === null ? { type: "none" } : { type: "limited", value: opts.limit ?? 300 }),
      };
    }
    if (url.endsWith("/v2/bot/message/quota/consumption")) {
      return { ok: true, json: async () => ({ totalUsage: opts.used ?? 0 }) };
    }
    const status = opts.pushStatus ?? 200;
    return { ok: status < 400, status, text: async () => (status === 429 ? "You have reached your monthly limit." : "") };
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const pushes = (spy: ReturnType<typeof vi.fn>, to?: string) =>
  spy.mock.calls.filter(
    ([url, init]) => url === PUSH_URL && (to === undefined || JSON.parse((init as { body: string }).body).to === to)
  ).length;

const quotaAlerts = (prefix: string) =>
  notificationModel.find({ title: new RegExp(`^${prefix} \\(\\d{4}-\\d{2}\\)$`) }).lean();

beforeEach(() => {
  resetQuotaCache();
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "token-test";
  process.env.LINE_TARGET_ID = "U_OWNER";
  delete process.env.LINE_OWNER_QUOTA_RESERVE;
});

afterEach(() => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.LINE_TARGET_ID;
  delete process.env.LINE_OWNER_QUOTA_RESERVE;
  vi.unstubAllGlobals();
});

describe("ownerQuotaReserve", () => {
  it("ค่าเริ่มต้น 30 · ตั้งค่าได้ · ค่าผิดกลับเป็น 30", () => {
    expect(ownerQuotaReserve()).toBe(30);
    process.env.LINE_OWNER_QUOTA_RESERVE = "50";
    expect(ownerQuotaReserve()).toBe(50);
    process.env.LINE_OWNER_QUOTA_RESERVE = "0";
    expect(ownerQuotaReserve()).toBe(0);
    process.env.LINE_OWNER_QUOTA_RESERVE = "-3";
    expect(ownerQuotaReserve()).toBe(30);
    process.env.LINE_OWNER_QUOTA_RESERVE = "abc";
    expect(ownerQuotaReserve()).toBe(30);
  });
});

describe("ข้อ ข — กันโควตาไว้ให้เจ้าของร้าน", () => {
  it("โควตาเหลือเยอะ (300 ใช้ 10) → ส่งหาลูกค้าได้", async () => {
    const spy = stubLine({ limit: 300, used: 10 });
    const u = await makeUser({ line_user_id: "U_C1" });
    expect(await notifyCustomer(String(u._id), "hi")).toBe(true);
    expect(pushes(spy, "U_C1")).toBe(1);
  });

  it("เหลือ 30 (= reserve) → ไม่ส่งหาลูกค้า + แจ้งในเว็บ 'โควตา LINE ใกล้หมด' ครั้งเดียวต่อเดือน", async () => {
    const spy = stubLine({ limit: 300, used: 270 });
    const u = await makeUser({ line_user_id: "U_C2" });

    expect(await notifyCustomer(String(u._id), "hi")).toBe(false);
    expect(await notifyCustomer(String(u._id), "hi again")).toBe(false);

    expect(pushes(spy)).toBe(0);
    const alerts = await quotaAlerts("โควตา LINE ใกล้หมด");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("30/300");
  });

  it("เจ้าของร้านยังส่งได้แม้โควตาต่ำกว่า reserve (ใช้โควตาที่กันไว้)", async () => {
    const spy = stubLine({ limit: 300, used: 290 });
    await notificationService.notify({ title: "สินค้าใกล้หมด: ทดสอบ", message: "x", module: "ingredient", type: "warning" });
    expect(pushes(spy, "U_OWNER")).toBe(1);
  });

  it("นับที่ส่งสำเร็จเพิ่มเองระหว่าง cache — ข้าม reserve กลางทางแล้วหยุดทันที", async () => {
    process.env.LINE_OWNER_QUOTA_RESERVE = "30";
    const spy = stubLine({ limit: 300, used: 268 }); // เหลือ 32
    const u = await makeUser({ line_user_id: "U_C3" });

    expect(await notifyCustomer(String(u._id), "1")).toBe(true); // เหลือ 31
    expect(await notifyCustomer(String(u._id), "2")).toBe(true); // เหลือ 30
    expect(await notifyCustomer(String(u._id), "3")).toBe(false); // ถึง reserve แล้ว
    expect(pushes(spy, "U_C3")).toBe(2);
    // ถาม LINE แค่รอบแรก (cache) — quota + consumption อย่างละครั้ง
    expect(spy.mock.calls.filter(([url]) => String(url).includes("/quota")).length).toBe(2);
  });

  it("แพ็กเกจไม่จำกัด (type none) → ส่งได้เสมอ", async () => {
    const spy = stubLine({ limit: null, used: 99999 });
    const u = await makeUser({ line_user_id: "U_C4" });
    expect(await notifyCustomer(String(u._id), "hi")).toBe(true);
    expect(pushes(spy, "U_C4")).toBe(1);
    expect((await getQuotaStatus())?.remaining).toBeNull();
  });

  it("ถามโควตาไม่ได้ (API error) → fail-open ส่งตามปกติ", async () => {
    const spy = stubLine({ quotaFails: true });
    const u = await makeUser({ line_user_id: "U_C5" });
    expect(await notifyCustomer(String(u._id), "hi")).toBe(true);
    expect(pushes(spy, "U_C5")).toBe(1);
  });
});

describe("ข้อ ค — LINE ตอบ 429 (โควตาหมด) → แจ้งในเว็บ", () => {
  it("push ของเจ้าของร้านได้ 429 → 'โควตา LINE หมดแล้ว' ครั้งเดียวต่อเดือน + line_error บันทึกไว้", async () => {
    stubLine({ quotaFails: true, pushStatus: 429 });
    const a = await notificationService.notify({ title: "ออเดอร์ใหม่ A", message: "x", module: "order", type: "info" });
    await notificationService.notify({ title: "ออเดอร์ใหม่ B", message: "x", module: "order", type: "info" });

    expect(await quotaAlerts("โควตา LINE หมดแล้ว")).toHaveLength(1);
    const saved = await notificationModel.findById(a._id).lean<{ line_error: string | null }>();
    expect(saved?.line_error).toMatch(/429/);
  });

  it("push หาลูกค้าได้ 429 → แจ้งในเว็บเหมือนกัน", async () => {
    stubLine({ quotaFails: true, pushStatus: 429 });
    const u = await makeUser({ line_user_id: "U_C6" });
    expect(await notifyCustomer(String(u._id), "hi")).toBe(false);
    expect(await quotaAlerts("โควตา LINE หมดแล้ว")).toHaveLength(1);
  });
});
