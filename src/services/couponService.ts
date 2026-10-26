/**
 * couponService — คูปองส่วนตัวที่แลกด้วยแต้มสะสม (ย้ายมาจาก backend ฝั่งลูกค้า src/lib/coupons.ts · customer-backend-merge.md §8.11)
 *
 *   - ร้านเปิดให้แลกโปรไหนได้ด้วย points_cost (หน้าจัดการโปรโมชัน) · โปรที่ตั้ง points_cost กรอกเป็นโค้ดตรง ๆ ไม่ได้
 *   - แลกแล้วได้ UserCoupons 1 ใบ ใช้ได้ครั้งเดียว หมดอายุสิ้นวันสุดท้ายของโปร · เงื่อนไขส่วนลดเป็น snapshot ตอนแลก
 *   - ตอนสั่ง (ผู้ใช้เลือก "แบบฝั่งลูกค้า"): คูปองของฉัน **หรือ** โค้ดส่วนลด อย่างใดอย่างหนึ่ง + ใช้แต้มร่วมได้
 *     (หักคูปองก่อน แล้วคิดเพดานแต้ม 30% จากยอดที่เหลือ — orderService / preorderService)
 *   - แลกแต้มเป็นส่วนลดบาทตรง ๆ ได้ (convertPointsToCoupon · 2026-10-26) — คูปอง source "points" ไม่มีโปรต้นทาง
 *     (ไม่นับ used_count / ไม่บันทึก promotion_usages) · หน้าชำระเงินไม่มีช่องใช้แต้มแล้ว ใช้ผ่านคูปองนี้แทน
 *   - ออเดอร์ถูกยกเลิก/คืนเงิน → คูปองกลับมาใช้ได้ (ไม่คืนแต้มที่ใช้แลก เพราะได้คูปองคืนแล้ว) · สิทธิ์โปรคืนผ่าน promotionUsageService.revokeUsage
 */
import mongoose from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound, unprocessable } from "../lib/httpError";
import { isObjectId } from "../lib/objectId";
import { log } from "../lib/logger";
import { computeDiscount, type DiscountLine } from "../lib/discountEngine";
import promotionModel from "../models/promotionModel";
import promotionUsagesModel from "../models/promotionUsagesModel";
import userCouponModel from "../models/userCouponModel";
import * as pointsService from "./pointsService";
import { channelMismatchMessage, channelsOf, normalizePromoCode, positiveLimit } from "../lib/promoCode";
import { notifyCouponRedeemed } from "./couponNoticeService";
import type { LoyaltyKind } from "./pointsService";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** โปรนี้ยังแลกด้วยแต้มได้ไหม — มี points_cost · ใช้ออนไลน์ได้ · เปิดอยู่ · อยู่ในช่วงวันที่ · ยังไม่เต็มโควตา */
function isRedeemable(p: any, now = new Date()): boolean {
  if (!p || !(p.points_cost > 0) || p.deleted_at) return false;
  if (!channelsOf(p).includes("online")) return false;
  if (p.is_active === false) return false;
  if (p.start_date && new Date(p.start_date) > now) return false;
  if (p.end_date && new Date(p.end_date) < now) return false;
  const limit = positiveLimit(p.usage_limit);
  if (limit != null && (p.used_count ?? 0) >= limit) return false;
  return true;
}

/** ใช้ได้ถึงสิ้นวันสุดท้ายของโปร */
const couponExpiry = (endDate: Date) => new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1);

