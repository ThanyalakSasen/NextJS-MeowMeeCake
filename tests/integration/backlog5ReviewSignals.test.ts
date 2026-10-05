/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach } from "vitest";
import { Types } from "mongoose";
import reviewModel from "@/models/reviewModel";
import productModel from "@/models/productModel";
import sentimentResultModel from "@/models/sentimentResultModel";
import aspectModel from "@/models/aspectModel";
import * as sentimentService from "@/services/sentimentService";
import * as recommendationService from "@/services/recommendation/recommendationService";
import { makeProduct, makeIngredient, makeRecipe } from "./helpers";

/** docs/BACKLOG5.md PR A — G4 (รีวิวที่แสดงใช้ VISIBLE_REVIEW) · G3 (สรุปแง่มุมไม่ lookup ทั้ง collection) · G2 (สินค้ายอดนิยม) */

async function review(productId: unknown, over: Record<string, unknown> = {}) {
  // เขียนตรงลง collection (แบบที่ backend ฝั่งลูกค้าเขียน) — จำลองรีวิวที่ status กับ is_visible ไม่ตรงกัน
  const doc = {
    _id: new Types.ObjectId(),
    user_id: new Types.ObjectId(),
    product_id: productId,
    order_item_id: new Types.ObjectId(),
    rating: 5,
    is_visible: true,
    deleted_at: null,
    ...over,
  };
  await reviewModel.collection.insertOne(doc as any);
  return doc._id;
}

async function result(reviewId: unknown, aspectId: unknown, label: "Positive" | "Negative") {
  await sentimentResultModel.create({ review_id: reviewId, aspect_id: aspectId, sentiment_score: label === "Positive" ? 0.9 : -0.8, sentiment_label: label });
}

describe("G4 + G3 — สรุปแง่มุมรายสินค้า", () => {
  it("นับเฉพาะรีวิวที่แสดง: ไม่นับ status hidden/pending (แม้ is_visible ยัง true) · ไม่นับที่ลบ/ซ่อน · ไม่ปนสินค้าอื่น · เอกสารเก่าไม่มี status นับ", async () => {
    const p = await makeProduct();
    const other = await makeProduct();
    const aspect = await aspectModel.create({ aspect_name_th: "รสชาติ", aspect_name_eng: "Taste" });

    await result(await review(p._id, { status: "approved" }), aspect._id, "Positive");
    await result(await review(p._id), aspect._id, "Positive"); // เอกสารเก่าไม่มี status
    await result(await review(p._id, { status: "hidden" }), aspect._id, "Negative"); // ฝั่งลูกค้าซ่อนด้วย status อย่างเดียว
    await result(await review(p._id, { status: "pending" }), aspect._id, "Negative");
    await result(await review(p._id, { is_visible: false }), aspect._id, "Negative");
    await result(await review(p._id, { deleted_at: new Date() }), aspect._id, "Negative");
    await result(await review(other._id), aspect._id, "Negative");

    const summary = await sentimentService.getProductAspectSummary(String(p._id));
    expect(summary.aspects).toHaveLength(1);
    expect(summary.aspects[0]).toMatchObject({ total: 2, positive: 2, negative: 0 });
  });

  it("สินค้าที่ไม่มีรีวิว → ว่าง (ไม่ query ผลวิเคราะห์)", async () => {
    const p = await makeProduct();
    expect((await sentimentService.getProductAspectSummary(String(p._id))).aspects).toEqual([]);
  });
});

describe("G2 — สินค้ายอดนิยม (ไม่ล็อกอิน)", () => {
  const ORIGINAL_TTL = process.env.RECOMMENDATION_CACHE_TTL_MS;
  afterEach(() => {
    process.env.RECOMMENDATION_CACHE_TTL_MS = ORIGINAL_TTL;
    recommendationService.resetPopularCache();
  });

  it("10 อันดับตามคะแนน (DB เรียง/จำกัด) · ไม่รวมสินค้าที่ซ่อน/ลบ · ชื่อวัตถุดิบเฉพาะสินค้าที่ติดอันดับ", async () => {
    const made: any[] = [];
    for (let i = 0; i < 12; i++) made.push(await makeProduct({ avg_rating: (i % 5) + 0.5, review_count: i }));
    await productModel.updateOne({ _id: made[4]._id }, { $set: { avg_rating: 5, is_visible: false } });
    await productModel.updateOne({ _id: made[9]._id }, { $set: { avg_rating: 5, deleted_at: new Date() } });
    const top = made[2];
    await productModel.updateOne({ _id: top._id }, { $set: { avg_rating: 4.9 } });
    const flour = await makeIngredient({ ingredient_name: "แป้งเค้ก" });
    await makeRecipe(String(top._id), { ingredients: [{ ingredient_id: flour._id, quantity: 3, unit_id: new Types.ObjectId() }] });

    const { products } = await recommendationService.recommendedProducts(null);
    expect(products).toHaveLength(10);
    const ids = products.map((p) => String(p._id));
    expect(ids).not.toContain(String(made[4]._id));
    expect(ids).not.toContain(String(made[9]._id));
    expect(ids[0]).toBe(String(top._id));
    expect(products[0].ingredientNames).toEqual(["แป้งเค้ก"]);
    const ratings = products.map((p) => Number(p.avg_rating));
    expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
  });

  it("cache ตาม RECOMMENDATION_CACHE_TTL_MS · resetPopularCache ล้างได้", async () => {
    process.env.RECOMMENDATION_CACHE_TTL_MS = "60000";
    const p = await makeProduct({ avg_rating: 4 });
    const first = await recommendationService.recommendedProducts(null);
    expect(first.products.map((x) => String(x._id))).toEqual([String(p._id)]);

    const q = await makeProduct({ avg_rating: 5 });
    expect((await recommendationService.recommendedProducts(null)).products).toHaveLength(1); // ยังเป็นผลจาก cache

    recommendationService.resetPopularCache();
    const fresh = await recommendationService.recommendedProducts(null);
    expect(fresh.products.map((x) => String(x._id))).toEqual([String(q._id), String(p._id)]);
  });
});
