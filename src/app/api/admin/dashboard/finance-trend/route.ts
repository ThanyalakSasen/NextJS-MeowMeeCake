/**
 * GET /api/admin/dashboard/finance-trend — รายรับ/รายจ่ายรวมต่อช่วง (ตารางเปรียบเทียบของหน้าสรุปกำไร-ขาดทุน)
 *   ?ranges=<from>|<to>,<from>|<to>,… (ISO · ช่วงต่อเนื่องเรียงเก่า→ใหม่ · สูงสุด 60 ช่วง)
 *   คืน: { buckets: [{ from, to, income, expense }] } เป็นบาท — ดู dashboardService.financeTrend
 *   สิทธิ์เดียวกับ revenue-by-channel / expenses/summary
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import * as dashboardService from "@/services/dashboardService";

export const GET = withPermission(["finance_summary", "finance_expenses"], "view", async (_s, req) => {
  const raw = req.nextUrl.searchParams.get("ranges") ?? "";
  const ranges = raw
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [from, to] = part.split("|");
      if (!from || !to) throw badRequest("ranges ต้องเป็นรูปแบบ <from>|<to> คั่นด้วย ,");
      return { from, to };
    });
  return ok(await dashboardService.financeTrend(ranges));
});
