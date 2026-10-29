/**
 * promotionService — โปรโมชัน/คูปองส่วนลด (Promotions)
 *
 * - CRUD (promotion_code unique, ผูก created_by)
 * - validateForOrder(): ตรวจเงื่อนไขระดับโปรโมชัน (active / ช่วงวันที่ / usage_limit / max_user_per_user)
 *   แล้วเรียก discountEngine คำนวณจำนวนเงินส่วนลด — ใช้ทั้งตอนลูกค้าเช็คโค้ดก่อนจ่าย และตอน orderService สร้างออเดอร์
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound, unprocessable } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import { softDeleteDoc, restoreDoc } from "../lib/crudService";
import {
  computeDiscount,
  type DiscountLine,
  type DiscountResult,
  type PromotionChannel,
} from "../lib/discountEngine";
import promotionModel from "../models/promotionModel";
import productModel from "../models/productModel";
import userModel from "../models/userModel";
import * as promotionUsageService from "./promotionUsageService";
import * as cartService from "./cartService";
import { toSatang, toBaht, toBahtFields } from "../lib/money";
import { GUEST_CUSTOMER_EMAIL } from "../lib/posGuest";
import { channelMismatchMessage, channelsOf, normalizePromoCode, positiveLimit } from "../lib/promoCode";
import { isObjectId } from "../lib/objectId";
import { notifyCustomersOfNewCode, hidePromotionNotices, restorePromotionNotices } from "./couponNoticeService";
import type { z } from "zod";
import type { promotionCreate, promotionUpdate } from "../schemas/promotion";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DISCOUNT_TYPES = ["Percentage", "Amount", "FreeShipping"] as const;

// เงินเก็บเป็นบาท ทศนิยม 2 ตำแหน่ง (docs/money-units.md) · presenter แค่ปัดก่อนคืน
// discount_value เป็นเงินเฉพาะตอน discount_type === "Amount" เท่านั้น (ดู comment ที่ promotionModel.ts)
const MONEY_FIELDS = ["min_order_amount", "max_discount_amount"] as const;

/** แปลง field เงินของ promotion doc เป็นบาท — ใช้ทั้งตอนคืน API และตอนส่งเข้า discountEngine
 *  (discountEngine.ts ทำงานเป็นบาทล้วน ไม่เคยถูกแก้ในเฟสนี้ ตามรูปแบบ "แปลงข้ามโดเมนตรงจุดที่ข้าม") */
function presentPromotion<T extends Record<string, unknown>>(promo: T): T {
  const out = toBahtFields(promo, MONEY_FIELDS);
  if (out.discount_type === "Amount" && typeof out.discount_value === "number") {
    (out as Record<string, unknown>).discount_value = toBaht(out.discount_value as number);
  }
  return out;
}

/** stackable_with: ตัดซ้ำ + ตัดตัวเอง · ปิด stackable = ล้างรายการ (ไม่มีความหมายแล้ว) */
function normalizeStackableWith(list: string[] | undefined, stackable: boolean | undefined, selfId?: string) {
  if (stackable === false) return [];
  if (list === undefined) return undefined;
  return [...new Set(list.map(String))].filter((id) => id !== selfId);
}

type CreatePromotionInput = z.infer<typeof promotionCreate>;
type UpdatePromotionInput = z.infer<typeof promotionUpdate>;

// ── CRUD ────────────────────────────────────────────────────
// required field / discount_type enum / end_date≥start_date / Percentage≤100 validate ที่ route
// ผ่าน schemas/promotion.ts แล้ว (ไม่ต้องเช็คซ้ำที่นี่)
export async function createPromotion(input: CreatePromotionInput, createdBy: string) {
  await dbConnect();
  await assertRefExists(userModel, createdBy, "ผู้สร้าง", "created_by");

  // input.discount_value/min_order_amount/max_discount_amount เป็นบาทจาก request (API contract)
  // ปัด 2 ตำแหน่งก่อนเก็บ — discount_value ปัดเฉพาะตอน Amount (Percentage เป็นเปอร์เซ็นต์ ไม่ใช่เงิน)
  const payload: Record<string, unknown> = {
    ...input,
    promotion_code: normalizePromoCode(input.promotion_code),
    discount_value:
      input.discount_type === "Amount" ? toSatang(Number(input.discount_value)) : input.discount_value,
    min_order_amount:
      input.min_order_amount != null ? toSatang(Number(input.min_order_amount)) : input.min_order_amount,
    max_discount_amount:
      input.max_discount_amount != null
        ? toSatang(Number(input.max_discount_amount))
        : input.max_discount_amount,
    stackable_with: normalizeStackableWith(input.stackable_with, input.stackable) ?? [],
    created_by: createdBy,
  };

  try {
    const doc = await promotionModel.create(payload);
    // โค้ดใหม่ที่ลูกค้าเว็บใช้ได้ → กระดิ่งในเว็บของลูกค้าพร้อมรหัส (ไม่ใช้โควตา LINE · couponNoticeService)
    notifyCustomersOfNewCode(doc.toObject());
    return presentPromotion(doc.toObject());
  } catch (err: any) {
    if (err?.code === 11000) throw conflict("รหัสโปรโมชันนี้ถูกใช้แล้ว");
    throw err;
  }
}

