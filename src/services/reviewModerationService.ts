/**
 * reviewModerationService — จัดการรีวิวในหลังร้าน (ย้ายมาจากฝั่งลูกค้า Owner/reviewController · customer-backend-merge.md §8.20)
 *
 *   - รายการรีวิว: กรอง/ค้นหา/เรียง/แบ่งหน้า + สรุปของชุดที่กรอง · เห็นทุกสถานะ (รวมที่ซ่อน) และข้อมูลภายใน
 *   - จัดการทีละรีวิว: สถานะ (ซ่อน/แสดง) · ปักหมุด · ตอบกลับ (ลูกค้าเห็น) · แท็ก/โน้ตภายใน · อ่านแล้ว
 *   - ทำหลายรายการ: อ่านแล้ว / ยังไม่อ่าน
 *   - ตัวเลือกตัวกรอง: สินค้า/หมวดที่มีรีวิว + คำตอบเก่าไว้แนะนำตอนพิมพ์
 * สิทธิ์เมนู "reports" (ผู้ใช้เลือก 2026-10-05) — ตรวจที่ route
 */
import { Types, type PipelineStage } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import reviewModel from "../models/reviewModel";
import productModel from "../models/productModel";
import productCategoryModel from "../models/productCategoryModel";
import sentimentResultModel from "../models/sentimentResultModel";
import aspectModel from "../models/aspectModel";
// model ที่ populate ผ่าน ref — ต้องลงทะเบียนกับ mongoose ก่อน
import "../models/userModel";
import "../models/orderItemModel";
import "../models/orderModel";
import "../models/preorderItemModel";
import "../models/preorderModel";
import { REVIEW_STATUSES, recomputeProductRating, statusPatch, type ReviewStatus } from "./reviewService";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_NOTE_LENGTH = 2000;
const MAX_REPLY_LENGTH = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_BULK_IDS = 200;
const REPLY_SUGGESTION_LIMIT = 50;

const oid = (id: string) => new Types.ObjectId(id);
/** ร้านยังไม่ตอบ (ไม่มี shop_reply หรือข้อความว่าง) */
const UNREPLIED = { $or: [{ shop_reply: null }, { "shop_reply.text": { $in: [null, ""] } }] };
const NO_MEDIA = { "image.0": { $exists: false }, video: { $in: [null, ""] } };
const HAS_MEDIA = { $or: [{ "image.0": { $exists: true } }, { video: { $nin: [null, ""] } }] };
/** รีวิวเก่า (ฝั่งลูกค้ายุคประโยคสำเร็จรูป) ที่มีประโยคระดับ ≠ 3 — ระบบอนุมานหัวข้อจากระดับคะแนน */
const HAS_INFERRED_PRESET = { selected_presets: { $elemMatch: { rating_level: { $ne: 3 } } } };

export type ReviewSort = "newest" | "oldest" | "lowest" | "highest" | "needs_reply";
const SORTS: ReviewSort[] = ["newest", "oldest", "lowest", "highest", "needs_reply"];
const SORT_STAGE: Record<ReviewSort, Record<string, 1 | -1>> = {
  newest: { created_at: -1 },
  oldest: { created_at: 1 },
  lowest: { rating: 1, created_at: -1 },
  highest: { rating: -1, created_at: -1 },
  // ควรตอบก่อน: รีวิวลบที่ยังไม่ตอบ → ยังไม่ตอบอื่น ๆ → ตอบแล้ว (ในกลุ่มเดียวกัน ดาวน้อยก่อน แล้วใหม่ก่อน)
  needs_reply: { _reply_priority: 1, rating: 1, created_at: -1 },
};

const bad = (name: string) => badRequest(`ค่า ${name} ไม่ถูกต้อง`);

function star(name: string, v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw bad(name);
  return n;
}

function flag(name: string, v: string | null): boolean | null {
  if (v === null || v === "") return null;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  throw bad(name);
}

/**
 * เงื่อนไข $match จาก query (ใช้กับ aggregate จึงแปลง id เป็น ObjectId เอง) — ผิด = 400
 * product_id · category_id · status · rating | rating_min / rating_max · sentiment_group (positive|neutral|negative) ·
 * aspect_id (+ sentiment positive|negative) · replied · read · has_media (1|0) · since / until (ISO) ·
 * source (customer|inferred|model|none) · order_kind (order|preorder) · q (ค้นข้อความ) · user_id · is_visible · is_analyzed
 */
