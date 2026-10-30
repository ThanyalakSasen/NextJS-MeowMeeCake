/**
 * cartService — ตะกร้าสินค้าของลูกค้า (Carts + CartItems)
 *
 * - 1 ผู้ใช้ มี 1 ตะกร้า (สร้างอัตโนมัติเมื่อเรียกครั้งแรก)
 * - รับเฉพาะสินค้าปกติ (is_preorder: false) — สินค้าพรีออเดอร์ (is_preorder: true)
 *   ใช้ระบบ Preorders แยก
 * - ราคาต่อหน่วย (price_snapshot) คำนวณ ณ ตอนหยิบใส่ตะกร้า = ราคาสินค้า (sale_price ถ้ามี)
 *   + ราคาเพิ่มของตัวเลือก (ทุกกลุ่ม) + ออปชันที่เลือก (productCustomizationService — ตัวเลือกไม่มีสต็อกแยก)
 *   getCartDetail คิดใหม่จากราคาปัจจุบันทุกครั้ง (สูตรเดียวกับ orderService.resolveLines ตอนสั่งจริง)
 * - soft delete ทั้ง cart และ cart item ผ่าน deleted_at
 * - ตรวจสต็อกตอนเพิ่มลงตะกร้า / เพิ่มจำนวน (assertCartStock) — รวมทุกบรรทัดของสินค้าเดียวกันในตะกร้า
 *   (ตัวเลือกไม่มีสต็อกแยก) เกิน product_stock_quantity → 409 · ลดจำนวนได้เสมอ · ไม่จองสต็อก —
 *   ตอนสั่งจริง orderService ตัดสต็อกแบบ atomic อีกชั้น (คนอื่นซื้อตัดหน้าได้ระหว่างอยู่ในตะกร้า)
 *
 * หมายเหตุ: service รับ userId เป็น argument — ชั้น route/auth เป็นผู้ยืนยันว่า userId ตรงกับผู้ล็อกอิน
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import cartModel from "../models/cartModel";
import cartItemModel from "../models/cartItemModel";
import productModel from "../models/productModel";
import userModel from "../models/userModel";
import { toBaht, toBahtFields, toSatang } from "../lib/money";
import { isPreorderProduct } from "../lib/productCode";
import { assertCustomizationIds, getCustomizations, getProductCustomization, resolveCustomization } from "./productCustomizationService";

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

// price_snapshot / selected_options[].extra_price — เงินเก็บเป็นบาท ทศนิยม 2 ตำแหน่ง (docs/money-units.md) · presenter แค่ปัดก่อนคืน
// ไม่มีจุด "รับราคาจาก client" ในไฟล์นี้ (price_snapshot คำนวณจาก DB ล้วน ๆ) จึงมีแค่ฝั่งคืนค่า
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

/**
 * สต็อกพอไหม ถ้าบรรทัดนี้มี `quantity` ชิ้น + บรรทัดอื่นของสินค้าเดียวกันในตะกร้า — กติกาเดียวกับ
 * productService.deductStockForOrder (รวมจำนวนต่อสินค้า) · excludeItemId = บรรทัดที่กำลังแก้จำนวน (ไม่นับซ้ำ)
 * ไม่พอ → 409 พร้อม details { product_id, available, in_cart } ให้หน้าเว็บบอกว่าเพิ่มได้อีกกี่ชิ้น
 */
async function assertCartStock(
  cartId: unknown,
  product: { _id: unknown; product_name_th?: string; is_preorder?: boolean; product_stock_quantity?: number | null },
  quantity: number,
  excludeItemId?: unknown
): Promise<void> {
  if (isPreorderProduct(product)) return;
  const lines = await cartItemModel
    .find({
      cart_id: cartId,
      product_id: product._id,
      deleted_at: null,
      ...(excludeItemId ? { _id: { $ne: excludeItemId } } : {}),
    })
    .select("quantity")
    .lean<{ quantity?: number }[]>();
  const inCart = lines.reduce((s, it) => s + (it.quantity ?? 0), 0);
  const available = Math.max(0, product.product_stock_quantity ?? 0);
  if (inCart + quantity <= available) return;

  const name = product.product_name_th ?? "สินค้านี้";
  const details = { product_id: String(product._id), available, in_cart: inCart };
  if (available === 0) throw conflict(`${name} หมดแล้ว`, details);
  if (inCart === 0) throw conflict(`${name} เหลือ ${available} ชิ้น`, details);
  const canAdd = Math.max(0, available - inCart);
  throw conflict(
    canAdd > 0
      ? `${name} เหลือ ${available} ชิ้น — ในตะกร้ามีแล้ว ${inCart} ชิ้น เพิ่มได้อีก ${canAdd} ชิ้น`
      : `${name} เหลือ ${available} ชิ้น — ในตะกร้ามีครบจำนวนแล้ว`,
    details
  );
}

