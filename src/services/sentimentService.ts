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
import { badRequest, conflict, notFound } from "../lib/httpError";
import { resolveAspectIconKey } from "../lib/aspectIcons";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { createCrudService } from "../lib/crudService";
import aspectModel from "../models/aspectModel";
import semanticTermModel from "../models/semanticTermModel";
import sentimentResultModel from "../models/sentimentResultModel";
import { VISIBLE_REVIEW } from "../lib/reviewVisibility";
import reviewModel from "../models/reviewModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SENTIMENT_LABELS = ["Positive", "Negative", "Neutral"] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

// ── Aspects ────────────────────────────────────────────────
// ใช้ทั้ง NLP และฟอร์มรีวิว "ชอบ / ควรปรับปรุง" (customer-backend-merge.md §8.20):
// ชุดเริ่มต้น 4 ด้าน seed ครั้งแรก · ชื่อไทยห้ามซ้ำ · สูงสุด 20 · เพิ่มใหม่ต่อท้ายลำดับ · แก้ชื่อไทย → อัปเดตชื่อในรีวิวเดิมด้วย
const MAX_ASPECTS = 20;
const DEFAULT_ASPECTS = [
  { aspect_name_th: "ราคา", aspect_name_eng: "Price", placeholder_text: "เช่น คุ้มค่ามาก, ราคาเหมาะสมกับปริมาณ" },
  { aspect_name_th: "รสชาติ", aspect_name_eng: "Taste", placeholder_text: "เช่น หวานกำลังดี, สดใหม่มาก" },
  { aspect_name_th: "บรรจุภัณฑ์", aspect_name_eng: "Packaging", placeholder_text: "เช่น กล่องแน่นหนา ขนมไม่เสียหาย" },
  { aspect_name_th: "อื่นๆ", aspect_name_eng: "Others", placeholder_text: "เช่น บริการดี จัดส่งรวดเร็ว" },
];

/** ยังไม่เคยมีแง่มุมเลย (นับรวมที่ลบแล้ว) → สร้างชุดเริ่มต้น — ลบหมดแล้วชุดเริ่มต้นจะไม่โผล่กลับมาเอง */
export async function ensureDefaultAspects(): Promise<void> {
  await dbConnect();
  if ((await aspectModel.countDocuments({})) > 0) return;
  await aspectModel.insertMany(DEFAULT_ASPECTS.map((a, i) => ({ ...a, display_order: i, is_active: true })));
}

async function assertUniqueAspectName(nameTh: string, excludeId?: string) {
  const others = await aspectModel
    .find({ deleted_at: null, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select("aspect_name_th")
    .lean<Array<{ aspect_name_th: string }>>();
  if (others.some((a) => String(a.aspect_name_th).trim().toLowerCase() === nameTh.trim().toLowerCase())) {
    throw conflict(`มีแง่มุม "${nameTh.trim()}" อยู่แล้ว`);
  }
}

const ASPECT_FIELDS = ["aspect_name_th", "aspect_name_eng", "aspect_desc", "is_active", "icon", "placeholder_text"] as const;
const aspectBase = createCrudService(aspectModel as any, {
  label: "แง่มุมการวิเคราะห์",
  searchFields: ["aspect_name_th", "aspect_name_eng"],
  createFields: [...ASPECT_FIELDS, "display_order"],
  updateFields: ASPECT_FIELDS,
});

export const aspectService = {
  ...aspectBase,
  async list(args: Parameters<typeof aspectBase.list>[0]) {
    await ensureDefaultAspects();
    return aspectBase.list(args);
  },
  async create(input: Record<string, any>) {
    await ensureDefaultAspects();
    const active = await aspectModel.find({ deleted_at: null }).select("display_order").lean<Array<{ display_order?: number }>>();
    if (active.length >= MAX_ASPECTS) throw badRequest(`เพิ่มแง่มุมได้สูงสุด ${MAX_ASPECTS} แง่มุม`);
    await assertUniqueAspectName(String(input.aspect_name_th ?? ""));
    const nextOrder = active.reduce((max, a) => Math.max(max, Number(a.display_order) || 0), -1) + 1;
    return aspectBase.create({ ...input, aspect_name_eng: input.aspect_name_eng || input.aspect_name_th, display_order: nextOrder });
  },
  async update(id: string, input: Record<string, any>) {
    if (input.aspect_name_th !== undefined) await assertUniqueAspectName(String(input.aspect_name_th), id);
    const doc = await aspectBase.update(id, input);
    if (input.aspect_name_th !== undefined) {
      await reviewModel.updateMany(
        { "aspect_feedback.aspect_id": doc._id },
        { $set: { "aspect_feedback.$[f].aspect_name_th": doc.aspect_name_th } },
        { arrayFilters: [{ "f.aspect_id": doc._id }] }
      );
    }
    return doc;
  },
};

/** เรียงลำดับใหม่ทั้งชุด (ตามลำดับใน orderedIds · id ที่ไม่มี/ถูกลบข้าม) → แง่มุมทั้งหมดตามลำดับใหม่ */
export async function reorderAspects(orderedIds: unknown) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) throw badRequest("กรุณาส่ง orderedIds");
  if (orderedIds.length > 100) throw badRequest("orderedIds ยาวเกินไป");
  await dbConnect();
  const ops = orderedIds
    .map(String)
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id, index) => ({ updateOne: { filter: { _id: id, deleted_at: null }, update: { $set: { display_order: index } } } }));
  if (ops.length > 0) await aspectModel.bulkWrite(ops);
  return aspectModel.find({ deleted_at: null }).sort({ display_order: 1, created_at: 1 }).lean();
}

/** แง่มุมที่เปิดใช้งานสำหรับฟอร์มรีวิว (สาธารณะ) — ไอคอนแปลงเป็น key ที่หน้าเว็บรู้จักเสมอ */
export async function listActiveAspects() {
  await ensureDefaultAspects();
  const aspects = await aspectModel
    .find({ deleted_at: null, is_active: { $ne: false } })
    .sort({ display_order: 1, created_at: 1 })
    .select("aspect_name_th aspect_name_eng placeholder_text icon")
    .lean<any[]>();
  return aspects.map((a) => ({
    _id: String(a._id),
    aspect_name_th: a.aspect_name_th,
    aspect_name_eng: a.aspect_name_eng,
    placeholder_text: a.placeholder_text ?? null,
    icon: resolveAspectIconKey(a.icon, a.aspect_name_eng),
  }));
}

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

  // หารีวิวที่แสดงของสินค้านี้ก่อน (index product_id) แล้วค่อยดึงผลวิเคราะห์ของรีวิวเหล่านั้น (index review_id) —
  // เดิม $lookup จาก SentimentResults ทั้ง collection แล้วค่อยกรองสินค้า (ช้าลงตามผลวิเคราะห์ทั้งร้าน · BACKLOG5 G3)
  // รีวิวที่แสดงใช้เงื่อนไขกลาง VISIBLE_REVIEW (รวม status — เดิมดูแค่ is_visible · BACKLOG5 G4)
  const reviewIds = await reviewModel.distinct("_id", { product_id: new Types.ObjectId(productId), ...VISIBLE_REVIEW });
  const rows = reviewIds.length === 0 ? [] : await sentimentResultModel.aggregate([
    { $match: { deleted_at: null, review_id: { $in: reviewIds } } },
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
