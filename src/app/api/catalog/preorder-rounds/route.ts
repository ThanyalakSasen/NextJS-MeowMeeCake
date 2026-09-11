/**
 * GET /api/catalog/preorder-rounds — รอบพรีออเดอร์ที่เปิดรับ/กำลังจะมาถึง (สาธารณะ)
 *   ?status=scheduled|open  ?search=  ?page=  ?limit=  ?all=1 (รวมรอบที่ปิด/ยกเลิกด้วย)
 *   ค่าเริ่มต้น: เฉพาะรอบ scheduled/open ที่ close_date ยังไม่ผ่าน
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { parsePagination, parseSort, parseBool } from "@/lib/queryParams";
import * as preorderRoundService from "@/services/preorderRoundService";
import type { RoundStatus } from "@/services/preorderRoundService";

export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const showAll = parseBool(sp.get("all")) ?? false;
  const result = await preorderRoundService.listRounds({
    pagination: parsePagination(sp),
    round_status: (sp.get("status") as RoundStatus | null) ?? undefined,
    search: sp.get("search") ?? undefined,
    upcomingOnly: !showAll,
    sort: parseSort(sp, ["open_date", "close_date", "pickup_date", "created_at"], "open_date"),
  });
  return ok(result);
});
