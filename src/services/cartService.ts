/**
 * cartService — ตะกร้าสินค้าของลูกค้า (Carts + CartItems)
 *
 * - 1 ผู้ใช้ มี 1 ตะกร้า (สร้างอัตโนมัติเมื่อเรียกครั้งแรก)
 * - รับเฉพาะสินค้าปกติ (is_preorder: false) — สินค้าพรีออเดอร์ (is_preorder: true)
 *   ใช้ระบบ Preorders แยก
 * - ราคาต่อหน่วย (price_snapshot) คำนวณ ณ ตอนหยิบใส่ตะกร้า = ราคาสินค้า (sale_price ถ้ามี)
 *   + ราคาเพิ่มของตัวเลือก (ทุกกลุ่ม) + ออปชันที่เลือก (productCustomizationService — ตัวเลือกไม่มีสต็อกแยก)
 * - soft delete ทั้ง cart และ cart item ผ่าน deleted_at
 *
 * หมายเหตุ: service รับ userId เป็น argument — ชั้น route/auth เป็นผู้ยืนยันว่า userId ตรงกับผู้ล็อกอิน
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import cartModel from "../models/cartModel";
import cartItemModel from "../models/cartItemModel";
import productModel from "../models/productModel";
import userModel from "../models/userModel";
import { toBaht, toBahtFields, toSatang } from "../lib/money";
import { isPreorderProduct } from "../lib/productCode";
import { assertCustomizationIds, getProductCustomization, resolveCustomization } from "./productCustomizationService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SelectedOptionInput {
  option_id: string;
  text_value?: string | null;
}

export interface AddCartItemInput {
  product_id: string;
  /** ตัวเลือกที่เลือกทุกกลุ่ม (กลุ่มตัวเลือก) */
  variant_ids?: string[] | null;
  /** แบบเดิม — ตัวเลือกเดียว */
  variant_id?: string | null;
  selected_options?: SelectedOptionInput[];
  quantity: number;
}

// BACKLOG §3.11 เฟส 5b — price_snapshot/selected_options[].extra_price เก็บเป็นสตางค์ (คำนวณจาก
// product_price/sale_price/variant_price/extra_price ที่เป็นสตางค์ทั้งหมดแล้ว) แต่ API ยังรับ-ส่ง
// บาททศนิยมเหมือนเดิม — ไม่มีจุด "รับ input เป็นบาท" ในไฟล์นี้เลย (price_snapshot คำนวณจาก DB ล้วน ๆ
// ไม่เคยรับราคาจาก client ตรง ๆ) จึงมีแค่ presenter ฝั่งคืนค่า ไม่มีฝั่งแปลงเข้า
function presentCartItem(it: Record<string, any>): any {
  const presented = toBahtFields(it, ["price_snapshot"] as const);
  return {
    ...presented,
    selected_options: (presented.selected_options ?? []).map((o: any) => ({
      ...o,
      extra_price: toBaht(o.extra_price),
    })),
  };
}

// ── ตะกร้า ───────────────────────────────────────────────────
export async function getOrCreateCart(userId: string) {
  await dbConnect();
  await assertRefExists(userModel, userId, "ผู้ใช้", "user_id");

  const existing = await cartModel.findOne({ user_id: userId, deleted_at: null });
  if (existing) return existing;
  return cartModel.create({ user_id: userId });
}

/** ตะกร้าพร้อมรายการและยอดรวม */
export async function getCartDetail(userId: string) {
  await dbConnect();
  const cart = await getOrCreateCart(userId);

  const items = await cartItemModel
    .find({ cart_id: cart._id, deleted_at: null })
    .sort({ added_at: 1 })
    .populate("product_id", "product_name_th product_name_eng product_img is_preorder is_visible")
    .populate("variant_id", "variant_name variant_price")
    .lean();

  // คำนวณ line_total เป็นสตางค์ (integer) ก่อนเสมอ แล้วค่อยแปลงเป็นบาทตอนสุดท้าย (กันปัดเศษสะสมจาก
  // การคูณ/บวกเลขทศนิยม — BACKLOG §3.11) price_snapshot ที่นี่ยังเป็นสตางค์ดิบจาก DB (ยังไม่ผ่าน
  // presentCartItem) ส่วน .populate("variant_id", "... variant_price") ก็ติดสตางค์ดิบมาด้วยเช่นกัน
  // ต้องแปลงซ้อนอีกชั้นเหมือน componentService/recipeService.getExpanded() ในเฟส 4
  const line = (items as any[]).map((it) => {
    const lineTotalSatang = (it.price_snapshot ?? 0) * (it.quantity ?? 0);
    const presented = presentCartItem(it);
    return {
      ...presented,
      variant_id:
        presented.variant_id && typeof presented.variant_id === "object"
          ? toBahtFields(presented.variant_id, ["variant_price"] as const)
          : presented.variant_id,
      line_total: toBaht(lineTotalSatang),
    };
  });
  const subtotalSatang = (items as any[]).reduce(
    (s, it) => s + (it.price_snapshot ?? 0) * (it.quantity ?? 0),
    0
  );
  const subtotal = toBaht(subtotalSatang);

  return {
    cart: { _id: cart._id, user_id: cart.user_id },
    items: line,
    summary: {
      item_count: line.length,
      total_quantity: line.reduce((s, it) => s + (it.quantity ?? 0), 0),
      subtotal,
    },
  };
}

