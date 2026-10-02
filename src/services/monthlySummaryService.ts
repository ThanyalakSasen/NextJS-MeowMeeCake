/**
 * monthlySummaryService — สรุปยอดรายเดือนถึงเจ้าของร้าน (หน้าแจ้งเตือนเว็บ + LINE · docs/LINE.md §9.13)
 *
 * ตัวเลขทั้งหมดมาจาก dashboardService (ชุดเดียวกับหน้า dashboard — ไม่คิดซ้ำคนละสูตร):
 *   ยอดขาย (ออเดอร์ + พรีออเดอร์ที่ชำระแล้ว) เทียบเดือนก่อน · แยกช่องทาง เว็บ / หน้าร้าน / พรีออเดอร์ / อื่น ๆ ·
 *   ออเดอร์ที่ชำระแล้ว + ค่าเฉลี่ยต่อบิล · ค่าใช้จ่าย · ต้นทุนวัตถุดิบ (COGS) · กำไรโดยประมาณ · ขายดี 3 อันดับ ·
 *   สินค้า/วัตถุดิบที่ใกล้หมด ณ ตอนส่ง
 *
 * ตัดรอบเดือนตามเวลาไทย (UTC+7) · ส่งครั้งเดียวต่อเดือน (มีแจ้งเตือนหัวข้อเดือนนั้นแล้ว = ข้าม — รันซ้ำได้)
 * ตั้ง cron วันที่ 1 ของเดือน → ส่งสรุปเดือนที่แล้ว (DEPLOY §⑧)
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { round2 } from "../lib/money";
import notificationModel from "../models/notificationModel";
import * as dashboardService from "./dashboardService";
import { notificationService } from "./notificationService";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
/** หน้า dashboard ของเว็บหลังร้าน — ⚠️ ยังไม่ได้ยืนยัน path กับ frontend (docs/LINE.md §9.13) */
export const MONTHLY_SUMMARY_LINK = "/owner/dashboard";

export function isMonthString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** ช่วงเวลาของเดือน "YYYY-MM" ตามเวลาไทย → [from, to] เป็น UTC (to = มิลลิวินาทีสุดท้ายของเดือน) */
export function monthRange(month: string): { from: Date; to: Date } {
  if (!isMonthString(month)) throw new Error(`month ต้องเป็น YYYY-MM: ${month}`);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - BANGKOK_OFFSET_MS);
  const to = new Date(Date.UTC(y, m, 1) - BANGKOK_OFFSET_MS - 1);
  return { from, to };
}

/** เดือนก่อนหน้าของ "YYYY-MM" */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** เดือนที่แล้วตามเวลาไทย ณ เวลา now (ค่าเริ่มต้นของการส่งวันที่ 1) */
export function previousMonth(now: Date = new Date()): string {
  const th = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const current = `${th.getUTCFullYear()}-${String(th.getUTCMonth() + 1).padStart(2, "0")}`;
  return shiftMonth(current, -1);
}

/** "2026-09" → "กันยายน 2569" */
export function thaiMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

export function summaryTitle(month: string): string {
  return `สรุปยอดเดือน${thaiMonthLabel(month)}`;
}

export interface MonthlySummary {
  month: string;
  label: string;
  revenue: number;
  previous_revenue: number;
  /** % เทียบเดือนก่อน · null = เดือนก่อนไม่มียอด */
  change_pct: number | null;
  by_channel: { web: number; pos: number; preorder: number; other: number };
  paid_orders: number;
  avg_order_value: number;
  expenses: number;
  cogs: number;
  profit_estimate: number;
  top_products: Array<{ name: string; quantity: number; revenue: number }>;
  low_stock: { products: number; ingredients: number };
}

