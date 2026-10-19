/**
 * instrumentation — Next.js เรียก register() ครั้งเดียวตอนเซิร์ฟเวอร์เริ่ม
 *
 * docs/BACKLOG5.md G6 — rate limit / permission cache / delivery-zone cache / cache คำพ้อง / โควตา LINE แชร์ผ่าน MongoDB แล้ว
 * → รันหลาย instance ได้ (pm2 cluster ฯลฯ) · ที่เหลือคือไฟล์อัปโหลด: driver `local` เขียนลงดิสก์ของเครื่อง
 * → บน serverless เขียนไม่ได้/หาย ต้องใช้ `UPLOAD_DRIVER=s3` — เตือนใน log ถ้าตรวจพบว่ายังไม่ได้ตั้ง
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.VERCEL || process.env.UPLOAD_DRIVER === "s3") return;

  const { log } = await import("./lib/logger");
  log.warn("runtime.serverless_local_uploads", {
    hint: "serverless เขียนไฟล์ลง public/uploads ไม่ได้ — ตั้ง UPLOAD_DRIVER=s3 (docs/uploads.md)",
  });
}
