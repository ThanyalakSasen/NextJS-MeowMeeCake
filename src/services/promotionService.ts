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
import type { z } from "zod";
import type { promotionCreate, promotionUpdate } from "../schemas/promotion";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DISCOUNT_TYPES = ["Percentage", "Amount", "FreeShipping"] as const;

// BACKLOG §3.11 เฟส 5a — promotionModel เก็บเงินเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
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

type CreatePromotionInput = z.infer<typeof promotionCreate>;
type UpdatePromotionInput = z.infer<typeof promotionUpdate>;

// ── CRUD ────────────────────────────────────────────────────
// required field / discount_type enum / end_date≥start_date / Percentage≤100 validate ที่ route
// ผ่าน schemas/promotion.ts แล้ว (ไม่ต้องเช็คซ้ำที่นี่)
export async function createPromotion(input: CreatePromotionInput, createdBy: string) {
  await dbConnect();
  await assertRefExists(userModel, createdBy, "ผู้สร้าง", "created_by");

  // input.discount_value/min_order_amount/max_discount_amount เป็นบาทจาก request (API contract)
  // แปลงเป็นสตางค์ก่อนเก็บ — discount_value แปลงเฉพาะตอน Amount (ดู comment ที่ promotionModel.ts)
  const payload: Record<string, unknown> = {
    ...input,
    promotion_code: input.promotion_code.trim().toUpperCase(),
    discount_value:
      input.discount_type === "Amount" ? toSatang(Number(input.discount_value)) : input.discount_value,
    min_order_amount:
      input.min_order_amount != null ? toSatang(Number(input.min_order_amount)) : input.min_order_amount,
    max_discount_amount:
      input.max_discount_amount != null
        ? toSatang(Number(input.max_discount_amount))
        : input.max_discount_amount,
    created_by: createdBy,
  };

  try {
    const doc = await promotionModel.create(payload);
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
    payload.promotion_code = String(payload.promotion_code).trim().toUpperCase();
  }

  // discount_value เป็นเงินเฉพาะตอน discount_type === "Amount" — ถ้าไม่ได้ส่ง discount_type มาด้วย
  // ต้องอ่านค่าปัจจุบันจาก DB มาดูก่อนว่าประเภทที่ "จะเป็นหลังอัปเดต" คืออะไร (ไม่ใช่เดาจาก payload
  // อย่างเดียว) — ถ้าไม่ได้แก้ discount_value เลยในรอบนี้ ไม่ต้องอ่านอะไรเพิ่ม ปล่อยผ่านเหมือนเดิม
  if (payload.discount_value !== undefined) {
    let effectiveType = payload.discount_type;
    if (effectiveType === undefined) {
      const existing = await promotionModel
        .findOne({ _id: id, deleted_at: null })
        .select("discount_type")
        .lean<{ discount_type: string } | null>();
      if (!existing) throw notFound("ไม่พบโปรโมชันที่ระบุ");
      effectiveType = existing.discount_type;
    }
    if (effectiveType === "Amount") {
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
        new: true,
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

export async function deletePromotion(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await promotionModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null },
      { $set: { deleted_at: new Date() } },
      { new: true }
    )
    .lean();
  if (!doc) throw notFound("ไม่พบโปรโมชันที่ระบุ หรือถูกลบไปแล้ว");
  return presentPromotion(doc);
}

export async function restorePromotion(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await promotionModel
    .findOneAndUpdate(
      { _id: id, deleted_at: { $ne: null } },
      { $set: { deleted_at: null } },
      { new: true }
    )
    .lean();
  if (!doc) throw notFound("ไม่พบโปรโมชันที่ถูกลบไว้");
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
    q.promotion_code = String(input.code).trim().toUpperCase();
  }

  const promo = await promotionModel.findOne(q).lean<any>();
  if (!promo) throw notFound("ไม่พบโปรโมชันนี้");

  if (promo.is_active === false) throw unprocessable("โปรโมชันนี้ถูกปิดใช้งาน");

  const now = Date.now();
  if (promo.start_date && new Date(promo.start_date).getTime() > now) {
    throw unprocessable("ยังไม่ถึงช่วงเวลาของโปรโมชันนี้");
  }
  if (promo.end_date && new Date(promo.end_date).getTime() < now) {
    throw unprocessable("โปรโมชันนี้หมดอายุแล้ว");
  }

  if (promo.usage_limit != null && (promo.used_count ?? 0) >= promo.usage_limit) {
    throw unprocessable("โปรโมชันนี้ถูกใช้ครบจำนวนแล้ว");
  }
  if (promo.max_user_per_user != null) {
    const used = await promotionUsageService.getUserUsageCount(
      String(promo._id),
      input.user_id
    );
    if (used >= promo.max_user_per_user) {
      throw unprocessable("คุณใช้สิทธิ์โปรโมชันนี้ครบจำนวนแล้ว");
    }
  }

  // promo จาก DB เป็นสตางค์ (min_order_amount/max_discount_amount เสมอ, discount_value เฉพาะ Amount)
  // แต่ discountEngine.ts ทำงานเป็นบาทล้วน (ไม่เคยถูกแก้ในเฟสนี้) — แปลงตรงจุดข้ามนี้ทันที เหมือน
  // deliveryService/recipeService ในเฟสก่อนหน้า — presentPromotion() ทำหน้าที่นี้ให้พอดี (แปลง field
  // เดียวกับที่ API คืนกลับ)
  return computeDiscount(presentPromotion(promo), {
    lines: input.lines,
    subtotal: input.subtotal,
    delivery_fee: input.delivery_fee,
    channel: input.channel ?? "online",
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