/** เหตุผลที่รายการในตะกร้าสั่งไม่ได้แล้ว (product = ค่าที่ populate มา) · null = สั่งได้ */
export function cartItemUnavailableReason(product: any): string | null {
  if (!product || typeof product !== "object" || product.deleted_at) return "สินค้านี้ถูกนำออกจากร้านแล้ว";
  if (product.is_visible === false) return "สินค้านี้ปิดการขายอยู่";
  return null;
}

/** ตะกร้าพร้อมรายการและยอดรวม */
export async function getCartDetail(userId: string) {
  await dbConnect();
  const cart = await getOrCreateCart(userId);

  const items = await cartItemModel
    .find({ cart_id: cart._id, deleted_at: null })
    .sort({ added_at: 1 })
    .populate("product_id", "product_name_th product_name_eng product_img is_preorder is_visible deleted_at product_price sale_price")
    .populate("variant_id", "variant_name variant_price")
    .lean();

  // ราคาปัจจุบันต่อบรรทัด — ตอนสั่ง orderService re-price จากราคาปัจจุบันเสมอ (resolveLines) แต่เดิมตะกร้า/หน้ายืนยัน/
  // ตรวจโค้ดส่วนลดใช้ price_snapshot ตอนหยิบ → ร้านเปลี่ยนราคาระหว่างนั้น ยอดที่ลูกค้ายืนยันไม่ตรงกับบิลที่ต้องจ่าย
  // ตัวเลือกที่ใช้ไม่ได้แล้ว (ร้านลบ/เปลี่ยนเงื่อนไข) = คงราคาเดิมไว้แสดง — ตอนสั่งจริง resolveLines แจ้ง error เอง
  const productIds = [...new Set((items as any[]).map((it) => it.product_id?._id).filter(Boolean).map(String))];
  const customizations = await getCustomizations(productIds);
  const priceOf = (it: any): number => {
    const product = it.product_id;
    if (!product || typeof product !== "object" || product.deleted_at) return it.price_snapshot ?? 0;
    try {
      const custom = resolveCustomization(
        customizations.get(String(product._id)) ?? { groups: [], options: [] },
        {
          variant_ids: (it.selected_variants ?? []).map((v: any) => v?.variant_id).filter(Boolean).map(String),
          variant_id: it.variant_id?._id ? String(it.variant_id._id) : null,
          selected_options: (it.selected_options ?? [])
            .filter((o: any) => o?.option_id != null)
            .map((o: any) => ({ option_id: String(o.option_id), text_value: o.text_value ?? null })),
        },
        product.product_name_th
      );
      return toSatang((product.sale_price ?? product.product_price) + custom.extra_price);
    } catch {
      return it.price_snapshot ?? 0;
    }
  };
  const priced = (items as any[]).map((it) => ({ ...it, price_snapshot: priceOf(it) }));

  // line_total / subtotal: คูณ/รวมจากค่าดิบใน DB (บาท) แล้วปัด 2 ตำแหน่งครั้งเดียวตอนท้าย (กัน float สะสม)
  // .populate("variant_id", "... variant_price") ไม่ผ่าน presenter — ปัดซ้อนอีกชั้นตรงนี้
  const line = priced.map((it) => {
    const lineTotal = (it.price_snapshot ?? 0) * (it.quantity ?? 0);
    const presented = presentCartItem(it);
    const unavailable_reason = cartItemUnavailableReason(it.product_id);
    return {
      ...presented,
      // สินค้าถูกลบ/ปิดการขายหลังหยิบใส่ตะกร้า — หน้าเว็บใช้แสดงป้าย + ให้ลูกค้านำออกก่อนสั่ง
      is_available: unavailable_reason === null,
      unavailable_reason,
      variant_id:
        presented.variant_id && typeof presented.variant_id === "object"
          ? toBahtFields(presented.variant_id, ["variant_price"] as const)
          : presented.variant_id,
      line_total: toBaht(lineTotal),
    };
  });
  const subtotalRaw = priced.reduce(
    (s, it) => s + (it.price_snapshot ?? 0) * (it.quantity ?? 0),
    0
  );
  const subtotal = toBaht(subtotalRaw);

  return {
    cart: { _id: cart._id, user_id: cart.user_id },
    items: line,
    summary: {
      item_count: line.length,
      unavailable_count: line.filter((it) => !it.is_available).length,
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
  await assertCartStock(cart._id, product, quantity);

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

  // ตรวจเฉพาะตอนเพิ่มจำนวน — ลดจำนวนได้เสมอ (สต็อกลดลงหลังหยิบใส่ตะกร้า ลูกค้าต้องลดให้พอดีได้)
  // สินค้าถูกลบไปแล้ว = ไม่ตรวจที่นี่ (getCartDetail ติด is_available: false และสั่งไม่ได้อยู่แล้ว)
  if (qty > item.quantity) {
    const product = await productModel
      .findOne({ _id: item.product_id, deleted_at: null })
      .select("product_name_th is_preorder product_stock_quantity")
      .lean<any>();
    if (product) await assertCartStock(cart._id, product, qty, item._id);
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
