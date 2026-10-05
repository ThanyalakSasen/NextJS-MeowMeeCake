import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import preorderModel from "../src/models/preorderModel";
import preorderRoundModel from "../src/models/preorderRoundModel";
import { computePaymentDueAt, paymentDeadlineHours } from "../src/services/preorderRoundLifecycleService";

/**
 * docs/BACKLOG4.md Y7 — พรีออเดอร์ที่สร้างก่อนมีฟิลด์ payment_due_at (ค่าเป็น null) จะไม่ถูกยกเลิก
 * อัตโนมัติเมื่อไม่จ่าย (cancelUnpaidPreorders กรอง payment_due_at: { $ne: null }) — สคริปต์นี้เติมกำหนดชำระให้
 *
 * ขอบเขต: เฉพาะพรีออเดอร์ที่ยังค้างจ่ายจริง (payment_status pending/failed, ไม่ถูกยกเลิก/เสร็จ, ไม่ถูกลบ)
 *         ที่จ่ายแล้ว/ยกเลิกแล้วไม่ต้องมีกำหนดชำระ → ไม่แตะ
 *
 * กำหนดชำระ = min(เวลาสั่ง + PREORDER_PAYMENT_DEADLINE_HOURS, ปิดรอบ) — สูตรเดียวกับพรีออเดอร์ใหม่
 * แต่ถ้าค่านั้น "เลยไปแล้ว" จะเลื่อนเป็น ตอนรัน + grace ชม. (ค่าเริ่มต้น = PREORDER_PAYMENT_DEADLINE_HOURS)
 * → ลูกค้าเก่าไม่ถูกยกเลิกทันทีในรอบ cron ถัดไปโดยไม่ทันรู้ตัว (รายงานแยกเป็น "extended")
 *
 * ความปลอดภัย:
 *   - ค่าเริ่มต้น = dry-run (อ่านอย่างเดียว พิมพ์แผน) · เขียนจริงต้องส่ง --apply
 *   - --apply: สำรองรายการที่จะแก้ลง scripts/backups/payment-due-<เวลา UTC>.json ก่อน
 *   - เขียนแบบมีเงื่อนไข payment_due_at: null → รันซ้ำได้ / ใครตั้งค่าไว้ระหว่างรัน = ข้าม (conflict)
 *
 * รัน: npm run backfill:payment-due                       (dry-run)
 *      npm run backfill:payment-due -- --apply            (เขียนจริง)
 *      npm run backfill:payment-due -- --apply --grace-hours=48
 */

export interface PaymentDueBackfillResult {
  dryRun: boolean;
  graceHours: number;
  planned: Array<{ _id: string; preorder_no: string; payment_due_at: string; extended: boolean }>;
  /** รอบของพรีออเดอร์หาไม่เจอ — ไม่แตะ ต้องดูเอง */
  missingRound: string[];
  updated: number;
  conflicts: string[];
  backupFile: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

export async function runBackfill(
  opts: { apply?: boolean; now?: Date; graceHours?: number; backupDir?: string } = {}
): Promise<PaymentDueBackfillResult> {
  await dbConnect();
  const dryRun = !opts.apply;
  const now = opts.now ?? new Date();
  const graceHours = opts.graceHours && opts.graceHours > 0 ? opts.graceHours : paymentDeadlineHours();
  const extendedDue = new Date(now.getTime() + graceHours * HOUR_MS);

  const preorders = await preorderModel.collection
    .find(
      {
        deleted_at: null,
        payment_due_at: null,
        order_status: { $nin: ["cancelled", "completed"] },
        payment_status: { $in: ["pending", "failed"] },
      },
      { projection: { preorder_no: 1, round_id: 1, created_at: 1 } }
    )
    .toArray();

  const roundIds = [...new Set(preorders.map((p) => String(p.round_id)))].map((id) => new mongoose.Types.ObjectId(id));
  const rounds = await preorderRoundModel.collection
    .find({ _id: { $in: roundIds } }, { projection: { close_date: 1 } })
    .toArray();
  const closeById = new Map(rounds.map((r) => [String(r._id), r.close_date as Date | null]));

  const planned: PaymentDueBackfillResult["planned"] = [];
  const missingRound: string[] = [];
  for (const p of preorders) {
    const close = closeById.get(String(p.round_id));
    if (!close) {
      missingRound.push(p.preorder_no);
      continue;
    }
    const due = computePaymentDueAt(p.created_at ?? now, close);
    const extended = due.getTime() <= now.getTime();
    planned.push({
      _id: String(p._id),
      preorder_no: p.preorder_no,
      payment_due_at: (extended ? extendedDue : due).toISOString(),
      extended,
    });
  }

  let updated = 0;
  const conflicts: string[] = [];
  let backupFile: string | null = null;
  if (!dryRun && planned.length > 0) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    backupFile = `${dir}/payment-due-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(backupFile, JSON.stringify(planned, null, 2));

    for (const p of planned) {
      const res = await preorderModel.collection
        .updateOne(
          { _id: new mongoose.Types.ObjectId(p._id), payment_due_at: null },
          { $set: { payment_due_at: new Date(p.payment_due_at) } }
        );
      if (res.modifiedCount === 1) updated++;
      else conflicts.push(p.preorder_no);
    }
  }

  const extendedCount = planned.filter((p) => p.extended).length;
  console.log(`backfill-payment-due ${dryRun ? "(DRY-RUN — ไม่ได้เขียนอะไร · ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}`);
  console.log(`  พรีออเดอร์ค้างจ่ายที่ยังไม่มีกำหนดชำระ: ${preorders.length} · จะตั้งค่า: ${planned.length}`);
  console.log(`  เลยกำหนดแล้ว → เลื่อนเป็นตอนนี้ + ${graceHours} ชม.: ${extendedCount}`);
  for (const p of planned) console.log(`    - ${p.preorder_no} → ${p.payment_due_at}${p.extended ? " (เลื่อน)" : ""}`);
  if (missingRound.length) console.log(`  หารอบไม่เจอ (ไม่แตะ): ${missingRound.join(", ")}`);
  if (!dryRun) {
    console.log(`  เขียนสำเร็จ: ${updated} · ถูกตั้งค่าไประหว่างรัน (ข้าม): ${conflicts.length}`);
    if (backupFile) console.log(`  รายการที่แก้: ${backupFile}`);
  }

  return { dryRun, graceHours, planned, missingRound, updated, conflicts, backupFile };
}

function argNumber(name: string): number | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : undefined;
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run backfill:payment-due`)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runBackfill({ apply: process.argv.includes("--apply"), graceHours: argNumber("grace-hours") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