/** หน้าสมาชิก/หน้าชำระเงิน: { catalog: คูปองที่แลกได้, coupons: คูปองของฉัน (+ state available/used/expired) } */
export async function getCouponOverview(userId: string) {
  await dbConnect();
  const [promotions, myCoupons] = await Promise.all([
    promotionModel.find({ deleted_at: null, points_cost: { $gt: 0 } }).lean<any[]>(),
    userCouponModel.find({ user_id: userId }).sort({ created_at: -1 }).limit(100).lean<any[]>(),
  ]);
  const owned = new Map<string, number>();
  for (const c of myCoupons) owned.set(String(c.promotion_id), (owned.get(String(c.promotion_id)) ?? 0) + 1);

  const now = new Date();
  const catalog = promotions
    .filter((p) => isRedeemable(p, now))
    .map((p) => {
      const limit = positiveLimit(p.max_user_per_user);
      return {
        _id: p._id,
        promotion_name: p.promotion_name,
        promotion_desc: p.promotion_desc ?? "",
        discount_type: p.discount_type,
        discount_value: p.discount_value,
        min_order_amount: p.min_order_amount ?? 0,
        max_discount_amount: p.max_discount_amount ?? null,
        points_cost: p.points_cost,
        end_date: p.end_date,
        limit_reached: limit !== null && (owned.get(String(p._id)) ?? 0) >= limit,
      };
    });
  const coupons = myCoupons.map((c) => ({
    ...c,
    state: c.status === "used" ? "used" : new Date(c.expires_at) <= now ? "expired" : "available",
  }));
  return { catalog, coupons };
}

/** แลกแต้มเป็นคูปอง — หักแต้มก่อน สร้างคูปองไม่สำเร็จ → คืนแต้ม */
export async function redeemCoupon(userId: string, promotionId: unknown) {
  await dbConnect();
  if (!isObjectId(promotionId)) throw badRequest("คูปองไม่ถูกต้อง");
  const promo = await promotionModel.findOne({ _id: promotionId, deleted_at: null }).lean<any>();
  if (!isRedeemable(promo)) throw notFound("คูปองนี้ไม่เปิดให้แลกแล้ว");

  const perUser = positiveLimit(promo.max_user_per_user);
  if (perUser !== null && (await userCouponModel.countDocuments({ user_id: userId, promotion_id: promotionId })) >= perUser) {
    throw badRequest(`แลกคูปองนี้ได้สูงสุด ${perUser} ครั้งต่อคน`);
  }

  const couponId = new mongoose.Types.ObjectId();
  await pointsService.spendPointsForCoupon({
    userId,
    points: Number(promo.points_cost),
    couponId,
    couponName: promo.promotion_name,
  });
  try {
    const doc = await userCouponModel.create({
      _id: couponId,
      user_id: userId,
      promotion_id: promo._id,
      promotion_code: promo.promotion_code,
      promotion_name: promo.promotion_name,
      discount_type: promo.discount_type,
      discount_value: Number(promo.discount_value),
      min_order_amount: promo.min_order_amount ?? 0,
      max_discount_amount: promo.max_discount_amount ?? null,
      applicable_products: promo.applicable_products ?? [],
      applicable_categories: promo.applicable_categories ?? [],
      min_quantity: positiveLimit(promo.min_quantity),
      points_spent: Number(promo.points_cost),
      expires_at: couponExpiry(promo.end_date),
    });
    // นับซ้ำหลังสร้าง (optimistic แบบ promotionUsageService.recordUsage) — กดแลกพร้อมกันหลายคำขอผ่านการเช็คด้านบน
    // ได้ทุกคำขอ → ถ้านับแล้วเกินสิทธิ์ ลบใบของตัวเองแล้วคืนแต้ม (catch ด้านล่าง)
    // รับประกันว่าไม่เกินสิทธิ์: คำขอที่นับทีหลังสุดเห็นทุกใบที่ยังอยู่ · ข้อเสีย: กดพร้อมกันอาจล้มทุกคำขอ (แต้มคืน กดใหม่ได้)
    if (perUser !== null && (await userCouponModel.countDocuments({ user_id: userId, promotion_id: promotionId })) > perUser) {
      await userCouponModel.deleteOne({ _id: doc._id });
      throw badRequest(`แลกคูปองนี้ได้สูงสุด ${perUser} ครั้งต่อคน`);
    }
    // กระดิ่งในเว็บพร้อมรหัสคูปอง (ไม่ส่ง LINE · couponNoticeService)
    await notifyCouponRedeemed(userId, doc.toObject());
    return doc.toObject();
  } catch (err) {
    await pointsService.refundRedemption("coupon", String(couponId)).catch((e) =>
      log.error("coupon.redeem_refund_failed", { coupon_id: String(couponId), err: e })
    );
    throw err;
  }
}

/** คูปองที่แลกจากแต้มใช้ได้กี่วัน */
export const POINTS_COUPON_DAYS = 90;

