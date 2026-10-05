/**
 * POST /api/admin/map-link — แปลงลิงก์ Google Maps แบบย่อ (maps.app.goo.gl/...) เป็นพิกัด (ย้ายมาจาก /api/owner/map-link · §8.19)
 *   body { url } → { lat, lng, url } · เบราว์เซอร์ตาม redirect ข้ามโดเมนเองไม่ได้ (CORS) server จึงตามให้
 *   กัน SSRF: ตามได้เฉพาะ https ไปยังโดเมน Google (ทุกขั้น) ≤ 6 ขั้น ≤ 8 วินาที ไม่อ่าน body
 *   ใช้ตอนตั้งพิกัดร้าน (เจ้าของร้านเท่านั้น เหมือน /api/admin/store-settings) · 20 ครั้ง/10 นาที
 */
import { ok } from "@/lib/apiResponse";
import { requireRole, withAuth } from "@/lib/authGuard";
import { rateLimit } from "@/lib/rateLimit";
import * as storeService from "@/services/storeService";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  requireRole(session, "owner");
  rateLimit(session.user_id, "admin:map-link", { limit: 20, windowMs: 10 * 60_000 });
  const body = await req.json().catch(() => null);
  return ok(await storeService.resolveMapLink(body?.url));
});
