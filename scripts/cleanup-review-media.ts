import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { cleanupOrphanReviewMedia } from "../src/services/reviewMediaService";

/**
 * ลบไฟล์รูป/วิดีโอรีวิวที่ค้าง (อัปโหลดแล้วไม่มีรีวิวอ้างถึง เกิน 24 ชม.) ใน public/uploads/reviews
 * (localDisk เท่านั้น — UPLOAD_DRIVER=s3 ข้าม) · customer-backend-merge.md §8.18
 * รัน: npm run cleanup:review-media · ตั้ง cron วันละครั้ง (docs/DEPLOY.md ⑧)
 */
async function main() {
  console.log(`cleanup-review-media: ลบไฟล์ค้าง ${await cleanupOrphanReviewMedia()} ไฟล์`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
