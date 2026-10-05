/**
 * GET /api/catalog/store-logo — URL โลโก้ร้านล่าสุด (สาธารณะ · ย้ายมาจาก /api/customer/store-logo · §8.19)
 *   { url, updated_at } · ยังไม่เคยอัปโหลด → /pictures/logoMoewMeeCake.png · ห้าม cache (เปลี่ยนทันทีที่อัปโหลดใหม่)
 */
import { ok, route } from "@/lib/apiResponse";
import * as storeService from "@/services/storeService";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok(await storeService.getStoreLogo()));
