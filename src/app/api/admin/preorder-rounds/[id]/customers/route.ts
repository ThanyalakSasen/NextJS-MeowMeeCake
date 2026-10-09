/**
 * GET /api/admin/preorder-rounds/[id]/customers — รายชื่อลูกค้าในรอบ (preorder.view · frontend Q-BE5 · F4)
 *   ?search= (ชื่อ · เบอร์ · อีเมล · เลขพรีออเดอร์) ?payment= (paid|pending|cancelled) ?order_type= (delivery|takeaway)
 *   คืน { round, customers: [{ user_fullname, email, user_phone, order_count, total_spent, orders: [{ preorder_no ·
 *        วิธีรับ (order_type + delivery_address / pickup_point + pickup_date) · สถานะ · items[] }] }], total_customers, total_orders }
 *   ส่งออก CSV ทำฝั่ง frontend จากข้อมูลชุดนี้
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import * as dashboardService from "@/services/preorderRoundDashboardService";

type Ctx = { params: Promise<{ id: string }> };

const ORDER_TYPES = ["delivery", "takeaway"] as const;

export const GET = withPermission("preorder", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const payment = sp.get("payment") || undefined;
  const orderType = sp.get("order_type") || undefined;
  if (payment && !dashboardService.PAYMENT_GROUPS.includes(payment as dashboardService.PaymentGroup)) {
    throw badRequest(`payment ต้องเป็นหนึ่งใน: ${dashboardService.PAYMENT_GROUPS.join(", ")}`);
  }
  if (orderType && !ORDER_TYPES.includes(orderType as (typeof ORDER_TYPES)[number])) {
    throw badRequest(`order_type ต้องเป็นหนึ่งใน: ${ORDER_TYPES.join(", ")}`);
  }
  return ok(
    await dashboardService.getRoundCustomers(id, {
      search: sp.get("search") ?? undefined,
      payment_group: payment as dashboardService.PaymentGroup | undefined,
      order_type: orderType as (typeof ORDER_TYPES)[number] | undefined,
    })
  );
});
