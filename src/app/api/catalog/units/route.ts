/** GET /api/catalog/units — หน่วยนับ (สาธารณะ ใช้แสดงผลหน้าร้าน) ?usage_context=Product */
import type { NextRequest } from "next/server";
import { okList, route } from "@/lib/apiResponse";
import { unitService } from "@/services/unitService";

export const GET = route(async (req: NextRequest) => {
  const usage = req.nextUrl.searchParams.get("usage_context");
  const result = await unitService.list({
    pagination: { page: 1, limit: 200, skip: 0 },
    sort: { unit_name: 1 },
    filter: usage ? { usage_context: usage } : {},
  });
  return okList(result.items);
});
