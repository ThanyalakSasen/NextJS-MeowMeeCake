import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { runRoundScheduler } from "../src/services/preorderRoundLifecycleService";

/**
 * วงจรอัตโนมัติของรอบพรีออเดอร์ — ตัวเดียวกับ /api/cron/preorder-rounds แต่รันจากเครื่อง/เซิร์ฟเวอร์ตรง ๆ
 * (docs/preorder-round-flow.md §6): เปิดรอบที่ถึงเวลา · ปิดรอบที่หมดเวลา (+ ยกเลิกคนไม่จ่าย + สร้างใบสั่งผลิต) ·
 * ยกเลิกพรีออเดอร์ที่เลยกำหนดชำระ
 *
 * รัน: npm run cron:preorder-rounds
 * ตั้งเวลาทุก 15 นาที เช่น crontab:  *\/15 * * * *  cd /app && npm run cron:preorder-rounds
 */
async function main() {
  const result = await runRoundScheduler();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
