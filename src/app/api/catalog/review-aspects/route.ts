/**
 * GET /api/catalog/review-aspects — แง่มุมที่เปิดใช้งานสำหรับฟอร์มรีวิว (ชอบ / ควรปรับปรุง) · สาธารณะ
 * ย้ายมาจาก /api/customer/review-aspects (customer-backend-merge.md §8.20) → [{ _id, aspect_name_th, aspect_name_eng, placeholder_text, icon }]
 */
import { okList, route } from "@/lib/apiResponse";
import { listActiveAspects } from "@/services/sentimentService";

export const dynamic = "force-dynamic";

export const GET = route(async () => okList(await listActiveAspects()));
