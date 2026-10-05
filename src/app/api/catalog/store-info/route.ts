/**
 * GET /api/catalog/store-info — ข้อมูลร้านสำหรับหน้า "ติดต่อเรา" (สาธารณะ · ย้ายมาจาก /api/customer/store-info · §8.19)
 *   { store_name, logo_url, phones[], contact_email, social_links, weekly_markets[] (เปิดแสดง), address, location | null }
 */
import { ok, route } from "@/lib/apiResponse";
import * as storeService from "@/services/storeService";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok(await storeService.getPublicStoreInfo()));