export async function buildReviewMatch(sp: URLSearchParams): Promise<Record<string, unknown>> {
  const and: Record<string, unknown>[] = [{ deleted_at: null }];

  const status = sp.get("status");
  if (status) {
    if (!REVIEW_STATUSES.includes(status as ReviewStatus)) throw bad("status");
    // เอกสารเก่าที่ไม่มี status นับเป็น approved/hidden ตาม is_visible
    if (status === "approved") and.push({ $or: [{ status: "approved" }, { status: null, is_visible: { $ne: false } }] });
    else if (status === "hidden") and.push({ $or: [{ status: "hidden" }, { status: null, is_visible: false }] });
    else and.push({ status });
  }

  for (const key of ["product_id", "user_id"] as const) {
    const v = sp.get(key);
    if (!v) continue;
    if (!Types.ObjectId.isValid(v)) throw bad(key);
    and.push({ [key]: oid(v) });
  }

  // หมวดหมู่ → สินค้าในหมวด (รวมสินค้าที่ถูกลบ เพราะรีวิวเก่ายังอยู่)
  const categoryId = sp.get("category_id");
  if (categoryId) {
    if (!Types.ObjectId.isValid(categoryId)) throw bad("category_id");
    const ids = await productModel.find({ category_id: categoryId }).distinct("_id");
    and.push({ product_id: { $in: ids } });
  }

  const rating = star("rating", sp.get("rating"));
  const rMin = star("rating_min", sp.get("rating_min"));
  const rMax = star("rating_max", sp.get("rating_max"));
  if (rating !== null) and.push({ rating });
  if (rMin !== null || rMax !== null) {
    and.push({ rating: { ...(rMin !== null ? { $gte: rMin } : {}), ...(rMax !== null ? { $lte: rMax } : {}) } });
  }

  // ความรู้สึกจากดาว: บวก 4-5 · กลาง 3 · ลบ 1-2
  const group = sp.get("sentiment_group");
  if (group) {
    if (group === "positive") and.push({ rating: { $gte: 4 } });
    else if (group === "neutral") and.push({ rating: 3 });
    else if (group === "negative") and.push({ rating: { $lte: 2 } });
    else throw bad("sentiment_group");
  }

  // หัวข้อ (+ ชอบ/ติ): รีวิวใหม่ aspect_feedback · รีวิวเก่า ประโยคสำเร็จรูป (ระดับ ≥4 = ชอบ, ≤2 = ควรปรับปรุง)
  const aspectId = sp.get("aspect_id");
  const sentiment = sp.get("sentiment");
  if (aspectId) {
    if (!Types.ObjectId.isValid(aspectId)) throw bad("aspect_id");
    if (sentiment && sentiment !== "positive" && sentiment !== "negative") throw bad("sentiment");
    const legacyLevel = sentiment === "positive" ? { $gte: 4 } : sentiment === "negative" ? { $lte: 2 } : undefined;
    and.push({
      $or: [
        { aspect_feedback: { $elemMatch: { aspect_id: oid(aspectId), ...(sentiment ? { sentiment } : {}) } } },
        { selected_presets: { $elemMatch: { aspect_id: oid(aspectId), ...(legacyLevel ? { rating_level: legacyLevel } : {}) } } },
      ],
    });
  }

  const replied = flag("replied", sp.get("replied"));
  if (replied === true) and.push({ "shop_reply.text": { $nin: [null, ""] } });
  else if (replied === false) and.push(UNREPLIED);

  const read = flag("read", sp.get("read"));
  if (read === true) and.push({ read_at: { $ne: null } });
  else if (read === false) and.push({ read_at: null });

  const media = flag("has_media", sp.get("has_media"));
  if (media === true) and.push(HAS_MEDIA);
  else if (media === false) and.push(NO_MEDIA);

  const visible = flag("is_visible", sp.get("is_visible"));
  if (visible !== null) and.push({ is_visible: visible });
  const analyzed = flag("is_analyzed", sp.get("is_analyzed"));
  if (analyzed !== null) and.push({ is_analyzed: analyzed });

  const range: Record<string, Date> = {};
  for (const [key, op] of [["since", "$gte"], ["until", "$lt"]] as const) {
    const v = sp.get(key);
    if (!v) continue;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw bad(key);
    range[op] = d;
  }
  if (Object.keys(range).length > 0) and.push({ created_at: range });

  // ที่มาของผลวิเคราะห์หัวข้อ: ลูกค้าเลือกเอง / อนุมานจากประโยคสำเร็จรูป / โมเดล NLP / ไม่มีข้อมูลหัวข้อ
  const source = sp.get("source");
  if (source) {
    if (!["customer", "inferred", "model", "none"].includes(source)) throw bad("source");
    const hasCustomer = { "aspect_feedback.0": { $exists: true } };
    const noCustomer = { "aspect_feedback.0": { $exists: false } };
    if (source === "customer") and.push(hasCustomer);
    else {
      const modelIds = await sentimentResultModel.distinct("review_id", { deleted_at: null });
      if (source === "model") and.push(noCustomer, { _id: { $in: modelIds } });
      else if (source === "inferred") and.push(noCustomer, HAS_INFERRED_PRESET, { _id: { $nin: modelIds } });
      else and.push(noCustomer, { selected_presets: { $not: { $elemMatch: { rating_level: { $ne: 3 } } } } }, { _id: { $nin: modelIds } });
    }
  }

  const orderKind = sp.get("order_kind");
  if (orderKind === "preorder") and.push({ preorder_order_item_id: { $ne: null } });
  else if (orderKind === "order") and.push({ preorder_order_item_id: null });
  else if (orderKind) throw bad("order_kind");

  const q = sp.get("q")?.trim();
  if (q) and.push({ review_text: { $regex: escapeRegExp(q.slice(0, 200)), $options: "i" } });

  return and.length === 1 ? and[0] : { $and: and };
}