export interface ListPromotionQuery {
  pagination: Pagination;
  search?: string;
  is_active?: boolean;
  discount_type?: string;
  activeNow?: boolean; // เฉพาะที่อยู่ในช่วงวันที่ + is_active
  includeDeleted?: boolean;
}

export async function listPromotions(query: ListPromotionQuery) {
  await dbConnect();
  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (typeof query.is_active === "boolean") filter.is_active = query.is_active;
  if (query.discount_type) filter.discount_type = query.discount_type;
  if (query.search) {
    const rx = new RegExp(escapeRegExp(query.search.trim()), "i");
    filter.$or = [{ promotion_code: rx }, { promotion_name: rx }];
  }
  if (query.activeNow) {
    const now = new Date();
    filter.is_active = true;
    filter.start_date = { $lte: now };
    filter.end_date = { $gte: now };
  }

  const [items, total] = await Promise.all([
    promotionModel
      .find(filter)
      .sort({ created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .lean(),
    promotionModel.countDocuments(filter),
  ]);
  return { items: items.map(presentPromotion), meta: buildMeta(total, query.pagination) };
}

export async function getPromotionById(id: string, opts: { includeDeleted?: boolean } = {}) {
  await dbConnect();
  assertObjectId(id);
  const filter: Record<string, any> = { _id: id };
  if (!opts.includeDeleted) filter.deleted_at = null;
  const doc = await promotionModel.findOne(filter).lean();
  if (!doc) throw notFound("ไม่พบโปรโมชันที่ระบุ");
  return presentPromotion(doc);
}

export async function updatePromotion(id: string, input: UpdatePromotionInput) {
  await dbConnect();
  assertObjectId(id);
  const payload: Record<string, any> = { ...input };
  if (payload.promotion_code) {
    payload.promotion_code = normalizePromoCode(payload.promotion_code);
  }
  const stackableWith = normalizeStackableWith(payload.stackable_with, payload.stackable, id);
  if (stackableWith === undefined) delete payload.stackable_with;
  else payload.stackable_with = stackableWith;

  // discount_value เป็นเงินเฉพาะตอน discount_type === "Amount" — แปลงตามประเภทที่ "จะเป็นหลังอัปเดต" (อ่านจาก DB)
  // cross-field เดียวกับตอนสร้าง (schema ทำกับ partial ไม่ได้) — เทียบกับค่าที่ "จะเป็นหลังอัปเดต"
  // เดิมไม่ตรวจเลย: PATCH end_date ก่อน start_date / Percentage เกิน 100 ได้ · เปลี่ยน discount_type
  // โดยไม่ส่ง discount_value → ค่าเดิมถูกตีความผิดหน่วย (10% กลายเป็น ฿0.10 · ฿50 กลายเป็น 5000%)
  const crossFields = ["discount_type", "discount_value", "start_date", "end_date"];
  if (crossFields.some((k) => payload[k] !== undefined)) {
    const existing = await promotionModel
      .findOne({ _id: id, deleted_at: null })
      .select("discount_type discount_value start_date end_date")
      .lean<{ discount_type: string; discount_value: number; start_date: Date; end_date: Date } | null>();
    if (!existing) throw notFound("ไม่พบโปรโมชันที่ระบุ");
    const effectiveType = payload.discount_type ?? existing.discount_type;
    if (effectiveType !== existing.discount_type && payload.discount_value === undefined) {
      throw badRequest("เปลี่ยนประเภทส่วนลดต้องระบุ discount_value ใหม่ด้วย");
    }
    if (effectiveType === "Percentage" && payload.discount_value !== undefined && Number(payload.discount_value) > 100) {
      throw badRequest("โปร Percentage: discount_value ต้องไม่เกิน 100");
    }
    const start = new Date(payload.start_date ?? existing.start_date);
    const end = new Date(payload.end_date ?? existing.end_date);
    if (end < start) throw badRequest("end_date ต้องไม่ก่อน start_date");

    if (payload.discount_value !== undefined && effectiveType === "Amount") {
      payload.discount_value = toSatang(Number(payload.discount_value));
    }
  }
  if (payload.min_order_amount != null) {
    payload.min_order_amount = toSatang(Number(payload.min_order_amount));
  }
  if (payload.max_discount_amount != null) {
    payload.max_discount_amount = toSatang(Number(payload.max_discount_amount));
  }

  try {
    const doc = await promotionModel
      .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: payload }, {
        returnDocument: "after",
        runValidators: true,
      })
      .lean();
    if (!doc) throw notFound("ไม่พบโปรโมชันที่ระบุ");
    return presentPromotion(doc);
  } catch (err: any) {
    if (err?.code === 11000) throw conflict("รหัสโปรโมชันนี้ถูกใช้แล้ว");
    throw err;
  }
}