/**
 * แลกแต้มเป็นคูปองส่วนลดบาท (หน้าสมาชิก) — 100 แต้ม = ฿10 · ขั้นต่ำ 100 แต้ม · ทีละ 10 แต้ม (POINT_RULES)
 * ได้คูปอง Amount 1 ใบ ใช้ได้ครั้งเดียว ภายใน POINTS_COUPON_DAYS วัน · หักแต้มก่อน สร้างคูปองไม่สำเร็จ → คืนแต้ม
 */
export async function convertPointsToCoupon(userId: string, rawPoints: unknown) {
  await dbConnect();
  const { MIN_BALANCE_TO_REDEEM: min, REDEEM_STEP: step } = pointsService.POINT_RULES;
  const points = Number(rawPoints);
  if (!Number.isInteger(points) || points < min) throw badRequest(`แลกได้ตั้งแต่ ${min} แต้มขึ้นไป`);
  if (points % step !== 0) throw badRequest(`แลกได้ทีละ ${step} แต้ม`);
  const value = pointsService.pointsToBaht(points);

  const couponId = new mongoose.Types.ObjectId();
  const name = `ส่วนลด ${value.toLocaleString("th-TH")} บาท (แลกจาก ${points.toLocaleString("th-TH")} แต้ม)`;
  await pointsService.spendPointsForCoupon({ userId, points, couponId, couponName: name });
  try {
    const doc = await userCouponModel.create({
      _id: couponId,
      user_id: userId,
      promotion_id: null,
      source: "points",
      promotion_code: `PTS-${String(couponId).slice(-6).toUpperCase()}`,
      promotion_name: name,
      discount_type: "Amount",
      discount_value: value,
      min_order_amount: 0,
      max_discount_amount: null,
      applicable_products: [],
      applicable_categories: [],
      min_quantity: null,
      points_spent: points,
      expires_at: new Date(Date.now() + POINTS_COUPON_DAYS * 24 * 60 * 60 * 1000),
    });
    await notifyCouponRedeemed(userId, doc.toObject());
    return doc.toObject();
  } catch (err) {
    await pointsService.refundRedemption("coupon", String(couponId)).catch((e) =>
      log.error("coupon.convert_refund_failed", { coupon_id: String(couponId), err: e })
    );
    throw err;
  }
}

/**
 * ตรวจโค้ดส่วนลดที่ลูกค้ากรอก (ยังไม่นับการใช้ — นับจริงตอนสร้างออเดอร์) → ข้อมูลไว้คิดส่วนลดล่วงหน้าในหน้าชำระเงิน
 * พรีวิวยอดจากตะกร้าใช้ /api/shop/promotions/validate (คิดจริงด้วย discountEngine)
 */
export async function checkPromotionCode(code: unknown, userId: string) {
  await dbConnect();
  // ตัดช่องว่างทุกตำแหน่ง (คัดลอกจากแจ้งเตือน/LINE มักติดมา) — lib/promoCode.ts
  const normalized = normalizePromoCode(code);
  if (!normalized) throw badRequest("กรุณากรอกโค้ดส่วนลด");
  if (normalized.length > 50) throw badRequest("โค้ดส่วนลดไม่ถูกต้อง");
  const p = await promotionModel.findOne({ deleted_at: null, promotion_code: normalized }).lean<any>();
  if (!p) throw notFound("ไม่พบโค้ดส่วนลดนี้");
  // ช่องทางก่อน — โค้ดหน้าร้านกรอกในเว็บ = "ใช้ได้เฉพาะที่หน้าร้าน" เสมอ (แม้จะหมดอายุ/เต็ม/แลกด้วยแต้ม)
  if (!channelsOf(p).includes("online")) throw unprocessable(channelMismatchMessage(channelsOf(p)));
  if (p.points_cost > 0) throw unprocessable('โค้ดนี้ต้องแลกด้วยแต้มที่หน้าสมาชิกก่อน แล้วเลือกจาก "คูปองของฉัน"');
  if (p.is_active === false) throw unprocessable("โค้ดนี้ปิดใช้งานแล้ว");
  const now = new Date();
  if (p.start_date && new Date(p.start_date) > now) throw unprocessable("โค้ดนี้ยังไม่ถึงวันเริ่มใช้");
  if (p.end_date && new Date(p.end_date) < now) throw unprocessable("โค้ดนี้หมดอายุแล้ว");
  const usageLimit = positiveLimit(p.usage_limit);
  if (usageLimit != null && (p.used_count ?? 0) >= usageLimit) throw unprocessable("โค้ดนี้ถูกใช้ครบจำนวนแล้ว");
  const perUser = positiveLimit(p.max_user_per_user);
  if (perUser != null) {
    const used = await promotionUsagesModel.countDocuments({ promotion_id: p._id, user_id: userId, deleted_at: null });
    if (used >= perUser) throw unprocessable(`คุณใช้โค้ดนี้ครบ ${perUser} ครั้งแล้ว`);
  }
  return {
    promotion_code: p.promotion_code,
    promotion_name: p.promotion_name,
    promotion_desc: p.promotion_desc ?? "",
    discount_type: p.discount_type,
    discount_value: p.discount_value,
    min_order_amount: p.min_order_amount ?? 0,
    max_discount_amount: p.max_discount_amount ?? null,
    end_date: p.end_date ?? null,
  };
}

