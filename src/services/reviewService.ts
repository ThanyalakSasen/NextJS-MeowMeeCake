/**
 * reviewService — รีวิวสินค้า (Reviews)
 *
 * - รีวิวได้เฉพาะสินค้าที่ "เคยซื้อและออเดอร์ completed แล้ว" (ตรวจผ่าน order_item_id → order ของ user)
 * - 1 รีวิว ต่อ 1 order_item
 * - ทุกครั้งที่รายการรีวิวเปลี่ยน (สร้าง/แก้ rating/ซ่อน/ลบ) จะคำนวณ avg_rating + review_count ใหม่ลง productModel
 */
import { Types } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, forbidden, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { buildMeta, type Pagination } from "../lib/queryParams";
import reviewModel from "../models/reviewModel";
import orderItemModel from "../models/orderItemModel";
import orderModel from "../models/orderModel";
import productModel from "../models/productModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── คำนวณคะแนนเฉลี่ย + จำนวนรีวิว ของสินค้า ──────────────────
async function recomputeProductRating(productId: string): Promise<void> {
  const rows = await reviewModel.aggregate([
    { $match: { product_id: new Types.ObjectId(productId), deleted_at: null, is_visible: true } },
    { $group: { _id: "$product_id", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const avg = rows[0]?.avg ?? null;
  const count = rows[0]?.count ?? 0;
  await productModel.updateOne(
    { _id: productId },
    { $set: { avg_rating: avg == null ? null : Math.round(avg * 100) / 100, review_count: count } }
  );
}

// ── CREATE ──────────────────────────────────────────────────
export interface CreateReviewInput {
  user_id: string;
  order_item_id: string;
  rating: number;
  review_text?: string | null;
  image?: string[];
}

export async function createReview(input: CreateReviewInput) {
  await dbConnect();

  assertObjectId(input.order_item_id, "order_item_id");
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw badRequest("rating ต้องเป็นจำนวนเต็ม 1-5");
  }

  const orderItem = await orderItemModel
    .findOne({ _id: input.order_item_id, deleted_at: null })
    .lean<any>();
  if (!orderItem) throw notFound("ไม่พบรายการสินค้าในออเดอร์");

  const order = await orderModel.findById(orderItem.order_id).lean<any>();
  if (!order) throw notFound("ไม่พบออเดอร์ของรายการนี้");
  if (String(order.user_id) !== String(input.user_id)) {
    throw forbidden("รีวิวได้เฉพาะสินค้าที่คุณสั่งซื้อเอง");
  }
  if (order.order_status !== "completed") {
    throw badRequest("รีวิวได้เฉพาะเมื่อออเดอร์เสร็จสิ้น (completed) แล้ว");
  }

  const dup = await reviewModel.exists({
    order_item_id: input.order_item_id,
    deleted_at: null,
  });
  if (dup) throw conflict("รายการนี้ถูกรีวิวไปแล้ว");

  const doc = await reviewModel.create({
    user_id: input.user_id,
    product_id: orderItem.product_id,
    order_item_id: input.order_item_id,
    rating,
    review_text: input.review_text ?? null,
    image: Array.isArray(input.image) ? input.image : [],
    is_analyzed: false,
    is_visible: true,
  });

  await recomputeProductRating(String(orderItem.product_id));
  return doc.toObject();
}

// ── READ ────────────────────────────────────────────────────
export interface ListReviewQuery {
  pagination: Pagination;
  product_id?: string;
  user_id?: string;
  rating?: number;
  is_visible?: boolean;
  is_analyzed?: boolean;
  /** true = คืนเฉพาะที่ is_visible: true (ใช้ฝั่งหน้าร้าน) */
  publicOnly?: boolean;
}

export async function listReviews(query: ListReviewQuery) {
  await dbConnect();
  const filter: Record<string, any> = { deleted_at: null };
  if (query.publicOnly) filter.is_visible = true;
  else if (typeof query.is_visible === "boolean") filter.is_visible = query.is_visible;
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

  const [items, total] = await Promise.all([
    reviewModel
      .find(filter)
      .sort({ created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("user_id", "user_fullname user_img")
      .populate("product_id", "product_name_th product_name_eng")
      .lean(),
    reviewModel.countDocuments(filter),
  ]);
  return { items, meta: buildMeta(total, query.pagination) };
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
    { $match: { product_id: new Types.ObjectId(productId), deleted_at: null, is_visible: true } },
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
    average: total ? Math.round((sum / total) * 100) / 100 : null,
    count: total,
    distribution,
  };
}

// ── UPDATE (เจ้าของรีวิวแก้เอง) ─────────────────────────────
export async function updateReview(
  id: string,
  userId: string,
  input: { rating?: number; review_text?: string | null; image?: string[] }
) {
  await dbConnect();
  assertObjectId(id);

  const review = await reviewModel.findOne({ _id: id, deleted_at: null });
  if (!review) throw notFound("ไม่พบรีวิวที่ระบุ");
  if (String(review.user_id) !== String(userId)) {
    throw forbidden("แก้ไขได้เฉพาะรีวิวของตัวเอง");
  }

  if (input.rating !== undefined) {
    const r = Number(input.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) throw badRequest("rating ต้องเป็นจำนวนเต็ม 1-5");
    review.rating = r;
  }
  if (input.review_text !== undefined) review.review_text = input.review_text;
  if (input.image !== undefined) review.image = Array.isArray(input.image) ? input.image : [];
  review.is_analyzed = false; // เนื้อหาเปลี่ยน ต้องวิเคราะห์ใหม่

  await review.save();
  await recomputeProductRating(String(review.product_id));
  return review.toObject();
}

// ── ซ่อน/แสดง (แอดมิน moderate) ────────────────────────────
export async function setReviewVisibility(id: string, isVisible: boolean) {
  await dbConnect();
  assertObjectId(id);
  const review = await reviewModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null },
      { $set: { is_visible: !!isVisible } },
      { new: true }
    )
    .lean<any>();
  if (!review) throw notFound("ไม่พบรีวิวที่ระบุ");
  await recomputeProductRating(String(review.product_id));
  return review;
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
