import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { expireUnpaidOrders } from "../src/services/orderService";

/**
 * ยกเลิกออเดอร์เว็บที่เลยกำหนดชำระ (payment_due_at — สั่ง + 30 นาที) แล้วยังไม่ส่งสลิป
 * ตัวเดียวกับ /api/cron/order-expiry · docs/customer-backend-merge.md §8.8
 *
 * รัน: npm run cron:order-expiry
 * ตั้ง crontab ทุก 5 นาที — บรรทัดตัวอย่างอยู่ที่ docs/DEPLOY.md ⑧
 */
async function main() {
  const { expired } = await expireUnpaidOrders();
  console.log(`order-expiry: ยกเลิก ${expired.length} ออเดอร์${expired.length ? ` — ${expired.join(", ")}` : ""}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
