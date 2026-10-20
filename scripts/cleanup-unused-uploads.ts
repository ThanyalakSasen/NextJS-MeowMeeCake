import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { cleanupUnusedUploads } from "../src/services/storageCleanupService";

/**
 * ลบไฟล์ใน S3/R2 ที่ไม่มีข้อมูลใน DB อ้างถึง + อัปโหลดมานานกว่า N วัน — ตัวเดียวกับ /api/cron/storage-cleanup
 * แต่รันจากเครื่องที่ตั้ง env ชุดเดียวกับ production (docs/uploads.md §7)
 *
 * รัน: npm run cleanup:unused-uploads                       (dry-run — รายงานอย่างเดียว)
 *      npm run cleanup:unused-uploads -- --apply            (ลบจริง)
 *      npm run cleanup:unused-uploads -- --days=90 --apply  (เปลี่ยนอายุขั้นต่ำ — ค่าเริ่มต้น 60 วัน)
 */
async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="))?.split("=")[1];
  const res = await cleanupUnusedUploads({
    apply: process.argv.includes("--apply"),
    minAgeDays: daysArg === undefined ? undefined : Number(daysArg),
  });
  if (res.skipped) {
    console.log(`cleanup-unused-uploads: ข้าม — ${res.skipped}`);
    return;
  }
  console.log(`cleanup-unused-uploads ${res.dryRun ? "(DRY-RUN — ไม่ได้ลบ · ใส่ --apply เพื่อลบจริง)" : "(APPLY)"}`);
  console.log(`  ไฟล์ที่ DB อ้างถึง: ${res.referenced} · object ใน bucket: ${res.scanned}`);
  console.log(`  ใช้อยู่ ${res.inUse} · ไม่ได้ใช้แต่ใหม่กว่า ${res.minAgeDays} วัน ${res.tooNew} · ไม่ใช่ไฟล์ของระบบ (ไม่แตะ) ${res.ignored}`);
  console.log(`  ${res.dryRun ? "จะลบ" : "ลบแล้ว"}: ${res.deleted.length} ไฟล์ (${(res.deletedBytes / 1024 / 1024).toFixed(2)} MB)${res.remaining ? ` · เหลือรอบหน้า ${res.remaining}` : ""}`);
  for (const k of res.deleted) console.log(`    - ${k}`);
  for (const f of res.failed) console.log(`    ✗ ${f.key}: ${f.error}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
