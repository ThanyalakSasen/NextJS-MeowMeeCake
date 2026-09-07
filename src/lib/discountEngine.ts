/**
 * discountEngine — คำนวณส่วนลดจากโปรโมชัน 1 ตัว เทียบกับรายการในออเดอร์
 *
 * ไม่ยุ่งกับ DB — รับ promotion doc + รายการที่ resolve แล้วเข้ามา คืนจำนวนเงินส่วนลด
 * เงื่อนไขที่รองรับ: discount_type (Percentage/Amount/FreeShipping), applicable_products/categories,
 *   min_order_amount, min_quantity, max_discount_amount, applicable_channels
 *
 * ⚠️ ไม่เช็ค is_active / ช่วงวันที่ / usage_limit / max_user_per_user — เป็นหน้าที่ของ promotionService
 */
import { badRequest, unprocessable } from "./httpError";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DiscountType = "Percentage" | "Amount" | "FreeShipping";
export type PromotionChannel = "online" | "instore";

export interface DiscountLine {
  product_id: string;
  category_id?: string | null;
  quantity: number;
  line_total: number; // ราคารวมของรายการนี้ (unit_price * quantity)
}

export interface DiscountContext {
  lines: DiscountLine[];
  subtotal: number;
  delivery_fee: number;
  channel: PromotionChannel;
}

export interface DiscountResult {
  promotion_id: string;
  promotion_code: string;
  discount_type: DiscountType;
  /** จำนวนเงินส่วนลดรวม (รวมค่าส่งถ้าเป็น FreeShipping) — orderService ใช้: total = subtotal + delivery_fee - discount_amount */
  discount_amount: number;
  free_shipping: boolean;
  /** ยอดของ "สินค้าที่ร่วมรายการ" ที่ใช้เป็นฐานคิด (= subtotal ถ้าไม่จำกัดสินค้า) */
  eligible_amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function idIn(list: any[] | undefined, id: string | null | undefined): boolean {
  if (!list?.length || !id) return false;
  return list.some((x) => String(x) === String(id));
}

export function computeDiscount(promo: any, ctx: DiscountContext): DiscountResult {
  const type = promo.discount_type as DiscountType;

  // ── ช่องทาง ──
  const channels: string[] = promo.applicable_channels ?? ["online", "instore"];
  if (!channels.includes(ctx.channel)) {
    throw unprocessable(`โปรโมชันนี้ใช้ได้เฉพาะช่องทาง: ${channels.join(", ")}`);
  }

  // ── หาว่ารายการไหน "ร่วมรายการ" ──
  const hasProductScope = (promo.applicable_products?.length ?? 0) > 0;
  const hasCategoryScope = (promo.applicable_categories?.length ?? 0) > 0;
  const scoped = hasProductScope || hasCategoryScope;

  const eligibleLines = scoped
    ? ctx.lines.filter(
        (l) =>
          idIn(promo.applicable_products, l.product_id) ||
          idIn(promo.applicable_categories, l.category_id)
      )
    : ctx.lines;

  const eligibleAmount = round2(eligibleLines.reduce((s, l) => s + l.line_total, 0));
  const eligibleQty = eligibleLines.reduce((s, l) => s + l.quantity, 0);

  if (scoped && eligibleLines.length === 0) {
    throw unprocessable("ไม่มีสินค้าที่ร่วมรายการโปรโมชันนี้ในออเดอร์");
  }

  // ── ขั้นต่ำ ──
  if (promo.min_order_amount != null && eligibleAmount < promo.min_order_amount) {
    throw unprocessable(
      `ยอดสินค้าที่ร่วมรายการยังไม่ถึงขั้นต่ำ ${promo.min_order_amount} บาท (ปัจจุบัน ${eligibleAmount})`
    );
  }
  if (promo.min_quantity != null && eligibleQty < promo.min_quantity) {
    throw unprocessable(
      `ต้องมีสินค้าที่ร่วมรายการอย่างน้อย ${promo.min_quantity} ชิ้น (ปัจจุบัน ${eligibleQty})`
    );
  }

  // ── คิดส่วนลด ──
  let discount = 0;
  let freeShipping = false;

  if (type === "Percentage") {
    if (promo.discount_value == null) throw badRequest("โปรโมชันไม่มี discount_value");
    discount = eligibleAmount * (Number(promo.discount_value) / 100);
    if (promo.max_discount_amount != null) {
      discount = Math.min(discount, Number(promo.max_discount_amount));
    }
  } else if (type === "Amount") {
    discount = Math.min(Number(promo.discount_value ?? 0), eligibleAmount);
  } else if (type === "FreeShipping") {
    // ต้องมีค่าจัดส่งให้ลด — ออเดอร์รับเอง (takeaway) หรือออเดอร์ที่ได้ส่งฟรีอยู่แล้ว delivery_fee = 0
    // ถ้าปล่อยผ่านจะได้ discount = 0 แต่ออเดอร์ยังผูก promotion_id โดยไม่บันทึก usage → reject ไปเลย
    if (!(ctx.delivery_fee > 0)) {
      throw unprocessable(
        "โปรโมชันส่งฟรีใช้ได้เฉพาะออเดอร์แบบจัดส่งที่มีค่าจัดส่งเท่านั้น (ออเดอร์รับเอง หรือออเดอร์ที่ได้ส่งฟรีอยู่แล้ว ใช้ไม่ได้)"
      );
    }
    freeShipping = true;
    discount = ctx.delivery_fee;
  } else {
    throw badRequest(`discount_type ไม่รองรับ: ${type}`);
  }

  discount = round2(Math.max(0, discount));

  // ส่วนลดออกมา 0 (เช่น discount_value = 0, eligibleAmount น้อยมาก, หรือ config ผิด) —
  // ถ้าปล่อยผ่านออเดอร์จะผูก promotion_id โดยไม่บันทึก usage → reject เหมือนกรณี FreeShipping
  if (discount <= 0) {
    throw unprocessable("โปรโมชันนี้ไม่ให้ส่วนลดกับออเดอร์นี้ (ส่วนลดเป็น 0)");
  }

  return {
    promotion_id: String(promo._id),
    promotion_code: promo.promotion_code,
    discount_type: type,
    discount_amount: discount,
    free_shipping: freeShipping,
    eligible_amount: eligibleAmount,
  };
}
