/**
 * sentimentService — ผลวิเคราะห์ความรู้สึกจากรีวิว (SentimentResults) + ข้อมูลตั้งต้นของโมเดล NLP
 *
 * โครง:
 *  - Aspects        : แง่มุมที่วิเคราะห์ (รสชาติ / บริการ / ความสด ...) — CRUD โดยแอดมิน
 *  - SemanticTerms  : คำ/คำพ้อง ที่ map เข้าแต่ละ aspect — CRUD โดยแอดมิน (พจนานุกรมของ NLP)
 *  - SentimentResults: ผลที่ pipeline NLP เขียนกลับมา (1 review มีได้หลาย aspect)
 *
 * ตัว pipeline NLP ภายนอกเรียก recordSentimentResults() เพื่อบันทึกผล + ตั้ง review.is_analyzed = true
 */
import { Types } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { createCrudService } from "../lib/crudService";
import aspectModel from "../models/aspectModel";
import semanticTermModel from "../models/semanticTermModel";
import sentimentResultModel from "../models/sentimentResultModel";
import reviewModel from "../models/reviewModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SENTIMENT_LABELS = ["Positive", "Negative", "Neutral"] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

// ── Aspects (CRUD ตรง ๆ) ───────────────────────────────────
export const aspectService = createCrudService(aspectModel as any, {
  label: "แง่มุมการวิเคราะห์",
  searchFields: ["aspect_name_th", "aspect_name_eng"],
  createFields: ["aspect_name_th", "aspect_name_eng", "aspect_desc"],
});

// ── SemanticTerms (CRUD + validate aspect_id) ──────────────
const semanticBase = createCrudService(semanticTermModel as any, {
  label: "คำสำหรับวิเคราะห์",
  searchFields: ["term"],
  createFields: ["term", "synonyms", "aspect_id", "product_ids"],
  populate: [{ path: "aspect_id", select: "aspect_name_th aspect_name_eng" }],
});

export const semanticTermService = {
  ...semanticBase,
  async create(input: Record<string, any>) {
    if (!input.term) throw badRequest("กรุณาระบุ term");
    if (!input.aspect_id) throw badRequest("กรุณาระบุ aspect_id");
    await assertRefExists(aspectModel, input.aspect_id, "แง่มุม", "aspect_id");
    return semanticBase.create(input);
  },
  async update(id: string, input: Record<string, any>) {
    if (input.aspect_id) await assertRefExists(aspectModel, input.aspect_id, "แง่มุม", "aspect_id");
    return semanticBase.update(id, input);
  },
};

// ── บันทึกผลวิเคราะห์ (จาก pipeline NLP) ────────────────────
export interface SentimentResultInput {
  aspect_id: string;
  sentiment_score: number;
  sentiment_label: SentimentLabel;
  sentiment_result?: string | null;
  extracted_aspects?: string[];
  model_version?: string | null;
}

export async function recordSentimentResults(
  reviewId: string,
  results: SentimentResultInput[]
) {
  await dbConnect();
  assertObjectId(reviewId, "review_id");
  if (!Array.isArray(results) || results.length === 0) {
    throw badRequest("results ต้องเป็น array ที่ไม่ว่าง");
  }

  const review = await reviewModel.findOne({ _id: reviewId, deleted_at: null });
  if (!review) throw notFound("ไม่พบรีวิวที่ระบุ");

  for (const r of results) {
    assertObjectId(r.aspect_id, "aspect_id");
    if (!SENTIMENT_LABELS.includes(r.sentiment_label)) {
      throw badRequest(`sentiment_label ต้องเป็นหนึ่งใน: ${SENTIMENT_LABELS.join(", ")}`);
    }
  }

  // เขียนทับผลเดิมของรีวิวนี้
  await sentimentResultModel.updateMany(
    { review_id: reviewId, deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  const docs = await sentimentResultModel.insertMany(
    results.map((r) => ({
      review_id: reviewId,
      aspect_id: r.aspect_id,
      sentiment_score: r.sentiment_score,
      sentiment_label: r.sentiment_label,
      sentiment_result: r.sentiment_result ?? null,
      extracted_aspects: r.extracted_aspects ?? [],
      model_version: r.model_version ?? null,
    }))
  );

  review.is_analyzed = true;
  await review.save();

  return { review_id: reviewId, count: docs.length };
}

// ── อ่านผลวิเคราะห์ของรีวิว ─────────────────────────────────
export async function getReviewSentiment(reviewId: string) {
  await dbConnect();
  assertObjectId(reviewId, "review_id");
  const items = await sentimentResultModel
    .find({ review_id: reviewId, deleted_at: null })
    .populate("aspect_id", "aspect_name_th aspect_name_eng")
    .lean();
  return { review_id: reviewId, results: items };
}

// ── สรุปความรู้สึกรายแง่มุมของสินค้า ──────────────────────────
export async function getProductAspectSummary(productId: string) {
  await dbConnect();
  assertObjectId(productId, "product_id");

  const rows = await sentimentResultModel.aggregate([
    { $match: { deleted_at: null } },
    {
      $lookup: {
        from: reviewModel.collection.name,
        localField: "review_id",
        foreignField: "_id",
        as: "review",
      },
    },
    { $unwind: "$review" },
    {
      $match: {
        "review.product_id": new Types.ObjectId(productId),
        "review.deleted_at": null,
        "review.is_visible": true,
      },
    },
    {
      $group: {
        _id: "$aspect_id",
        total: { $sum: 1 },
        positive: { $sum: { $cond: [{ $eq: ["$sentiment_label", "Positive"] }, 1, 0] } },
        negative: { $sum: { $cond: [{ $eq: ["$sentiment_label", "Negative"] }, 1, 0] } },
        neutral: { $sum: { $cond: [{ $eq: ["$sentiment_label", "Neutral"] }, 1, 0] } },
        avg_score: { $avg: { $toDouble: "$sentiment_score" } },
      },
    },
  ]);

  const aspectIds = rows.map((r) => r._id);
  const aspects = await aspectModel
    .find({ _id: { $in: aspectIds } })
    .select("aspect_name_th aspect_name_eng")
    .lean<any[]>();
  const aspectById = new Map(aspects.map((a) => [String(a._id), a]));

  return {
    product_id: productId,
    aspects: rows.map((r) => ({
      aspect_id: String(r._id),
      aspect: aspectById.get(String(r._id)) ?? null,
      total: r.total,
      positive: r.positive,
      negative: r.negative,
      neutral: r.neutral,
      avg_score: r.avg_score == null ? null : Math.round(r.avg_score * 1000) / 1000,
    })),
  };
}
