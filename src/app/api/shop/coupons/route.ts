/**
 * GET /api/shop/coupons — { catalog: คูปองที่แลกด้วยแต้มได้, coupons: คูปองของฉัน (+ state available/used/expired) }
 * couponService (customer-backend-merge.md §8.11)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as couponService from "@/services/couponService";

export const GET = withAuth(async (session) => ok(await couponService.getCouponOverview(session.user_id)));
