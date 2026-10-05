/**
 * reviewService — รีวิวสินค้า (Reviews)
 *
 * - รีวิวได้เฉพาะสินค้าที่ซื้อเองจาก **ออเดอร์ปกติหรือพรีออเดอร์** ที่ completed **และชำระเงินแล้ว**
 *   (ผู้ใช้เลือก 2026-10-05 · customer-backend-merge.md §8.20) · 1 รีวิวต่อ 1 รายการ
 * - รีวิวรวมหลายชิ้นในครั้งเดียว (order_item_ids / preorder_item_ids) — ชิ้นที่ผ่านบันทึก ชิ้นที่ไม่ผ่านคืนใน failed
 * - แง่มุมที่ลูกค้ากด "ชอบ" / "ควรปรับปรุง" (aspect_feedback) — เก็บเฉพาะแง่มุมที่เปิดใช้งานจริง ชื่อดึงจาก DB
 * - แสดงทันที (status approved) · ร้านซ่อนทีหลัง — status กับ is_visible เปลี่ยนคู่กันเสมอ (setReviewStatus)
 * - หน้าสาธารณะส่งเฉพาะ field ที่ลูกค้าควรเห็น (ไม่มีแท็ก/โน้ตภายใน) · ชื่อผู้รีวิวปิดบางส่วน · ปักหมุดขึ้นก่อน
 * - ทุกครั้งที่รีวิวที่แสดงอยู่เปลี่ยน (สร้าง/แก้ rating/ซ่อน/ลบ) คำนวณ avg_rating + review_count ใหม่ลง productModel
 */
import { Types } from "mongoose";
import dbConnect from "../lib/dbConnect";
import * as pointsService from "./pointsService";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { buildMeta, type Pagination } from "../lib/queryParams";
import { maskCustomerName } from "../lib/maskName";
import reviewModel from "../models/reviewModel";
import orderItemModel from "../models/orderItemModel";
import orderModel from "../models/orderModel";
import preorderItemModel from "../models/preorderItemModel";
import preorderModel from "../models/preorderModel";
import productModel from "../models/productModel";
import aspectModel from "../models/aspectModel";
import { round2 } from "../lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ReviewStatus = "pending" | "approved" | "hidden";
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["pending", "approved", "hidden"];

/** รีวิวที่ลูกค้าเห็น — เอกสารเก่าที่ไม่มี status นับเป็น approved (นิยามอยู่ที่ lib/reviewVisibility — ใช้ร่วมกับระบบแนะนำ/สรุปแง่มุม) */
export { VISIBLE_REVIEW } from "../lib/reviewVisibility";
import { VISIBLE_REVIEW } from "../lib/reviewVisibility";

/** ข้อมูลภายในของทีมงาน — ห้ามส่งให้ลูกค้า (ทั้งหน้าสาธารณะและ "รีวิวของฉัน") */
const INTERNAL_FIELDS = "-internal_tags -internal_note -read_at -read_by -is_analyzed";

const MAX_BULK_ITEMS = 30;

