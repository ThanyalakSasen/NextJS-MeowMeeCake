/**
 * โหลดตัวแปรจาก .env.local (หรือ .env) เข้าสู่ process.env
 * ต้อง import ไฟล์นี้ "เป็นบรรทัดแรก" ของสคริปต์ ก่อน import อะไรที่อ่าน env ตอนโหลดโมดูล
 * (เช่น src/lib/dbConnect.ts) เพราะสคริปต์รันด้วย tsx ไม่ได้ผ่านตัวโหลด env ของ Next.js
 */
import { existsSync } from "node:fs";

type ProcWithLoad = NodeJS.Process & { loadEnvFile?: (path?: string) => void };
const proc = process as ProcWithLoad;

for (const file of [".env.local", ".env"]) {
  if (existsSync(file) && typeof proc.loadEnvFile === "function") {
    proc.loadEnvFile(file);
    break;
  }
}
