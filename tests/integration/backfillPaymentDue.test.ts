import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import preorderModel from "@/models/preorderModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import { runBackfill } from "../../scripts/backfill-payment-due";
import { makeUser, makePreorder } from "./helpers";

/**
 * docs/BACKLOG4.md Y7 — scripts/backfill-payment-due.ts เติม payment_due_at ให้พรีออเดอร์เก่าที่ค้างจ่าย
 * สูตร = min(สั่ง + N ชม., ปิดรอบ) · เลยแล้ว → ตอนรัน + grace · dry-run ค่าเริ่มต้น
 */

const H = 60 * 60 * 1000;
const NOW = new Date("2026-10-01T12:00:00Z");
let backupDir: string | null = null;
afterEach(() => {
  if (backupDir) rmSync(backupDir, { recursive: true, force: true });
  backupDir = null;
});

async function makeRound(closeInHours: number) {
  const admin = await makeUser();
  return preorderRoundModel.create({
    created_by: admin._id,
    round_name: "Y7",
    open_date: new Date(NOW.getTime() - 72 * H),
    close_date: new Date(NOW.getTime() + closeInHours * H),
    pickup_date: new Date(NOW.getTime() + (closeInHours + 48) * H),
    round_status: "open",
  });
}

async function legacyPreorder(roundId: unknown, orderedHoursAgo: number, over: Record<string, unknown> = {}) {
  const user = await makeUser();
  const p = await makePreorder(String(user._id), { round_id: roundId, ...over });
  // created_at มาจาก timestamps — เขียนทับตรง collection ให้เป็นเวลาสั่งในอดีต
  await preorderModel.collection.updateOne(
    { _id: p._id },
    { $set: { created_at: new Date(NOW.getTime() - orderedHoursAgo * H), payment_due_at: null } }
  );
  return p;
}

const dueOf = async (id: unknown) =>
  (await preorderModel.findById(id).lean<{ payment_due_at: Date | null }>())!.payment_due_at;

describe("scripts/backfill-payment-due (BACKLOG4 Y7)", () => {
  it("dry-run ไม่เขียน · --apply ตั้งค่าตามสูตร / เลื่อนรายการที่เลยแล้ว / ไม่แตะที่จ่ายแล้วหรือยกเลิก", async () => {
    const round = await makeRound(100);
    const fresh = await legacyPreorder(round._id, 2); // สั่ง 2 ชม.ก่อน → due = สั่ง + 24 = อีก 22 ชม.
    const overdue = await legacyPreorder(round._id, 30); // เลยมา 6 ชม. แล้ว → เลื่อนเป็น now + 24
    const paid = await legacyPreorder(round._id, 30, { payment_status: "paid" });
    const cancelled = await legacyPreorder(round._id, 30, { order_status: "cancelled" });

    const dry = await runBackfill({ now: NOW, graceHours: 24 });
    expect(dry.dryRun).toBe(true);
    expect(dry.planned).toHaveLength(2);
    expect(await dueOf(fresh._id)).toBeNull();

    backupDir = mkdtempSync(join(tmpdir(), "y7-"));
    const res = await runBackfill({ apply: true, now: NOW, graceHours: 24, backupDir });
    expect(res.updated).toBe(2);
    expect(res.backupFile).toBeTruthy();
    expect((await dueOf(fresh._id))!.toISOString()).toBe(new Date(NOW.getTime() + 22 * H).toISOString());
    expect((await dueOf(overdue._id))!.toISOString()).toBe(new Date(NOW.getTime() + 24 * H).toISOString());
    expect(res.planned.find((p) => p.preorder_no === overdue.preorder_no)!.extended).toBe(true);
    expect(await dueOf(paid._id)).toBeNull();
    expect(await dueOf(cancelled._id)).toBeNull();

    // รันซ้ำ → ไม่มีอะไรต้องทำ
    const again = await runBackfill({ apply: true, now: NOW, graceHours: 24, backupDir });
    expect(again.planned).toHaveLength(0);
  });

  it("ปิดรอบก่อนครบ N ชม. → กำหนดชำระ = เวลาปิดรอบ", async () => {
    const round = await makeRound(10); // ปิดอีก 10 ชม.
    const p = await legacyPreorder(round._id, 0); // สั่งตอนนี้ → สั่ง + 24 ชม. เกินปิดรอบ
    backupDir = mkdtempSync(join(tmpdir(), "y7-"));
    await runBackfill({ apply: true, now: NOW, graceHours: 1, backupDir });
    expect((await dueOf(p._id))!.toISOString()).toBe(round.close_date.toISOString());
  });
});
