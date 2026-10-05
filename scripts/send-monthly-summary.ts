import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { sendMonthlySummary } from "../src/services/monthlySummaryService";

/**
 * สรุปยอดรายเดือนถึงเจ้าของร้าน — ตัวเดียวกับ /api/cron/monthly-summary แต่รันจากเซิร์ฟเวอร์ตรง ๆ (docs/LINE.md §9.13)
 *
 * รัน: npm run summary:monthly                       (ส่งสรุปเดือนที่แล้ว — ครั้งเดียวต่อเดือน)
 *      npm run summary:monthly -- --dry-run           (ดูข้อความ ไม่ส่ง)
 *      npm run summary:monthly -- --month=2026-09     (ระบุเดือน)
 * ตั้งเวลาวันที่ 1 ของเดือน เช่น crontab:  0 8 1 * *  cd /app && npm run -s summary:monthly
 */
async function main() {
  const monthArg = process.argv.find((a) => a.startsWith("--month="))?.split("=")[1];
  const res = await sendMonthlySummary({ month: monthArg, dryRun: process.argv.includes("--dry-run") });
  const status = res.sent ? "ส่งแล้ว" : res.skipped === "already_sent" ? "เดือนนี้ส่งไปแล้ว (ข้าม)" : "DRY-RUN — ไม่ได้ส่ง";
  console.log(`${res.title} — ${status}\n\n${res.message}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