// ── เพิ่มสินค้าเข้าตะกร้า ────────────────────────────────────
export async function addItem(userId: string, input: AddCartItemInput) {
  await dbConnect();

  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw badRequest("quantity ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
  }
  assertObjectId(input.product_id, "product_id");

  const product = await productModel
    .findOne({ _id: input.product_id, deleted_at: null })
    .lean<any>();
  if (!product) throw notFound("ไม่พบสินค้าที่ระบุ");
  if (product.is_visible === false) throw badRequest("สินค้านี้ถูกปิดการขายอยู่");
  if (isPreorderProduct(product)) {
    // ตะกร้าปกติรับเฉพาะ inStore/online — สินค้าพรีออเดอร์สั่งผ่านระบบ Preorders แยกต่างหาก
    throw badRequest("สินค้าพรีออเดอร์ต้องสั่งผ่านระบบพรีออเดอร์ ไม่สามารถเพิ่มลงตะกร้าปกติได้");
  }

  assertCustomizationIds(input);
  const custom = resolveCustomization(
    await getProductCustomization(String(input.product_id)),
    input,
    product.product_name_th
  );

  const basePrice = product.sale_price ?? product.product_price;
  const price_snapshot = toSatang(basePrice + custom.extra_price);

  const cart = await getOrCreateCart(userId);

  // ถ้ามีรายการเหมือนกันเป๊ะอยู่แล้ว (สินค้า + ชุดตัวเลือก/ออปชันเดียวกัน) → เพิ่มจำนวน
  const dup = await cartItemModel.findOne({
    cart_id: cart._id,
    product_id: input.product_id,
    deleted_at: null,
    // ไม่มีตัวเลือก: รายการเก่า (ก่อนมี customization_key) ต้องไม่มี variant/ออปชันด้วยถึงจะรวมกัน
    ...(custom.key
      ? { customization_key: custom.key }
      : { customization_key: { $in: ["", null] }, variant_id: null, "selected_options.0": { $exists: false } }),
  });
  if (dup) {
    dup.quantity += quantity;
    dup.price_snapshot = price_snapshot; // อัปเดตให้เป็นราคาปัจจุบัน
    await dup.save();
    return presentCartItem(dup.toObject());
  }

  const doc = await cartItemModel.create({
    cart_id: cart._id,
    product_id: input.product_id,
    variant_id: custom.variant_id,
    selected_variants: custom.selected_variants,
    customization_key: custom.key,
    selected_options: custom.selected_options,
    quantity,
    price_snapshot,
  });
  return presentCartItem(doc.toObject());
}

// ── แก้จำนวนของรายการในตะกร้า (0 = ลบ) ──────────────────────
export async function updateItemQuantity(
  userId: string,
  itemId: string,
  quantity: number
) {
  await dbConnect();
  assertObjectId(itemId, "item_id");

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 0) {
    throw badRequest("quantity ต้องเป็นจำนวนเต็มไม่ติดลบ");
  }

  const cart = await getOrCreateCart(userId);
  const item = await cartItemModel.findOne({
    _id: itemId,
    cart_id: cart._id,
    deleted_at: null,
  });
  if (!item) throw notFound("ไม่พบรายการในตะกร้า");

  if (qty === 0) {
    item.deleted_at = new Date();
    await item.save();
    return { removed: true, _id: item._id };
  }

  item.quantity = qty;
  await item.save();
  return presentCartItem(item.toObject());
}

// ── ลบรายการออกจากตะกร้า ────────────────────────────────────
export async function removeItem(userId: string, itemId: string) {
  await dbConnect();
  assertObjectId(itemId, "item_id");

  const cart = await getOrCreateCart(userId);
  const item = await cartItemModel
    .findOneAndUpdate(
      { _id: itemId, cart_id: cart._id, deleted_at: null },
      { $set: { deleted_at: new Date() } },
      { returnDocument: "after" }
    )
    .lean();
  if (!item) throw notFound("ไม่พบรายการในตะกร้า");
  return { removed: true, _id: (item as any)._id };
}

// ── ล้างตะกร้าทั้งหมด ───────────────────────────────────────
export async function clearCart(userId: string) {
  await dbConnect();
  const cart = await getOrCreateCart(userId);
  const res = await cartItemModel.updateMany(
    { cart_id: cart._id, deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  return { removed_count: res.modifiedCount ?? 0 };
}