/**
 * รายการรีวิวของหลังร้าน → { items, meta, summary? }
 * sort = newest (ค่าเริ่มต้น) | oldest | lowest | highest | needs_reply · summary=1 → { count, avg_rating, negative_rate, unreplied_negative }
 * ทุกรายการมี analysis_source: customer | model | inferred | null · order_no / preorder_no ผ่าน populate
 */
export async function listAdminReviews(sp: URLSearchParams, pagination: Pagination) {
  await dbConnect();
  const match = await buildReviewMatch(sp);
  const sort = (sp.get("sort") ?? "newest") as ReviewSort;
  if (!SORTS.includes(sort)) throw bad("sort");

  const pipeline: PipelineStage[] = [{ $match: match }];
  if (sort === "needs_reply") {
    const unreplied = { $eq: [{ $ifNull: ["$shop_reply.text", ""] }, ""] };
    pipeline.push({
      $addFields: {
        _reply_priority: { $cond: [{ $and: [unreplied, { $lte: ["$rating", 2] }] }, 0, { $cond: [unreplied, 1, 2] }] },
      },
    });
  }
  pipeline.push({ $sort: SORT_STAGE[sort] }, { $skip: pagination.skip }, { $limit: pagination.limit }, { $project: { _reply_priority: 0 } });

  const wantSummary = sp.get("summary") === "1";
  const [raw, total, summaryRows] = await Promise.all([
    reviewModel.aggregate<Record<string, any>>(pipeline),
    reviewModel.countDocuments(match),
    wantSummary
      ? reviewModel.aggregate<{ count: number; avg_rating: number; negative: number; unreplied_negative: number }>([
          { $match: match },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              avg_rating: { $avg: "$rating" },
              negative: { $sum: { $cond: [{ $lte: ["$rating", 2] }, 1, 0] } },
              unreplied_negative: {
                $sum: { $cond: [{ $and: [{ $lte: ["$rating", 2] }, { $eq: [{ $ifNull: ["$shop_reply.text", ""] }, ""] }] }, 1, 0] },
              },
            },
          },
        ])
      : Promise.resolve([]),
  ]);

  const items = (await reviewModel.populate(raw, [
    { path: "user_id", select: "user_fullname user_img" },
    { path: "product_id", select: "product_name_th product_name_eng product_img" },
    { path: "order_item_id", select: "order_id", populate: { path: "order_id", select: "order_no" } },
    { path: "preorder_order_item_id", select: "preorder_id", populate: { path: "preorder_id", select: "preorder_no" } },
  ])) as Record<string, any>[];

  // ประโยคสำเร็จรูปของรีวิวเก่า (ไม่อยู่ใน schema) → เติมชื่อหัวข้อเอง
  const presetAspectIds = new Set<string>();
  for (const r of items) for (const p of r.selected_presets ?? []) if (p.aspect_id) presetAspectIds.add(String(p.aspect_id));
  const aspectById = new Map<string, { _id: string; aspect_name_th: string }>();
  if (presetAspectIds.size > 0) {
    const aspects = await aspectModel.find({ _id: { $in: [...presetAspectIds] } }).select("aspect_name_th").lean<any[]>();
    for (const a of aspects) aspectById.set(String(a._id), { _id: String(a._id), aspect_name_th: a.aspect_name_th });
  }
  const modelIds = new Set(
    items.length
      ? (await sentimentResultModel.distinct("review_id", { review_id: { $in: items.map((r) => r._id) }, deleted_at: null })).map(String)
      : []
  );

  for (const r of items) {
    const presets = r.selected_presets as Array<{ aspect_id?: unknown; rating_level?: number }> | undefined;
    if (presets?.length) {
      r.selected_presets = presets.map((p) => ({ ...p, aspect_id: p.aspect_id ? aspectById.get(String(p.aspect_id)) ?? String(p.aspect_id) : null }));
    }
    const product = r.product_id as { product_img?: unknown } | null;
    if (product && Array.isArray(product.product_img)) {
      product.product_img = product.product_img.find((s) => typeof s === "string" && s.trim()) ?? null;
    }
    r.status = r.status ?? (r.is_visible === false ? "hidden" : "approved");
    r.analysis_source = r.aspect_feedback?.length
      ? "customer"
      : modelIds.has(String(r._id))
        ? "model"
        : presets?.some((p) => (p.rating_level ?? 3) !== 3)
          ? "inferred"
          : null;
  }

  const s = summaryRows[0];
  return {
    items,
    meta: buildMeta(total, pagination),
    ...(wantSummary
      ? {
          summary: {
            count: s?.count ?? 0,
            avg_rating: s ? s.avg_rating : null,
            negative_rate: s && s.count > 0 ? s.negative / s.count : null,
            unreplied_negative: s?.unreplied_negative ?? 0,
          },
        }
      : {}),
  };
}

