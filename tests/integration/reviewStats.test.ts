import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import reviewModel from "@/models/reviewModel";
import { getReviewStats } from "@/services/reviewStatsService";
import { makeProduct, makeUser } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** GET /api/admin/reviews/stats — สรุปช่วงปัจจุบัน + ช่วงก่อนหน้า (summary + แง่มุม) */

const aspect = (name: string, sentiment: "positive" | "negative") => ({
  aspect_id: new Types.ObjectId(),
  aspect_name_th: name,
  sentiment,
});

async function seed(
  rows: Array<{ at: string; rating: number; aspects?: ReturnType<typeof aspect>[] }>,
  product?: { _id: unknown },
) {
  const user = await makeUser();
  const target = product ?? (await makeProduct());
  // ข้าม validation/timestamps ของ mongoose เพื่อกำหนด created_at เอง
  await reviewModel.collection.insertMany(
    rows.map((r) => ({
      user_id: user._id,
      product_id: target._id,
      order_item_id: new Types.ObjectId(),
      rating: r.rating,
      aspect_feedback: r.aspects ?? [],
      selected_presets: [],
      deleted_at: null,
      created_at: new Date(r.at),
    })) as any[],
  );
}

describe("reviewStatsService.getReviewStats", () => {
  it("ส่ง previous + previous_aspects ของช่วงก่อนหน้า", async () => {
    await seed([
      // ช่วงก่อนหน้า (ก.ย.)
      { at: "2026-09-10T05:00:00Z", rating: 5, aspects: [aspect("รสชาติ", "positive")] },
      { at: "2026-09-12T05:00:00Z", rating: 2, aspects: [aspect("ความหวาน", "negative")] },
      // ช่วงปัจจุบัน (ต.ค.)
      { at: "2026-10-05T05:00:00Z", rating: 1, aspects: [aspect("ความหวาน", "negative")] },
      { at: "2026-10-06T05:00:00Z", rating: 2, aspects: [aspect("ความหวาน", "negative"), aspect("ราคา", "negative")] },
      { at: "2026-10-07T05:00:00Z", rating: 5 },
    ]);

    const s = await getReviewStats({
      since: new Date("2026-10-01T00:00:00+07:00"),
      until: new Date("2026-11-01T00:00:00+07:00"),
      bucket: "day",
      prevSince: new Date("2026-09-01T00:00:00+07:00"),
      prevUntil: new Date("2026-10-01T00:00:00+07:00"),
    });

    expect(s.summary).toMatchObject({ total: 3, negative: 2 });
    expect(s.previous).toMatchObject({ total: 2, negative: 1 });
    expect(s.aspects.find((a) => a.name === "ความหวาน")).toMatchObject({ negative: 2 });
    expect(s.previous_aspects).toEqual(
      expect.arrayContaining([
        { name: "รสชาติ", positive: 1, negative: 0 },
        { name: "ความหวาน", positive: 0, negative: 1 },
      ]),
    );
    expect(s.previous_aspects).toHaveLength(2);
  });

  it("products = ตารางรายสินค้า (ช่วงก่อนหน้า + หัวข้อที่ถูกติมากสุด) · product_id กรองทุกส่วน", async () => {
    const cake = await makeProduct({ product_name_th: "เค้กส้ม" });
    const bread = await makeProduct({ product_name_th: "ขนมปังเนย" });
    await seed(
      [
        { at: "2026-08-10T05:00:00Z", rating: 5 },
        { at: "2026-08-11T05:00:00Z", rating: 4 },
        { at: "2026-09-05T05:00:00Z", rating: 2, aspects: [aspect("หวานไป", "negative"), aspect("ราคา", "negative")] },
        { at: "2026-09-06T05:00:00Z", rating: 1, aspects: [aspect("หวานไป", "negative")] },
        { at: "2026-09-07T05:00:00Z", rating: 4 },
      ],
      cake,
    );
    await seed([{ at: "2026-09-08T05:00:00Z", rating: 5 }], bread);

    const range = {
      since: new Date("2026-09-01T00:00:00+07:00"),
      until: new Date("2026-10-01T00:00:00+07:00"),
      bucket: "day" as const,
      prevSince: new Date("2026-08-01T00:00:00+07:00"),
      prevUntil: new Date("2026-09-01T00:00:00+07:00"),
    };
    const all = await getReviewStats(range);
    const row = all.products.find((p) => p.id === String(cake._id));
    expect(row).toMatchObject({
      name: "เค้กส้ม",
      count: 3,
      avg: 2.33,
      negative: 2,
      prev_count: 2,
      prev_avg: 4.5,
      top_issue: { name: "หวานไป", count: 2 },
    });
    expect(all.products.find((p) => p.id === String(bread._id))).toMatchObject({ count: 1, prev_count: 0, prev_avg: null, top_issue: null });

    const one = await getReviewStats({ ...range, productId: String(bread._id) });
    expect(one.summary.total).toBe(1);
    expect(one.previous?.total).toBe(0);
    expect(one.products.map((p) => p.id)).toEqual([String(bread._id)]);
  });

  it("ไม่ส่งช่วงก่อนหน้า = previous / previous_aspects เป็น null", async () => {
    const s = await getReviewStats({
      since: new Date("2026-10-01T00:00:00+07:00"),
      until: new Date("2026-11-01T00:00:00+07:00"),
      bucket: "day",
    });
    expect(s.previous).toBeNull();
    expect(s.previous_aspects).toBeNull();
  });
});
