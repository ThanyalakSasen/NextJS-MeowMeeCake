import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import preorderModel from "@/models/preorderModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import notificationModel from "@/models/notificationModel";
import { reminderDaysBefore, sendPickupReminders } from "@/services/preorderReminderService";
import { resetQuotaCache } from "@/lib/lineQuota";
import { makeUser, makePreorder } from "./helpers";

/** docs/LINE.md §9.7 — เตือนลูกค้าก่อนวันรับพรีออเดอร์ */

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
// 18:00 เวลาไทย 1 ต.ค. 2026 → "พรุ่งนี้" = 2 ต.ค. (เวลาไทย)
const NOW = new Date("2026-10-01T11:00:00Z");

let fetchSpy: ReturnType<typeof vi.fn>;
const pushedTo = (to: string): string[] =>
  fetchSpy.mock.calls
    .filter(([url]) => url === PUSH_URL)
    .map(([, init]) => JSON.parse((init as { body: string }).body))
    .filter((b) => b.to === to)
    .map((b) => b.messages[0].text as string);

async function makeRound(pickup: string, over: Record<string, unknown> = {}) {
  const u = await makeUser();
  return preorderRoundModel.create({
    created_by: u._id,
    round_name: `รอบ ${pickup}`,
    open_date: new Date("2026-09-20T00:00:00Z"),
    close_date: new Date("2026-09-30T00:00:00Z"),
    pickup_date: new Date(pickup),
    round_status: "closed",
    ...over,
  });
}

beforeEach(async () => {
  resetQuotaCache();
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "token-test";
  // quota API ตอบ error → fail-open (ไม่ใช่เรื่องที่เทสนี้ตรวจ) · push ตอบสำเร็จ
  fetchSpy = vi.fn(async (url: string) =>
    url === PUSH_URL ? { ok: true } : { ok: false, status: 500, json: async () => ({}) }
  );
  vi.stubGlobal("fetch", fetchSpy);
  // เคลียร์ของเทสก่อนหน้าในไฟล์เดียวกัน (DB เดียวกันทั้งไฟล์)
  await preorderRoundModel.deleteMany({});
  await preorderModel.deleteMany({});
});

afterEach(() => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.PREORDER_REMINDER_DAYS_BEFORE;
  vi.unstubAllGlobals();
});