export interface ModerateInput {
  status?: unknown;
  is_pinned?: unknown;
  shop_reply_text?: unknown;
  internal_tags?: unknown;
  internal_note_text?: unknown;
  read?: unknown;
}

/**
 * จัดการรีวิว 1 รายการ — ส่งมาบางส่วนหรือรวมกันก็ได้ · ไม่มีอะไรให้แก้ = 400 · ถูกลบแล้ว = 404
 *   status · is_pinned · shop_reply_text (ตอบกลับ — นับว่าอ่านแล้ว · ว่าง = ลบคำตอบ) ·
 *   internal_tags · internal_note_text (ว่าง = ลบโน้ต) · read
 */
export async function moderateReview(id: string, input: ModerateInput | null, actorId: string) {
  await dbConnect();
  assertObjectId(id);
  if (!input || typeof input !== "object") throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  const set: Record<string, unknown> = {};
  const now = new Date();
  const actor = new Types.ObjectId(actorId);

  if (input.status !== undefined) {
    if (!REVIEW_STATUSES.includes(input.status as ReviewStatus)) throw badRequest("status ต้องเป็น pending | approved | hidden");
    Object.assign(set, statusPatch(input.status as ReviewStatus));
  }
  if (input.is_pinned !== undefined) {
    if (typeof input.is_pinned !== "boolean") throw badRequest("is_pinned ต้องเป็น true หรือ false");
    set.is_pinned = input.is_pinned;
    set.pinned_at = input.is_pinned ? now : null;
  }
  if (input.shop_reply_text !== undefined) {
    if (typeof input.shop_reply_text !== "string") throw badRequest("shop_reply_text ต้องเป็นข้อความ");
    const text = input.shop_reply_text.trim();
    if (text.length > MAX_REPLY_LENGTH) throw badRequest(`คำตอบยาวได้ไม่เกิน ${MAX_REPLY_LENGTH} ตัวอักษร`);
    set.shop_reply = text ? { text, replied_at: now, replied_by: actor } : null;
    set.read_at = now;
    set.read_by = actor;
  }
  if (input.internal_tags !== undefined) {
    if (!Array.isArray(input.internal_tags)) throw badRequest("internal_tags ต้องเป็นรายการ");
    const tags = [...new Set(input.internal_tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))];
    if (tags.length > MAX_TAGS) throw badRequest(`แท็กได้ไม่เกิน ${MAX_TAGS} แท็ก`);
    if (tags.some((t) => t.length > MAX_TAG_LENGTH)) throw badRequest(`แท็กยาวได้ไม่เกิน ${MAX_TAG_LENGTH} ตัวอักษร`);
    set.internal_tags = tags;
  }
  if (input.internal_note_text !== undefined) {
    if (typeof input.internal_note_text !== "string") throw badRequest("internal_note_text ต้องเป็นข้อความ");
    const text = input.internal_note_text.trim();
    if (text.length > MAX_NOTE_LENGTH) throw badRequest(`บันทึกภายในยาวได้ไม่เกิน ${MAX_NOTE_LENGTH} ตัวอักษร`);
    set.internal_note = text ? { text, updated_at: now, updated_by: actor } : null;
  }
  if (input.read !== undefined && input.shop_reply_text === undefined) {
    if (typeof input.read !== "boolean") throw badRequest("read ต้องเป็น true หรือ false");
    set.read_at = input.read ? now : null;
    set.read_by = input.read ? actor : null;
  }
  if (Object.keys(set).length === 0) throw badRequest("ไม่มีข้อมูลที่จะแก้ไข");

  const doc = await reviewModel
    .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: set }, { returnDocument: "after", runValidators: true })
    .lean<any>();
  if (!doc) throw notFound("ไม่พบรีวิวที่ระบุ");
  if ("status" in set) await recomputeProductRating(String(doc.product_id));
  return doc;
}