export interface AppliedCoupon {
  user_coupon_id: unknown;
  promotion_id: unknown;
  /** ส่วนลดรวม (รวมค่าส่งถ้าเป็นคูปองส่งฟรี — แบบเดียวกับโปรโมชันของหลัก) */
  discount_amount: number;
  free_shipping: boolean;
  /** คืนคูปอง + สิทธิ์โปร ถ้าสร้างเอกสารไม่สำเร็จ */
  undo: () => Promise<void>;
}

/**
 * ใช้คูปองของฉันกับออเดอร์/พรีออเดอร์ — ตรวจเจ้าของ/สถานะ/วันหมดอายุ แล้วคิดส่วนลดจาก snapshot ด้วย discountEngine
 * (ขั้นต่ำ · เพดาน · ส่งฟรีต้องมีค่าส่ง) · จองคูปองแบบมีเงื่อนไข (กันใช้ใบเดียวกับ 2 ออเดอร์พร้อมกัน) + บันทึกการใช้โปร
 */
export async function applyUserCoupon(opts: {
  userId: string;
  userCouponId: unknown;
  lines: DiscountLine[];
  subtotal: number;
  delivery_fee: number;
  refType: LoyaltyKind;
  refId: unknown;
}): Promise<AppliedCoupon> {
  await dbConnect();
  if (!isObjectId(opts.userCouponId)) throw badRequest("คูปองไม่ถูกต้อง");
  const coupon = await userCouponModel.findOne({ _id: opts.userCouponId, user_id: opts.userId }).lean<any>();
  if (!coupon || coupon.status !== "available") throw unprocessable("คูปองนี้ถูกใช้ไปแล้วหรือไม่มีอยู่");
  if (new Date(coupon.expires_at) <= new Date()) throw unprocessable("คูปองนี้หมดอายุแล้ว");
  // คูปองแลกแต้ม (ลดเป็นบาท) ที่มูลค่ามากกว่ายอดสินค้า = ใช้ไม่ได้ (ไม่ให้แต้มที่แลกมาเสียเปล่า · 2026-10-26)
  // คูปองจากโปร (รวมใบที่ลูกค้าแลกไว้ก่อนกติกานี้) ลดได้ไม่เกินยอดเหมือนเดิม — computeDiscount ตัดให้
  if (coupon.source === "points" && coupon.discount_type === "Amount" && Number(coupon.discount_value) > Number(opts.subtotal) + 1e-9) {
    throw unprocessable(`คูปองมูลค่า ${Number(coupon.discount_value).toLocaleString("th-TH")} บาท มากกว่ายอดสินค้า — ใช้กับคำสั่งซื้อนี้ไม่ได้`);
  }

  // ขอบเขตสินค้า: snapshot ตอนแลก · คูปองเก่าที่ไม่มี snapshot → อ่านจากโปรต้นทาง (แม้ถูกลบไปแล้ว)
  let scope = {
    applicable_products: coupon.applicable_products as unknown[] | null,
    applicable_categories: coupon.applicable_categories as unknown[] | null,
    min_quantity: coupon.min_quantity as number | null,
  };
  if (scope.applicable_products == null && scope.applicable_categories == null) {
    const promo = await promotionModel
      .findById(coupon.promotion_id)
      .select("applicable_products applicable_categories min_quantity")
      .lean<any>();
    scope = {
      applicable_products: promo?.applicable_products ?? [],
      applicable_categories: promo?.applicable_categories ?? [],
      min_quantity: promo?.min_quantity ?? null,
    };
  }

  const result = computeDiscount(
    {
      _id: coupon.promotion_id,
      promotion_code: coupon.promotion_code,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      min_order_amount: coupon.min_order_amount || null,
      max_discount_amount: coupon.max_discount_amount ?? null,
      applicable_products: scope.applicable_products ?? [],
      applicable_categories: scope.applicable_categories ?? [],
      min_quantity: scope.min_quantity,
    },
    { lines: opts.lines, subtotal: opts.subtotal, delivery_fee: opts.delivery_fee, channel: "online" }
  );

  const marked = await userCouponModel.updateOne(
    { _id: coupon._id, status: "available" },
    { $set: { status: "used", used_ref_type: opts.refType, used_ref_id: opts.refId, used_at: new Date() } }
  );
  if (marked.modifiedCount === 0) throw conflict("คูปองนี้ถูกใช้ไปแล้ว");

  const refField = opts.refType === "order" ? "order_id" : "preorder_id";
  // บันทึกการใช้โปรไม่สำเร็จ = ใช้คูปองไม่สำเร็จ → คืนคูปอง/used_count ที่จองไปแล้ว แล้วโยนต่อ (ออเดอร์ล้มตาม)
  // เดิมโยนต่อเฉย ๆ — คูปองค้าง "used" ทั้งที่ไม่มีออเดอร์ (saga ยังไม่ได้ผูก undo เพราะฟังก์ชันนี้ยังไม่คืนค่า)
  let counted = false;
  let usage: any;
  const hasPromotion = !!coupon.promotion_id;
  if (hasPromotion) try {
    await promotionModel.updateOne({ _id: coupon.promotion_id }, { $inc: { used_count: 1 } });
    counted = true;
    usage = await promotionUsagesModel.create({
      promotion_id: coupon.promotion_id,
      user_id: opts.userId,
      [refField]: opts.refId,
      discount_applied: result.discount_amount,
    });
  } catch (err) {
    await userCouponModel
      .updateOne({ _id: coupon._id, used_ref_id: opts.refId }, { $set: { status: "available", used_ref_type: null, used_ref_id: null, used_at: null } })
      .catch(() => undefined);
    if (counted) {
      await promotionModel.updateOne({ _id: coupon.promotion_id, used_count: { $gt: 0 } }, { $inc: { used_count: -1 } }).catch(() => undefined);
    }
    throw err;
  }

  return {
    user_coupon_id: coupon._id,
    promotion_id: coupon.promotion_id,
    discount_amount: result.discount_amount,
    free_shipping: result.free_shipping,
    undo: async () => {
      await userCouponModel.updateOne(
        { _id: coupon._id, used_ref_id: opts.refId },
        { $set: { status: "available", used_ref_type: null, used_ref_id: null, used_at: null } }
      );
      if (!hasPromotion) return;
      await promotionUsagesModel.deleteOne({ _id: usage._id });
      await promotionModel.updateOne({ _id: coupon.promotion_id, used_count: { $gt: 0 } }, { $inc: { used_count: -1 } });
    },
  };
}

/** ออเดอร์ถูกยกเลิก/คืนเงิน → คูปองที่ใช้กลับมาใช้ได้ (สิทธิ์โปร/used_count คืนผ่าน promotionUsageService.revokeUsage) */
export async function releaseCoupon(refType: LoyaltyKind, refId: string): Promise<void> {
  await dbConnect();
  await userCouponModel.updateOne(
    { used_ref_type: refType, used_ref_id: refId, status: "used" },
    { $set: { status: "available", used_ref_type: null, used_ref_id: null, used_at: null } }
  );
}