describe("sendPickupReminders", () => {
  it("เตือนเฉพาะพรีออเดอร์ที่รับพรุ่งนี้ (เวลาไทย) · ข้ามยกเลิก/เสร็จแล้ว/รอบยกเลิก · นับ sent/skipped", async () => {
    const tomorrow = await makeRound("2026-10-02T03:00:00Z"); // 10:00 น. 2 ต.ค. (ไทย)
    const tomorrowEarly = await makeRound("2026-10-01T17:30:00Z"); // 00:30 น. 2 ต.ค. (ไทย) — ยังนับเป็นพรุ่งนี้
    const tonight = await makeRound("2026-10-01T16:30:00Z"); // 23:30 น. 1 ต.ค. (ไทย) — วันนี้ ไม่ใช่พรุ่งนี้
    const cancelledRound = await makeRound("2026-10-02T03:00:00Z", { round_status: "cancelled" });

    const linkedA = await makeUser({ line_user_id: "U_A" });
    const linkedB = await makeUser({ line_user_id: "U_B" });
    const unlinked = await makeUser();

    const a = await makePreorder(String(linkedA._id), { round_id: tomorrow._id, order_type: "takeaway" });
    const b = await makePreorder(String(linkedB._id), {
      round_id: tomorrowEarly._id,
      order_type: "delivery",
      payment_status: "paid",
    });
    const c = await makePreorder(String(unlinked._id), { round_id: tomorrow._id });
    await makePreorder(String(linkedA._id), { round_id: tomorrow._id, order_status: "cancelled" });
    await makePreorder(String(linkedA._id), { round_id: tomorrow._id, order_status: "completed" });
    await makePreorder(String(linkedA._id), { round_id: tonight._id });
    await makePreorder(String(linkedA._id), { round_id: cancelledRound._id });

    const res = await sendPickupReminders({ now: NOW });

    expect(res.pickup_date).toBe("2026-10-02");
    expect(res.due).toBe(3);
    expect(res.sent).toBe(2);
    expect(res.skipped).toBe(1); // ไม่ได้ผูก LINE
    expect(res.preorder_nos.sort()).toEqual([a.preorder_no, b.preorder_no, c.preorder_no].sort());

    // รับเอง + ยังไม่จ่าย → "มารับได้ที่ร้าน" + เตือนชำระเงิน
    expect(pushedTo("U_A")).toHaveLength(1);
    expect(pushedTo("U_A")[0]).toContain(a.preorder_no);
    expect(pushedTo("U_A")[0]).toContain("มารับได้ที่ร้าน");
    expect(pushedTo("U_A")[0]).toContain("ยังไม่ได้ชำระเงิน");
    // จัดส่ง + จ่ายแล้ว → "เริ่มจัดส่ง" ไม่มีเตือนชำระ
    expect(pushedTo("U_B")[0]).toContain("เริ่มจัดส่ง");
    expect(pushedTo("U_B")[0]).not.toContain("ยังไม่ได้ชำระเงิน");

    // ทำเครื่องหมายทั้ง 3 ตัว (รวมตัวที่ส่งไม่ถึง — ไม่ retry)
    const marked = await preorderModel.countDocuments({ pickup_reminded_at: { $ne: null } });
    expect(marked).toBe(3);

    // สรุปให้ร้านในหน้าแจ้งเตือนเว็บ ไม่ push LINE
    const summary = await notificationModel.findOne({ title: "พรีออเดอร์ถึงวันรับ 2026-10-02: 3 รายการ" }).lean<{
      message: string;
      line_sent: boolean;
    }>();
    expect(summary?.message).toContain("เตือนลูกค้าทาง LINE แล้ว 2 ราย");
    expect(summary?.line_sent).toBe(false);
  });

  it("รันซ้ำ → ไม่ส่งซ้ำ ไม่สร้างสรุปซ้ำ", async () => {
    const round = await makeRound("2026-10-02T03:00:00Z");
    const u = await makeUser({ line_user_id: "U_R" });
    await makePreorder(String(u._id), { round_id: round._id });

    expect((await sendPickupReminders({ now: NOW })).sent).toBe(1);
    const again = await sendPickupReminders({ now: NOW });
    expect(again.due).toBe(0);
    expect(pushedTo("U_R")).toHaveLength(1);
    expect(await notificationModel.countDocuments({ title: /^พรีออเดอร์ถึงวันรับ 2026-10-02/ })).toBe(1);
  });

  it("รันพร้อมกัน 2 ตัว → ลูกค้าได้ข้อความเดียว (จอง pickup_reminded_at แบบ atomic)", async () => {
    const round = await makeRound("2026-10-02T03:00:00Z");
    const u = await makeUser({ line_user_id: "U_P" });
    await makePreorder(String(u._id), { round_id: round._id });

    const [r1, r2] = await Promise.all([sendPickupReminders({ now: NOW }), sendPickupReminders({ now: NOW })]);
    expect(r1.sent + r2.sent).toBe(1);
    expect(pushedTo("U_P")).toHaveLength(1);
  });

  it("dry run → คืนรายชื่อ ไม่ส่ง ไม่ทำเครื่องหมาย", async () => {
    const round = await makeRound("2026-10-02T03:00:00Z");
    const u = await makeUser({ line_user_id: "U_D" });
    const p = await makePreorder(String(u._id), { round_id: round._id });

    const res = await sendPickupReminders({ now: NOW, dryRun: true });
    expect(res.dry_run).toBe(true);
    expect(res.preorder_nos).toEqual([p.preorder_no]);
    expect(pushedTo("U_D")).toHaveLength(0);
    expect((await preorderModel.findById(p._id).lean<{ pickup_reminded_at: Date | null }>())?.pickup_reminded_at).toBeNull();
  });

  it("daysBefore = 0 → เตือนวันรับ (วันนี้ตามเวลาไทย)", async () => {
    const today = await makeRound("2026-10-01T16:30:00Z"); // 23:30 น. 1 ต.ค. (ไทย)
    const u = await makeUser({ line_user_id: "U_T" });
    await makePreorder(String(u._id), { round_id: today._id });

    const res = await sendPickupReminders({ now: NOW, daysBefore: 0 });
    expect(res.pickup_date).toBe("2026-10-01");
    expect(res.sent).toBe(1);
  });
});

describe("reminderDaysBefore", () => {
  it("ค่าเริ่มต้น 1 · ตั้งได้ · ค่าผิดกลับเป็น 1", () => {
    expect(reminderDaysBefore()).toBe(1);
    process.env.PREORDER_REMINDER_DAYS_BEFORE = "2";
    expect(reminderDaysBefore()).toBe(2);
    process.env.PREORDER_REMINDER_DAYS_BEFORE = "0";
    expect(reminderDaysBefore()).toBe(0);
    process.env.PREORDER_REMINDER_DAYS_BEFORE = "-1";
    expect(reminderDaysBefore()).toBe(1);
    process.env.PREORDER_REMINDER_DAYS_BEFORE = "x";
    expect(reminderDaysBefore()).toBe(1);
  });
});