/** ทำเครื่องหมายอ่านแล้ว/ยังไม่อ่านหลายรายการ → { matched, modified } */
export async function bulkMarkRead(input: { ids?: unknown; action?: unknown } | null, actorId: string) {
  await dbConnect();
  const ids = input?.ids;
  if (!Array.isArray(ids) || ids.length === 0) throw badRequest("กรุณาเลือกรีวิวอย่างน้อย 1 รายการ");
  if (ids.length > MAX_BULK_IDS) throw badRequest(`เลือกได้ครั้งละไม่เกิน ${MAX_BULK_IDS} รายการ`);
  if (ids.some((id) => typeof id !== "string" || !Types.ObjectId.isValid(id))) throw badRequest("รายการรีวิวไม่ถูกต้อง");
  if (input?.action !== "mark_read" && input?.action !== "mark_unread") throw badRequest("action ต้องเป็น mark_read | mark_unread");
  const read = input.action === "mark_read";
  const result = await reviewModel.updateMany(
    { _id: { $in: ids }, deleted_at: null },
    { $set: { read_at: read ? new Date() : null, read_by: read ? new Types.ObjectId(actorId) : null } }
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/** คำตอบเก่าของร้าน — แนะนำตอนพิมพ์ตอบกลับ เรียงจากที่ใช้บ่อย/ใช้ล่าสุด */
export async function getReplySuggestions() {
  const rows = await reviewModel.aggregate<{ text: string; used_count: number; rating_avg: number }>([
    { $match: { deleted_at: null, "shop_reply.text": { $nin: [null, ""] } } },
    {
      $group: {
        _id: { $trim: { input: "$shop_reply.text" } },
        used_count: { $sum: 1 },
        last_used: { $max: "$shop_reply.replied_at" },
        rating_avg: { $avg: "$rating" },
      },
    },
    { $sort: { used_count: -1, last_used: -1 } },
    { $limit: REPLY_SUGGESTION_LIMIT },
    { $project: { _id: 0, text: "$_id", used_count: 1, rating_avg: 1 } },
  ]);
  return rows.map((r) => ({ text: r.text, used_count: r.used_count, rating_avg: Math.round(r.rating_avg * 10) / 10 }));
}

/** ตัวเลือกตัวกรอง: สินค้าและหมวดที่มีรีวิว (รวมที่ถูกลบ) + คำตอบเก่า */
export async function getFilterOptions() {
  await dbConnect();
  const [products, categories, replySuggestions] = await Promise.all([
    reviewModel.aggregate([
      { $match: { deleted_at: null } },
      { $group: { _id: "$product_id", review_count: { $sum: 1 }, avg_rating: { $avg: "$rating" } } },
      { $lookup: { from: productModel.collection.name, localField: "_id", foreignField: "_id", as: "product" } },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          product_id: "$_id",
          product_name_th: { $ifNull: ["$product.product_name_th", "(สินค้าที่ถูกลบ)"] },
          is_deleted: { $ne: [{ $ifNull: ["$product.deleted_at", null] }, null] },
          review_count: 1,
          avg_rating: { $round: ["$avg_rating", 2] },
        },
      },
      { $sort: { product_name_th: 1 } },
    ]),
    reviewModel.aggregate([
      { $match: { deleted_at: null } },
      { $lookup: { from: productModel.collection.name, localField: "product_id", foreignField: "_id", as: "product" } },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
      { $group: { _id: "$product.category_id", review_count: { $sum: 1 }, avg_rating: { $avg: "$rating" } } },
      { $match: { _id: { $ne: null } } },
      { $lookup: { from: productCategoryModel.collection.name, localField: "_id", foreignField: "_id", as: "category" } },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          category_id: "$_id",
          category_name: { $ifNull: ["$category.product_category_name", "(หมวดที่ถูกลบ)"] },
          review_count: 1,
          avg_rating: { $round: ["$avg_rating", 2] },
        },
      },
      { $sort: { category_name: 1 } },
    ]),
    getReplySuggestions(),
  ]);
  return { products, categories, reply_suggestions: replySuggestions };
}
