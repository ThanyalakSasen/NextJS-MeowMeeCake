// ─────────────────────────────────────────────────────────────
// preorderItemCancellation — pure: ยอดเงินหลังยกเลิกบางสินค้าออกจากพรีออเดอร์
//
// ส่วนลดของสินค้า (โค้ด/คูปอง/แต้ม) ลดตามสัดส่วนราคาสินค้าที่ยกเลิก ลูกค้าจึงได้คืนเท่าที่จ่ายจริงให้สินค้านั้น
// ส่วนลดค่าส่ง (คูปองส่งฟรี) กับค่าส่งไม่เกี่ยวกับตัวสินค้า — ยังต้องส่งของที่เหลือ จึงคงไว้ทั้งก้อน
// ไม่ตรวจขั้นต่ำของโปรซ้ำ: ลูกค้าไม่ได้เป็นคนเอาสินค้าออก จึงไม่ควรเสียส่วนลดส่วนที่เหลือ
// ─────────────────────────────────────────────────────────────
import { round2 } from "./money";

export interface PreorderAmounts {
  subtotal: number;
  discount_amount: number;
  total_amount: number;
}

export interface ItemCancellation {
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  /** ส่วนต่างของ total_amount — ถ้าชำระแล้ว = ยอดที่ต้องโอนคืน */
  refund: number;
}

export function computeItemCancellation(doc: PreorderAmounts, removed: number, shippingDiscount = 0): ItemCancellation {
  if (removed <= 0 || removed >= doc.subtotal) {
    throw new Error("ยอดสินค้าที่ยกเลิกต้องมากกว่า 0 และน้อยกว่ายอดสินค้าทั้งใบ");
  }
  const goodsDiscount = Math.max(0, doc.discount_amount - shippingDiscount);
  const share = round2((goodsDiscount * removed) / doc.subtotal);
  const refund = round2(removed - share);
  return {
    subtotal: round2(doc.subtotal - removed),
    discount_amount: round2(doc.discount_amount - share),
    total_amount: round2(Math.max(0, doc.total_amount - refund)),
    refund,
  };
}
