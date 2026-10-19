/**
 * GET /api/admin/reviews/stats — สรุปรีวิวสำหรับแดชบอร์ด (reports.view) · คำนวณจากรีวิวทุกรายการในช่วง
 *   ?since=ISO&until=ISO (until แบบ $lt) &bucket=day|month [&prev_since=ISO&prev_until=ISO = สรุปช่วงก่อนหน้าไว้เทียบ]
 *   [&product_id= = สรุปเฉพาะสินค้านี้]
 *   ดูรูปแบบผลลัพธ์ที่ services/reviewStatsService.ts
 */
import { z } from "zod";
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import { parseQuery } from "@/lib/validate";
import { objectId } from "@/schemas/common";
import { getReviewStats } from "@/services/reviewStatsService";

const date = z.coerce.date();
const query = z.object({
  since: date,
  until: date,
  bucket: z.enum(["day", "month"]).default("day"),
  prev_since: date.optional(),
  prev_until: date.optional(),
  /** เฉพาะสินค้านี้ (แดชบอร์ดกรองรายสินค้า) */
  product_id: objectId.optional(),
});

export const GET = withPermission("reports", "view", async (_s, req) => {
  const q = parseQuery(req.nextUrl.searchParams, query);
  if (q.until <= q.since) throw badRequest("until ต้องอยู่หลัง since");
  if (!!q.prev_since !== !!q.prev_until) throw badRequest("ต้องส่ง prev_since และ prev_until คู่กัน");
  return ok(
    await getReviewStats({
      since: q.since,
      until: q.until,
      bucket: q.bucket,
      prevSince: q.prev_since,
      prevUntil: q.prev_until,
      productId: q.product_id,
    }),
  );
});
