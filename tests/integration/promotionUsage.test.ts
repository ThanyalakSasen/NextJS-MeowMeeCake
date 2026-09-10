import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import promotionModel from "@/models/promotionModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import * as promotionUsageService from "@/services/promotionUsageService";
import { isHttpError } from "@/lib/httpError";

const oid = () => new mongoose.Types.ObjectId().toString();

async function makePromo(over: Record<string, unknown> = {}) {
  return promotionModel.create({
    promotion_code: "T" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    promotion_name: "test promo",
    discount_type: "Amount",
    discount_value: 10,
    start_date: new Date(),
    end_date: new Date(Date.now() + 86_400_000),
    created_by: new mongoose.Types.ObjectId(),
    ...over,
  });
}

const is422 = (e: unknown) => isHttpError(e) && e.status === 422;

describe("promotionUsageService.recordUsage (integration) — BACKLOG §2.9", () => {
  it("จอง used_count + สร้าง usage row", async () => {
    const promo = await makePromo({ usage_limit: 3 });
    await promotionUsageService.recordUsage({
      promotion_id: String(promo._id),
      user_id: oid(),
      discount_applied: 10,
      order_id: oid(),
    });
    const after = await promotionModel.findById(promo._id).lean();
    expect(after!.used_count).toBe(1);
    expect(await promotionUsagesModel.countDocuments({ promotion_id: promo._id })).toBe(1);
  });

  it("ถึง usage_limit → 422, used_count ไม่ขยับ, ไม่มี row", async () => {
    const promo = await makePromo({ usage_limit: 2, used_count: 2 });
    await expect(
      promotionUsageService.recordUsage({
        promotion_id: String(promo._id),
        user_id: oid(),
        discount_applied: 10,
      })
    ).rejects.toSatisfy(is422);
    const after = await promotionModel.findById(promo._id).lean();
    expect(after!.used_count).toBe(2);
    expect(await promotionUsagesModel.countDocuments({ promotion_id: promo._id })).toBe(0);
  });

  it("ยิงพร้อมกัน 8 ครั้ง กับ usage_limit=3 → สำเร็จ 3, used_count=3 (atomic claim)", async () => {
    const promo = await makePromo({ usage_limit: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        promotionUsageService.recordUsage({
          promotion_id: String(promo._id),
          user_id: oid(),
          discount_applied: 10,
        })
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const after = await promotionModel.findById(promo._id).lean();
    expect(after!.used_count).toBe(3);
  });

  it("max_user_per_user เกิน → row ถูกลบ + used_count rollback", async () => {
    const promo = await makePromo({ max_user_per_user: 1 });
    const user = oid();
    await promotionUsageService.recordUsage({
      promotion_id: String(promo._id),
      user_id: user,
      discount_applied: 10,
    });
    await expect(
      promotionUsageService.recordUsage({
        promotion_id: String(promo._id),
        user_id: user,
        discount_applied: 10,
      })
    ).rejects.toSatisfy(is422);
    const after = await promotionModel.findById(promo._id).lean();
    expect(after!.used_count).toBe(1);
    expect(
      await promotionUsagesModel.countDocuments({ promotion_id: promo._id, deleted_at: null })
    ).toBe(1);
  });

  it("revokeUsage: soft-delete row + used_count -1", async () => {
    const promo = await makePromo({ usage_limit: 5 });
    const orderId = oid();
    await promotionUsageService.recordUsage({
      promotion_id: String(promo._id),
      user_id: oid(),
      discount_applied: 10,
      order_id: orderId,
    });
    const res = await promotionUsageService.revokeUsage({ order_id: orderId });
    expect(res.revoked).toBe(1);
    const after = await promotionModel.findById(promo._id).lean();
    expect(after!.used_count).toBe(0);
  });
});
