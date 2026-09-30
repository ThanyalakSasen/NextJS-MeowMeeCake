/**
 * preorderReminderService — เตือนลูกค้าทาง LINE ก่อนวันรับพรีออเดอร์ (docs/LINE.md §9.7)
 *
 * รันวันละครั้งจากตัวตั้งเวลาภายนอก (ระบบนี้ไม่มี scheduler ในตัว):
 *   - HTTP: GET/POST /api/cron/preorder-reminders + `Authorization: Bearer <CRON_SECRET>` (Vercel Cron / cron-job.org)
 *   - CLI : npm run remind:preorders [-- --dry-run]  (crontab / Windows Task Scheduler)
 *
 * เลือกพรีออเดอร์ที่ รอบ (preorderRound.pickup_date) ตรงกับ "วันนี้ + PREORDER_REMINDER_DAYS_BEFORE วัน" ตามเวลาไทย
 * (ค่าเริ่มต้น 1 = เตือนล่วงหน้า 1 วัน) · ข้ามรอบที่ยกเลิก + พรีออเดอร์ที่ยกเลิก/เสร็จแล้ว/เคยเตือนแล้ว
 *
 * กันส่งซ้ำ: จอง `pickup_reminded_at` แบบ atomic (เงื่อนไข null) ก่อนส่ง — รันซ้ำ/รันพร้อมกันก็เตือนคนละครั้งเดียว
 * ส่งไม่ถึง (ไม่ได้ผูก LINE / โควตาเหลือน้อย — customerNotifyService) = นับเป็น skipped ไม่ retry
 * (วันรุ่งขึ้นคือวันรับแล้ว เตือนซ้ำก็ไม่ทัน) · สรุปให้ร้านในหน้าแจ้งเตือนเว็บ (ไม่กินโควตา LINE)
 */
import dbConnect from "../lib/dbConnect";
import { bangkokDateString } from "../lib/datetime";
import { log } from "../lib/logger";
import preorderModel from "../models/preorderModel";
import preorderRoundModel from "../models/preorderRoundModel";
import { customerMessages, notifyCustomer } from "./customerNotifyService";
import { notificationService } from "./notificationService";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS_BEFORE = 1;

export interface ReminderResult {
  /** วันรับที่เตือน (YYYY-MM-DD เวลาไทย) */
  pickup_date: string;
  dry_run: boolean;
  /** พรีออเดอร์ที่เข้าเงื่อนไข (ยังไม่เคยเตือน) */
  due: number;
  /** ส่ง LINE ถึงลูกค้าแล้ว */
  sent: number;
  /** ส่งไม่ถึง: ไม่ได้ผูก LINE / โควตาเหลือน้อย / LINE ล้มเหลว (ทำเครื่องหมายว่าเตือนแล้ว — ไม่ retry) */
  skipped: number;
  preorder_nos: string[];
}

/** PREORDER_REMINDER_DAYS_BEFORE — จำนวนเต็ม ≥ 0 (0 = เตือนเช้าวันรับ) · ค่าผิด/ไม่ตั้ง = 1 */
export function reminderDaysBefore(): number {
  const raw = process.env.PREORDER_REMINDER_DAYS_BEFORE?.trim();
  if (!raw) return DEFAULT_DAYS_BEFORE;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAYS_BEFORE;
}

/** ช่วงเวลา [start, end) ของวันตามเวลาไทย */
function bangkokDayRange(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00+07:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export async function sendPickupReminders(
  opts: { now?: Date; daysBefore?: number; dryRun?: boolean } = {}
): Promise<ReminderResult> {
  await dbConnect();
  const now = opts.now ?? new Date();
  const daysBefore = opts.daysBefore ?? reminderDaysBefore();
  const pickupDateStr = bangkokDateString(new Date(now.getTime() + daysBefore * DAY_MS));
  const { start, end } = bangkokDayRange(pickupDateStr);
  const dryRun = opts.dryRun ?? false;

  const rounds = await preorderRoundModel
    .find({ pickup_date: { $gte: start, $lt: end }, deleted_at: null, round_status: { $ne: "cancelled" } })
    .select("_id pickup_date")
    .lean<{ _id: unknown; pickup_date: Date }[]>();
  const pickupByRound = new Map(rounds.map((r) => [String(r._id), r.pickup_date]));

  const due = rounds.length
    ? await preorderModel
        .find({
          round_id: { $in: rounds.map((r) => r._id) },
          deleted_at: null,
          order_status: { $nin: ["cancelled", "completed"] },
          pickup_reminded_at: null,
        })
        .select("_id preorder_no user_id round_id order_type payment_status")
        .lean<
          {
            _id: unknown;
            preorder_no: string;
            user_id: unknown;
            round_id: unknown;
            order_type: string;
            payment_status: string;
          }[]
        >()
    : [];

  const result: ReminderResult = {
    pickup_date: pickupDateStr,
    dry_run: dryRun,
    due: due.length,
    sent: 0,
    skipped: 0,
    preorder_nos: due.map((p) => p.preorder_no),
  };
  if (dryRun || due.length === 0) return result;

  for (const p of due) {
    // จองก่อนส่ง — รันซ้ำ/พร้อมกันอีกตัวจะจองไม่ได้แล้วข้าม (กันลูกค้าได้ 2 ข้อความ)
    const claimed = await preorderModel.findOneAndUpdate(
      { _id: p._id, pickup_reminded_at: null },
      { $set: { pickup_reminded_at: now } }
    );
    if (!claimed) continue;

    const text = customerMessages.pickupReminder(p.preorder_no, pickupByRound.get(String(p.round_id)) ?? start, {
      orderType: p.order_type,
      unpaid: p.payment_status !== "paid",
    });
    // ทีละคน (ไม่ Promise.all) — ให้ตัวนับโควตาใน lib/lineQuota หยุดตรง reserve ได้แม่น
    if (await notifyCustomer(p.user_id, text)) result.sent++;
    else result.skipped++;
  }

  // สรุปให้ร้าน — หน้าแจ้งเตือนเว็บอย่างเดียว (line: false ไม่กินโควตา)
  await notificationService
    .notify({
      title: `เปิดรับพรีออเดอร์ถึงวันรับ ${pickupDateStr}: ${due.length} รายการ`,
      message: `เตือนลูกค้าทาง LINE แล้ว จำนวน ${result.sent} ราย · ส่งไม่ถึงจำนวน ${result.skipped} ราย (ไม่ได้ผูก LINE / โควตาการส่งแจ้งเตือนใกล้หมด) — ${result.preorder_nos.join(", ")}`,
      module: "order",
      type: "info",
      link: null,
      line: false,
    })
    .catch((err) => log.error("preorder_reminder.summary_failed", { err }));

  log.info("preorder_reminder.done", { ...result, preorder_nos: undefined });
  return result;
}

export const preorderReminderService = { sendPickupReminders, reminderDaysBefore };
export default preorderReminderService;
