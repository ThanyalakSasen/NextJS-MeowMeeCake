import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { sendPickupReminders } from "../src/services/preorderReminderService";

/**
 * เตือนลูกค้าก่อนวันรับพรีออเดอร์ทาง LINE — ตัวเดียวกับ /api/cron/preorder-reminders แต่รันจากเครื่อง/เซิร์ฟเวอร์ตรง ๆ
 * (docs/LINE.md §9.7)
 *
 * รัน: npm run remind:preorders            ส่งจริง
 *      npm run remind:preorders -- --dry-run  ดูรายชื่ออย่างเดียว
 *
 * ตั้งเวลาวันละครั้ง เช่น crontab (เวลาเครื่องเป็นเวลาไทย):  0 18 * * *  cd /app && npm run remind:preorders
 * รันซ้ำในวันเดียวกันได้ — พรีออเดอร์ที่เตือนแล้วจะไม่ถูกส่งซ้ำ (pickup_reminded_at)
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await sendPickupReminders({ dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
