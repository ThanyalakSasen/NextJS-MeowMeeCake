import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { checkDataIntegrity } from "../src/services/dataIntegrityService";

/**
 * ตรวจข้อมูลสินค้าผิดปกติ (docs/BACKLOG4.md Y11) — ตัวเดียวกับ /api/cron/data-integrity แต่รันจากเซิร์ฟเวอร์ตรง ๆ
 * อ่านอย่างเดียว ไม่แก้ข้อมูล · พบปัญหา → แจ้งเจ้าของร้าน (หน้าแจ้งเตือน + LINE) · ใส่ --no-notify = พิมพ์อย่างเดียว
 *
 * รัน: npm run check:data-integrity
 * ตั้งเวลาวันละครั้ง เช่น crontab:  30 7 * * *  cd /app && npm run -s check:data-integrity
 * exit code 2 เมื่อพบปัญหา (ให้ตัวตั้งเวลา/มอนิเตอร์จับได้)
 */
async function main() {
  const result = await checkDataIntegrity({ notify: !process.argv.includes("--no-notify") });
  const { checked, issues, notified } = result;
  console.log(`ตรวจ สินค้า ${checked.products} · ตัวเลือก ${checked.variants} · ตัวเลือกเสริม ${checked.options}`);
  if (!issues.length) {
    console.log("ไม่พบข้อมูลผิดปกติ");
    return;
  }
  console.log(`พบ ${issues.length} รายการ${notified ? " (แจ้งเจ้าของร้านแล้ว)" : ""}:`);
  for (const i of issues) console.log(`  [${i.code}] ${i.collection} ${i.label}: ${i.detail}`);
  process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