// BACKLOG3 §9 — soft-delete/restore เป็น pattern เดียวกับ service อื่นทุกจุด ใช้ primitive กลางแทน
export async function deletePromotion(id: string) {
  const doc = await softDeleteDoc(promotionModel, id, {
    notFoundMsg: "ไม่พบโปรโมชันที่ระบุ หรือถูกลบไปแล้ว",
  });
  // ลบโค้ด → ซ่อนแจ้งเตือน "โค้ดใหม่" ที่ส่งให้ลูกค้าไปแล้ว (กดคัดลอกไปใช้ไม่ได้อยู่ดี)
  await hidePromotionNotices(id);
  return presentPromotion(doc);
}

export async function restorePromotion(id: string) {
  const doc = await restoreDoc(promotionModel, id, { notFoundMsg: "ไม่พบโปรโมชันที่ถูกลบไว้" });
  await restorePromotionNotices(id);
  return presentPromotion(doc);
}

// ── ตรวจ + คิดส่วนลดสำหรับออเดอร์ ────────────────────────────
export interface ValidateForOrderInput {
  code?: string;
  promotion_id?: string;
  user_id: string;
  lines: DiscountLine[];
  subtotal: number;
  delivery_fee: number;
  channel?: PromotionChannel;
}

async function isPosGuest(userId: string): Promise<boolean> {
  const user = await userModel.findById(userId).select("email").lean<{ email?: string } | null>();
  return user?.email?.toLowerCase() === GUEST_CUSTOMER_EMAIL.toLowerCase();
}

export async function validateForOrder(input: ValidateForOrderInput): Promise<DiscountResult> {
  await dbConnect();

  if (!input.code && !input.promotion_id) {
    throw badRequest("ต้องระบุ code หรือ promotion_id");
  }

  const q: Record<string, any> = { deleted_at: null };
  if (input.promotion_id) {
    assertObjectId(input.promotion_id, "promotion_id");
    q._id = input.promotion_id;
  } else {
    q.promotion_code = normalizePromoCode(input.code);
    if (!q.promotion_code) throw badRequest("กรุณากรอกโค้ดส่วนลด");
  }

  const promo = await promotionModel.findOne(q).lean<any>();
  if (!promo) throw notFound("ไม่พบโปรโมชันนี้");

  // ช่องทางก่อนเงื่อนไขอื่น — โค้ดหน้าร้านที่กรอกในเว็บต้องบอก "ใช้ได้เฉพาะที่หน้าร้าน" เสมอ
  // (เดิมตรวจใน discountEngine หลังวันที่/โควตา โค้ดหน้าร้านที่หมดอายุหรือเต็มแล้วขึ้นข้อความอื่น ลูกค้าเข้าใจผิดว่าลองใหม่ได้)
  const channel = input.channel ?? "online";
  if (!channelsOf(promo).includes(channel)) throw unprocessable(channelMismatchMessage(channelsOf(promo)));

  if (promo.is_active === false) throw unprocessable("โปรโมชันนี้ถูกปิดใช้งาน");
  // โปรที่แลกด้วยแต้ม ใช้ผ่าน "คูปองของฉัน" เท่านั้น (couponService · customer-backend-merge.md §8.11)
  if (promo.points_cost > 0) {
    throw unprocessable('โค้ดนี้ต้องแลกด้วยแต้มที่หน้าสมาชิกก่อน แล้วเลือกจาก "คูปองของฉัน"');
  }

  const now = Date.now();
  if (promo.start_date && new Date(promo.start_date).getTime() > now) {
    throw unprocessable("ยังไม่ถึงช่วงเวลาของโปรโมชันนี้");
  }
  if (promo.end_date && new Date(promo.end_date).getTime() < now) {
    throw unprocessable("โปรโมชันนี้หมดอายุแล้ว");
  }

  const usageLimit = positiveLimit(promo.usage_limit);
  if (usageLimit != null && (promo.used_count ?? 0) >= usageLimit) {
    throw unprocessable("โปรโมชันนี้ถูกใช้ครบจำนวนแล้ว");
  }
  // โปรเฉพาะสมาชิก — บัญชี "ลูกค้าทั่วไป" ของ POS ใช้ไม่ได้ (ลูกค้าหน้าเว็บมีบัญชีเสมอ = สมาชิก)
  if (promo.audience === "members" && (await isPosGuest(input.user_id))) {
    throw unprocessable("โปรโมชันนี้สำหรับสมาชิกเท่านั้น — ผูกบิลกับสมาชิกก่อนใช้");
  }
  const perUser = positiveLimit(promo.max_user_per_user);
  if (perUser != null) {
    const used = await promotionUsageService.getUserUsageCount(
      String(promo._id),
      input.user_id
    );
    if (used >= perUser) {
      throw unprocessable("คุณใช้สิทธิ์โปรโมชันนี้ครบจำนวนแล้ว");
    }
  }

  // promo จาก DB เป็นบาท — presentPromotion() ปัด field เงินชุดเดียวกับที่ API คืน ก่อนส่งเข้า discountEngine.ts
  return computeDiscount(presentPromotion(promo), {
    lines: input.lines,
    subtotal: input.subtotal,
    delivery_fee: input.delivery_fee,
    channel,
  });
}