// ── คำนวณคะแนนเฉลี่ย + จำนวนรีวิว ของสินค้า ──────────────────
export async function recomputeProductRating(productId: string): Promise<void> {
  const rows = await reviewModel.aggregate([
    { $match: { product_id: new Types.ObjectId(productId), ...VISIBLE_REVIEW } },
    { $group: { _id: "$product_id", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const avg = rows[0]?.avg ?? null;
  const count = rows[0]?.count ?? 0;
  await productModel.updateOne(
    { _id: productId },
    { $set: { avg_rating: avg == null ? null : round2(avg), review_count: count } }
  );
}

// ── แง่มุม "ชอบ / ควรปรับปรุง" ──────────────────────────────
export interface AspectFeedbackInput {
  aspect_id: string;
  sentiment: "positive" | "negative";
}

/** เก็บเฉพาะแง่มุมที่เปิดใช้งานอยู่จริง · 1 แง่มุมเลือกได้ทางเดียว (ซ้ำ = ใช้ค่าแรก) · ชื่อจาก DB ไม่เชื่อ client */
export async function resolveAspectFeedback(raw: AspectFeedbackInput[] | undefined) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const wanted = new Map<string, "positive" | "negative">();
  for (const f of raw.slice(0, 50)) {
    if (Types.ObjectId.isValid(f.aspect_id) && !wanted.has(f.aspect_id)) wanted.set(f.aspect_id, f.sentiment);
  }
  if (wanted.size === 0) return [];
  const aspects = await aspectModel
    .find({ _id: { $in: [...wanted.keys()] }, deleted_at: null, is_active: { $ne: false } })
    .select("aspect_name_th")
    .lean<Array<{ _id: Types.ObjectId; aspect_name_th: string }>>();
  return aspects.map((a) => ({ aspect_id: a._id, aspect_name_th: a.aspect_name_th, sentiment: wanted.get(String(a._id))! }));
}

// ── CREATE ──────────────────────────────────────────────────
export interface ReviewContentInput {
  rating: number;
  review_text?: string | null;
  image?: string[];
  video?: string | null;
  aspect_feedback?: AspectFeedbackInput[];
}

export interface CreateReviewInput extends ReviewContentInput {
  user_id: string;
  order_item_id?: string;
  preorder_item_id?: string;
}

export type ReviewTargetKind = "order" | "preorder";

function assertRating(raw: unknown): number {
  const rating = Number(raw);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw badRequest("rating ต้องเป็นจำนวนเต็ม 1-5");
  return rating;
}

async function buildContent(input: ReviewContentInput) {
  return {
    rating: assertRating(input.rating),
    review_text: input.review_text ?? null,
    image: Array.isArray(input.image) ? input.image : [],
    video: input.video ?? null,
    aspect_feedback: await resolveAspectFeedback(input.aspect_feedback),
  };
}

type Content = Awaited<ReturnType<typeof buildContent>>;

/** ตรวจ: รายการมีจริง · คำสั่งซื้อเป็นของผู้รีวิว · completed · ชำระแล้ว · ยังไม่เคยรีวิว → { product_id } */
async function assertReviewable(userId: string, kind: ReviewTargetKind, itemId: string): Promise<{ product_id: unknown }> {
  assertObjectId(itemId, kind === "order" ? "order_item_id" : "preorder_item_id");
  const label = kind === "order" ? "ออเดอร์" : "พรีออเดอร์";
  const item =
    kind === "order"
      ? await orderItemModel.findOne({ _id: itemId, deleted_at: null }).select("order_id product_id").lean<any>()
      : await preorderItemModel.findOne({ _id: itemId, deleted_at: null }).select("preorder_id product_id").lean<any>();
  if (!item) throw notFound(`ไม่พบรายการสินค้าใน${label}`);

  const parent =
    kind === "order"
      ? await orderModel.findOne({ _id: item.order_id, deleted_at: null }).select("user_id order_status payment_status").lean<any>()
      : await preorderModel.findOne({ _id: item.preorder_id, deleted_at: null }).select("user_id order_status payment_status").lean<any>();
  if (!parent) throw notFound(`ไม่พบ${label}ของรายการนี้`);
  if (String(parent.user_id) !== String(userId)) throw forbidden("รีวิวได้เฉพาะสินค้าที่คุณสั่งซื้อเอง");
  if (parent.order_status !== "completed") throw badRequest(`รีวิวได้เฉพาะเมื่อ${label}เสร็จสิ้น (completed) แล้ว`);
  if (parent.payment_status !== "paid") throw badRequest(`รีวิวได้เมื่อ${label}ชำระเงินแล้ว`);

  const dup = await reviewModel.exists({
    [kind === "order" ? "order_item_id" : "preorder_order_item_id"]: itemId,
    deleted_at: null,
  });
  if (dup) throw conflict("รายการนี้ถูกรีวิวไปแล้ว");
  return { product_id: item.product_id };
}

async function createOne(userId: string, kind: ReviewTargetKind, itemId: string, content: Content) {
  const { product_id } = await assertReviewable(userId, kind, itemId);
  try {
    return await reviewModel.create({
      ...content,
      user_id: userId,
      product_id,
      order_item_id: kind === "order" ? itemId : null,
      preorder_order_item_id: kind === "preorder" ? itemId : null,
      status: "approved",
      is_visible: true,
      is_analyzed: false,
    });
  } catch (err: any) {
    if (err?.code === 11000) throw conflict("รายการนี้ถูกรีวิวไปแล้ว"); // ส่งพร้อมกัน 2 ครั้ง — unique index กันไว้
    throw err;
  }
}

/**
 * หลังสร้าง: คำนวณคะแนนสินค้า (ครั้งเดียวต่อสินค้า) แล้วให้แต้มทีละรีวิว — ไม่มีรูป 15 / มีรูป 20 ·
 * ครั้งเดียวต่อรายการ (ลบแล้วเขียนใหม่ไม่ได้ซ้ำ · key เดียวกับฝั่งลูกค้า) · แต้มไม่ใช่ขั้นตอนหลัก — พังแค่ log
 */
async function afterCreate(docs: Array<{ _id: unknown; user_id: unknown; product_id: unknown; order_item_id?: unknown; preorder_order_item_id?: unknown; image?: string[] }>) {
  for (const productId of new Set(docs.map((d) => String(d.product_id)))) await recomputeProductRating(productId);
  for (const doc of docs) {
    const withPhoto = (doc.image?.length ?? 0) > 0;
    const dedupeKey = doc.preorder_order_item_id
      ? `review:preorder-item:${String(doc.preorder_order_item_id)}`
      : `review:item:${String(doc.order_item_id)}`;
    await pointsService.safely("review", () =>
      pointsService.awardPoints({
        userId: String(doc.user_id),
        source: withPhoto ? "review_photo" : "review",
        points: withPhoto ? pointsService.POINT_RULES.REVIEW_PHOTO : pointsService.POINT_RULES.REVIEW,
        dedupeKey,
        description: withPhoto ? "เขียนรีวิวสินค้าพร้อมรูปถ่าย" : "เขียนรีวิวสินค้า",
        refType: "review",
        refId: doc._id,
      })
    );
  }
}

/** รีวิว 1 รายการ (order_item_id หรือ preorder_item_id อย่างใดอย่างหนึ่ง) */
export async function createReview(input: CreateReviewInput) {
  await dbConnect();
  if (!!input.order_item_id === !!input.preorder_item_id) throw badRequest("ระบุ order_item_id หรือ preorder_item_id อย่างใดอย่างหนึ่ง");
  const content = await buildContent(input);
  const kind: ReviewTargetKind = input.preorder_item_id ? "preorder" : "order";
  const doc = await createOne(input.user_id, kind, (input.preorder_item_id ?? input.order_item_id)!, content);
  await afterCreate([doc]);
  return stripInternal(doc.toObject());
}

/** รีวิวรวม: เนื้อหาเดียวกันสร้างรีวิวแยกของแต่ละชิ้น → { data, failed } · ไม่ผ่านเลยสักชิ้น = error ของชิ้นแรก */
export async function createReviews(userId: string, kind: ReviewTargetKind, rawIds: string[], input: ReviewContentInput) {
  await dbConnect();
  const ids = [...new Set(rawIds.map(String).filter(Boolean))];
  if (ids.length === 0) throw badRequest("กรุณาเลือกสินค้าที่ต้องการรีวิวอย่างน้อย 1 รายการ");
  if (ids.length > MAX_BULK_ITEMS) throw badRequest(`รีวิวรวมได้สูงสุด ${MAX_BULK_ITEMS} รายการต่อครั้ง`);
  const content = await buildContent(input);

  const created: any[] = [];
  const failed: Array<{ item_id: string; error: HttpError }> = [];
  for (const id of ids) {
    try {
      created.push(await createOne(userId, kind, id, content));
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      failed.push({ item_id: id, error: err });
    }
  }
  if (created.length === 0) throw failed[0].error;
  await afterCreate(created);
  return {
    data: created.map((d) => stripInternal(d.toObject())),
    failed: failed.map(({ item_id, error }) => ({ item_id, message: error.message })),
  };
}

function stripInternal<T extends Record<string, any>>(doc: T): T {
  const { internal_tags: _t, internal_note: _n, read_at: _r, read_by: _b, ...rest } = doc;
  void _t; void _n; void _r; void _b;
  return rest as T;
}

// ── READ ────────────────────────────────────────────────────
export interface ListReviewQuery {
  pagination: Pagination;
  product_id?: string;
  user_id?: string;
  rating?: number;
  is_visible?: boolean;
  is_analyzed?: boolean;
  /** true = รีวิวของลูกค้าคนนี้เอง (ตัดข้อมูลภายในของทีมงานออก) */
  ownOnly?: boolean;
}

/** รายการรีวิวแบบเรียบง่าย (รีวิวของฉัน) — หลังร้านใช้ reviewModerationService.listAdminReviews */
export async function listReviews(query: ListReviewQuery) {
  await dbConnect();
  const filter: Record<string, any> = { deleted_at: null };
  if (typeof query.is_visible === "boolean") filter.is_visible = query.is_visible;
  if (query.product_id) {
    assertObjectId(query.product_id, "product_id");
    filter.product_id = query.product_id;
  }
  if (query.user_id) {
    assertObjectId(query.user_id, "user_id");
    filter.user_id = query.user_id;
  }
  if (query.rating) filter.rating = Number(query.rating);
  if (typeof query.is_analyzed === "boolean") filter.is_analyzed = query.is_analyzed;

  let q = reviewModel
    .find(filter)
    .sort({ created_at: -1 })
    .skip(query.pagination.skip)
    .limit(query.pagination.limit)
    .populate("user_id", "user_fullname user_img")
    .populate("product_id", "product_name_th product_name_eng");
  if (query.ownOnly) q = q.select(INTERNAL_FIELDS);
  const [items, total] = await Promise.all([q.lean(), reviewModel.countDocuments(filter)]);
  return { items, meta: buildMeta(total, query.pagination) };
}

/** รีวิว 1 รายการในรูปที่ส่งให้หน้าสาธารณะได้ (เลือก field เอง — ไม่ใช่ทั้งเอกสาร) */
function toPublicReview(doc: any) {
  const user = doc.user_id && typeof doc.user_id === "object" ? doc.user_id : null;
  const reply = doc.shop_reply;
  const reviewer = maskCustomerName(typeof user?.user_fullname === "string" ? user.user_fullname : "");
  return {
    _id: String(doc._id),
    product_id: String(doc.product_id),
    rating: doc.rating,
    review_text: doc.review_text ?? null,
    image: Array.isArray(doc.image) ? doc.image : [],
    video: doc.video ?? null,
    aspect_feedback: (Array.isArray(doc.aspect_feedback) ? doc.aspect_feedback : []).map((f: any) => ({
      aspect_id: String(f.aspect_id),
      aspect_name_th: f.aspect_name_th ?? "",
      sentiment: f.sentiment,
    })),
    is_pinned: doc.is_pinned === true,
    shop_reply: reply && typeof reply.text === "string" && reply.text ? { text: reply.text, replied_at: reply.replied_at ?? null } : null,
    from_preorder: !!doc.preorder_order_item_id,
    created_at: doc.created_at,
    reviewer_name: reviewer,
    // คงรูปเดิม (populate user_id) ให้หน้าเว็บที่อ่าน user_id.user_fullname ยังใช้ได้ — แต่เป็นชื่อที่ปิดบางส่วนแล้ว
    user_id: { user_fullname: reviewer, user_img: user?.user_img ?? null },
  };
}

/** รีวิวที่แสดงของสินค้า (สาธารณะ) — ปักหมุดขึ้นก่อน แล้วใหม่ก่อน */
export async function listPublicReviews(query: { productId: string; pagination: Pagination; rating?: number }) {
  await dbConnect();
  assertObjectId(query.productId, "product_id");
  const filter: Record<string, any> = { product_id: query.productId, ...VISIBLE_REVIEW };
  if (query.rating) filter.rating = Number(query.rating);
  const [docs, total] = await Promise.all([
    reviewModel
      .find(filter)
      .select("product_id user_id rating review_text image video aspect_feedback is_pinned shop_reply preorder_order_item_id created_at")
      .sort({ is_pinned: -1, pinned_at: -1, created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("user_id", "user_fullname user_img")
      .lean(),
    reviewModel.countDocuments(filter),
  ]);
  return { items: (docs as any[]).map(toPublicReview), meta: buildMeta(total, query.pagination) };
}

export async function getReviewById(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await reviewModel
    .findOne({ _id: id, deleted_at: null })
    .populate("user_id", "user_fullname user_img")
    .populate("product_id", "product_name_th product_name_eng")
    .lean();
  if (!doc) throw notFound("ไม่พบรีวิวที่ระบุ");
  return doc;
}

/** สรุปรีวิวของสินค้า: คะแนนเฉลี่ย จำนวน และการกระจาย 1-5 ดาว */
export async function getProductReviewSummary(productId: string) {
  await dbConnect();
  assertObjectId(productId, "product_id");
  const rows = await reviewModel.aggregate([
    { $match: { product_id: new Types.ObjectId(productId), ...VISIBLE_REVIEW } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);
  const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let total = 0;
  let sum = 0;
  for (const r of rows) {
    distribution[String(r._id)] = r.count;
    total += r.count;
    sum += r._id * r.count;
  }
  return {
    product_id: productId,
    average: total ? round2(sum / total) : null,
    count: total,
    distribution,
  };
}

// ── UPDATE (เจ้าของรีวิวแก้เอง) ─────────────────────────────
export async function updateReview(
  id: string,
  userId: string,
  input: {
    rating?: number;
    review_text?: string | null;
    image?: string[];
    video?: string | null;
    aspect_feedback?: AspectFeedbackInput[];
  }
) {
  await dbConnect();
  assertObjectId(id);

  const review = await reviewModel.findOne({ _id: id, deleted_at: null });
  if (!review) throw notFound("ไม่พบรีวิวที่ระบุ");
  if (String(review.user_id) !== String(userId)) {
    throw forbidden("แก้ไขได้เฉพาะรีวิวของตัวเอง");
  }

  if (input.rating !== undefined) review.rating = assertRating(input.rating);
  if (input.review_text !== undefined) review.review_text = input.review_text;
  if (input.image !== undefined) review.image = Array.isArray(input.image) ? input.image : [];
  if (input.video !== undefined) review.video = input.video;
  if (input.aspect_feedback !== undefined) review.aspect_feedback = await resolveAspectFeedback(input.aspect_feedback);
  review.is_analyzed = false; // เนื้อหาเปลี่ยน ต้องวิเคราะห์ใหม่

  await review.save();
  await recomputeProductRating(String(review.product_id));
  return stripInternal(review.toObject());
}

// ── สถานะการแสดงผล (หลังร้าน) ──────────────────────────────
/** เปลี่ยน status พร้อม is_visible (approved = แสดง) — ทั้งสองระบบอ่านค่าตรงกัน */
export function statusPatch(status: ReviewStatus) {
  return { status, is_visible: status === "approved" };
}

export async function setReviewStatus(id: string, status: ReviewStatus) {
  await dbConnect();
  assertObjectId(id);
  if (!REVIEW_STATUSES.includes(status)) throw badRequest("status ต้องเป็น pending | approved | hidden");
  const review = await reviewModel
    .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: statusPatch(status) }, { returnDocument: "after" })
    .lean<any>();
  if (!review) throw notFound("ไม่พบรีวิวที่ระบุ");
  await recomputeProductRating(String(review.product_id));
  return review;
}

/** ซ่อน/แสดง (เส้นเดิม /visibility) — เท่ากับ status hidden / approved */
export async function setReviewVisibility(id: string, isVisible: boolean) {
  return setReviewStatus(id, isVisible ? "approved" : "hidden");
}

// ── DELETE (soft) ──────────────────────────────────────────
export async function deleteReview(id: string, opts: { by_user_id?: string } = {}) {
  await dbConnect();
  assertObjectId(id);
  const review = await reviewModel.findOne({ _id: id, deleted_at: null });
  if (!review) throw notFound("ไม่พบรีวิวที่ระบุ หรือถูกลบไปแล้ว");
  if (opts.by_user_id && String(review.user_id) !== String(opts.by_user_id)) {
    throw forbidden("ลบได้เฉพาะรีวิวของตัวเอง");
  }
  review.deleted_at = new Date();
  await review.save();
  await recomputeProductRating(String(review.product_id));
  return { deleted: true, _id: review._id };
}
