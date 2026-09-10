/** GET /api/catalog/banners — แบนเนอร์หน้าร้านที่เปิดใช้งาน (สาธารณะ) เรียงตาม sort_order */
import { ok, route } from "@/lib/apiResponse";
import { bannerService } from "@/services/bannerService";

export const GET = route(async () => {
  const result = await bannerService.list({
    pagination: { page: 1, limit: 50, skip: 0 },
    sort: { sort_order: 1 },
    filter: { is_active: true },
  });
  return ok(result.items);
});
