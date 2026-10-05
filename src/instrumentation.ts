/**
 * instrumentation — Next.js เรียก register() ครั้งเดียวตอนเซิร์ฟเวอร์เริ่ม
 *
 * docs/BACKLOG4.md Y8 — state หลายตัวอยู่ในหน่วยความจำของ process (rate limit, permission cache,
 * delivery-zone cache, cache โควตา LINE) ไม่แชร์ข้าม instance → ออกแบบให้รัน "instance เดียว" (docs/DEPLOY.md §⑤)
 * เตือนใน log ถ้าตรวจพบว่ากำลังรันหลาย instance (pm2 cluster / -i N) หรือบน serverless
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const reasons: string[] = [];
  const pm2Instance = process.env.NODE_APP_INSTANCE;
  if (process.env.exec_mode === "cluster_mode") reasons.push("pm2 cluster mode");
  if (pm2Instance && pm2Instance !== "0") reasons.push(`pm2 instance #${pm2Instance}`);
  if (process.env.VERCEL) reasons.push("Vercel (serverless)");
  if (reasons.length === 0) return;

  const { log } = await import("./lib/logger");
  log.warn("runtime.multi_instance", {
    reasons,
    hint:
      "rate limit / permission cache / delivery-zone cache / โควตา LINE อยู่ในหน่วยความจำ ไม่แชร์ข้าม instance — " +
      "รัน pm2 แบบ fork instance เดียว (docs/DEPLOY.md §⑤, BACKLOG4 Y8)",
  });
}