/** พรีวิวส่วนลดจากตะกร้าปัจจุบันของ user (ใช้ที่ /api/shop/promotions/validate ก่อนกดสั่งซื้อ) */
export async function previewForCart(
  userId: string,
  input: { code?: string; promotion_id?: string; delivery_fee?: number; channel?: PromotionChannel }
): Promise<DiscountResult> {
  const detail = await cartService.getCartDetail(userId);
  if (detail.items.length === 0) throw badRequest("ตะกร้าว่าง");

  const lines = (detail.items as any[]).map((it) => {
    const p = it.product_id ?? {};
    return {
      product_id: String(p._id ?? it.product_id),
      quantity: it.quantity as number,
      line_total: (it.price_snapshot ?? 0) * it.quantity,
    };
  });

  const ids = [...new Set(lines.map((l) => l.product_id))];
  const prods = await productModel
    .find({ _id: { $in: ids } })
    .select("category_id")
    .lean<Array<{ _id: any; category_id?: any }>>();
  const catByProduct = new Map(
    prods.map((p) => [String(p._id), p.category_id ? String(p.category_id) : null])
  );

  const discountLines: DiscountLine[] = lines.map((l) => ({
    ...l,
    category_id: catByProduct.get(l.product_id) ?? null,
  }));
  const subtotal = discountLines.reduce((s, l) => s + l.line_total, 0);

  return validateForOrder({
    code: input.code,
    promotion_id: input.promotion_id,
    user_id: userId,
    lines: discountLines,
    subtotal,
    delivery_fee: Math.max(0, Number(input.delivery_fee) || 0),
    channel: input.channel ?? "online",
  });
}

/**
 * พรีวิวส่วนลดจากรายการที่หน้าเว็บส่งมา (หน้าชำระพรีออเดอร์ — ไม่มีตะกร้า) · ยอดเป็นแค่ตัวอย่าง:
 * ตอนสร้างพรีออเดอร์ backend คิดราคา/ส่วนลดจริงจากรอบอีกครั้งเสมอ (preorderService.createPreorder)
 */
export async function previewForLines(
  userId: string,
  input: { code?: string; lines: Array<{ product_id: string; quantity: number; line_total: number }>; delivery_fee?: number }
): Promise<DiscountResult> {
  await dbConnect();
  const lines = (input.lines ?? []).filter((l) => l && typeof l.product_id === "string" && Number(l.quantity) > 0);
  if (lines.length === 0) throw badRequest("ยังไม่มีรายการสินค้า");
  const prods = await productModel
    .find({ _id: { $in: [...new Set(lines.map((l) => l.product_id))].filter((id) => isObjectId(id)) } })
    .select("category_id")
    .lean<Array<{ _id: any; category_id?: any }>>();
  const catByProduct = new Map(prods.map((p) => [String(p._id), p.category_id ? String(p.category_id) : null]));
  const discountLines: DiscountLine[] = lines.map((l) => ({
    product_id: l.product_id,
    category_id: catByProduct.get(l.product_id) ?? null,
    quantity: Number(l.quantity),
    line_total: Math.max(0, Number(l.line_total) || 0),
  }));
  return validateForOrder({
    code: input.code,
    user_id: userId,
    lines: discountLines,
    subtotal: discountLines.reduce((s, l) => s + l.line_total, 0),
    delivery_fee: Math.max(0, Number(input.delivery_fee) || 0),
    channel: "online",
  });
}