export async function buildMonthlySummary(month: string): Promise<MonthlySummary> {
  await dbConnect();
  const cur = monthRange(month);
  const prev = monthRange(shiftMonth(month, -1));
  const range = { date_from: cur.from.toISOString(), date_to: cur.to.toISOString() };

  const [ov, prevOv, channels, top] = await Promise.all([
    dashboardService.overview(range),
    dashboardService.overview({ date_from: prev.from.toISOString(), date_to: prev.to.toISOString() }),
    dashboardService.revenueByChannel(range),
    dashboardService.topProducts({ ...range, limit: 3 }),
  ]);

  const change_pct = prevOv.revenue > 0 ? round2(((ov.revenue - prevOv.revenue) / prevOv.revenue) * 100) : null;
  return {
    month,
    label: thaiMonthLabel(month),
    revenue: ov.revenue,
    previous_revenue: prevOv.revenue,
    change_pct,
    by_channel: { web: channels.web, pos: channels.pos, preorder: channels.preorder, other: channels.other },
    paid_orders: ov.orders.paid,
    avg_order_value: ov.avg_order_value,
    expenses: ov.expenses,
    cogs: ov.cogs,
    profit_estimate: ov.profit_estimate,
    top_products: top.items.map((i) => ({ name: i.product_name_th, quantity: i.quantity_sold, revenue: i.revenue })),
    low_stock: ov.low_stock,
  };
}

const baht = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

/** ข้อความสรุป (ไม่รวมหัวข้อ — notify() ใส่ "[การเงิน] <title>" ให้) */
export function formatSummaryMessage(s: MonthlySummary): string {
  const change =
    s.change_pct === null ? "" : ` (เดือนก่อน ${baht(s.previous_revenue)} · ${s.change_pct >= 0 ? "+" : ""}${s.change_pct}%)`;
  const ch = s.by_channel;
  const lines = [
    `ยอดขาย ${baht(s.revenue)} บาท${change}`,
    `• เว็บ ${baht(ch.web)} · หน้าร้าน ${baht(ch.pos)} · พรีออเดอร์ ${baht(ch.preorder)}${ch.other ? ` · อื่น ๆ ${baht(ch.other)}` : ""}`,
    `ชำระแล้ว ${s.paid_orders} รายการ · เฉลี่ย ${baht(s.avg_order_value)} บาท/บิล`,
    `ค่าใช้จ่าย ${baht(s.expenses)} · ต้นทุนวัตถุดิบ ${baht(s.cogs)} บาท`,
    `กำไรโดยประมาณ ${baht(s.profit_estimate)} บาท`,
  ];
  if (s.top_products.length) {
    lines.push(`ขายดี: ${s.top_products.map((p, i) => `${i + 1}) ${p.name} ${p.quantity} ชิ้น`).join(" · ")}`);
  }
  if (s.low_stock.products || s.low_stock.ingredients) {
    lines.push(`ตอนนี้ใกล้หมด: สินค้า ${s.low_stock.products} · วัตถุดิบ ${s.low_stock.ingredients}`);
  }
  return lines.join("\n");
}

export interface MonthlySummaryResult {
  month: string;
  title: string;
  sent: boolean;
  /** already_sent = มีสรุปเดือนนี้แล้ว · dry_run = แค่ดู ไม่ส่ง */
  skipped: "already_sent" | "dry_run" | null;
  summary: MonthlySummary;
  message: string;
}

/**
 * ส่งสรุปของเดือน month (ค่าเริ่มต้น = เดือนที่แล้วตามเวลาไทย) — ครั้งเดียวต่อเดือน
 * dryRun = คำนวณ + คืนข้อความ ไม่บันทึก/ไม่ส่ง LINE
 */
export async function sendMonthlySummary(
  opts: { month?: string; now?: Date; dryRun?: boolean } = {}
): Promise<MonthlySummaryResult> {
  await dbConnect();
  const month = opts.month ?? previousMonth(opts.now);
  if (!isMonthString(month)) throw new Error(`month ต้องเป็น YYYY-MM: ${month}`);
  const title = summaryTitle(month);
  const summary = await buildMonthlySummary(month);
  const message = formatSummaryMessage(summary);

  if (opts.dryRun) return { month, title, sent: false, skipped: "dry_run", summary, message };
  if (await notificationModel.exists({ title, deleted_at: null })) {
    return { month, title, sent: false, skipped: "already_sent", summary, message };
  }

  await notificationService.notify({
    title,
    message,
    module: "finance",
    type: "info",
    link: MONTHLY_SUMMARY_LINK,
  });
  log.info("monthly_summary.sent", { month, revenue: summary.revenue });
  return { month, title, sent: true, skipped: null, summary, message };
}

export const monthlySummaryService = { sendMonthlySummary, buildMonthlySummary, previousMonth, monthRange };
export default monthlySummaryService;
