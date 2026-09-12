/**
 * cartService — ตะกร้าสินค้าของลูกค้า (Carts + CartItems)
 *
 * - 1 ผู้ใช้ มี 1 ตะกร้า (สร้างอัตโนมัติเมื่อเรียกครั้งแรก)
 * - รับสินค้า product_type = "inStore" / "online" — สินค้าพรีออเดอร์ใช้ระบบ Preorders แยก
 * - ราคาต่อหน่วย (price_snapshot) คำนวณ ณ ตอนหยิบใส่ตะกร้า = ราคาสินค้า (sale_price ถ้ามี)
 *   + ส่วนเพิ่มของ variant + ผลรวม extra_price ของ options ที่เลือก
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
import productVariantModel from "../models/productVariantModel";
import productOptionModel from "../models/productOptionModel";
import userModel from "../models/userModel";
import { toBaht, toBahtFields } from "../lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SelectedOptionInput {
  option_id: string;
  text_value?: string | null;
}

export interface AddCartItemInput {
  product_id: string;
  variant_id?: string | null;
  selected_options?: SelectedOptionInput[];
  quantity: number;
}

interface ResolvedOption {
  option_id: any;
  option_name: string;
  extra_price: number;
  text_value: string | null;
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
    .populate("product_id", "product_name_th product_name_eng product_img product_type is_visible")
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

// ── helper: ตรวจ + คิดราคา option ที่เลือก ───────────────────
async function resolveOptions(
  productId: string,
  selected: SelectedOptionInput[] = []
): Promise<ResolvedOption[]> {
  if (!Array.isArray(selected) || selected.length === 0) return [];

  const ids = selected.map((s) => {
    assertObjectId(s.option_id, "option_id");
    return s.option_id;
  });

  const options = await productOptionModel
    .find({ _id: { $in: ids }, product_id: productId, deleted_at: null })
    .lean<any[]>();
  const byId = new Map(options.map((o) => [String(o._id), o]));

  return selected.map((sel) => {
    const opt = byId.get(String(sel.option_id));
    if (!opt) throw badRequest(`ไม่พบตัวเลือกเสริม ${sel.option_id} ของสินค้านี้`);

    let text: string | null = null;
    if (opt.is_text_input) {
      text = (sel.text_value ?? "").trim();
      if (opt.is_required && !text) {
        throw badRequest(`ตัวเลือก "${opt.option_name}" ต้องกรอกข้อความ`);
      }
      if (opt.max_text_length && text.length > opt.max_text_length) {
        throw badRequest(
          `ข้อความของ "${opt.option_name}" ยาวเกิน ${opt.max_text_length} ตัวอักษร`
        );
      }
      if (!text) text = null;
    }

    return {
      option_id: opt._id,
      option_name: opt.option_name,
      extra_price: opt.extra_price ?? 0,
      text_value: text,
    };
  });
}

function sameOptionSet(a: ResolvedOption[], b: any[]): boolean {
  if (a.length !== (b?.length ?? 0)) return false;
  const key = (o: any) => `${String(o.option_id)}::${o.text_value ?? ""}`;
  const setB = new Set(b.map(key));
  return a.every((o) => setB.has(key(o)));
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
  if (product.product_type === "preorder") {
    // ตะกร้าปกติรับเฉพาะ inStore/online — สินค้าพรีออเดอร์สั่งผ่านระบบ Preorders แยกต่างหาก
    throw badRequest("สินค้าพรีออเดอร์ต้องสั่งผ่านระบบพรีออเดอร์ ไม่สามารถเพิ่มลงตะกร้าปกติได้");
  }

  let variant: any = null;
  if (input.variant_id) {
    assertObjectId(input.variant_id, "variant_id");
    variant = await productVariantModel
      .findOne({ _id: input.variant_id, product_id: input.product_id, deleted_at: null })
      .lean<any>();
    if (!variant) throw badRequest("ไม่พบตัวเลือกสินค้า (variant) ของสินค้านี้");
  }

  const options = await resolveOptions(input.product_id, input.selected_options);

  // BACKLOG §3.11 เฟส 5b — product/variant/option ทั้ง 3 แหล่งเป็นสตางค์แล้วทั้งหมด (query ตรงจาก
  // model ข้าม service ที่มี presenter) price_snapshot ที่คำนวณตรงนี้จึงเป็นสตางค์โดยอัตโนมัติ ไม่ต้อง
  // toSatang() เองเลย (ต่างจาก resolveLine() ของ orderService สมัยเฟส 1 ที่ยังต้องแปลงตอนจบ เพราะตอน
  // นั้น product ยังเป็นบาทอยู่ — ตอนนี้ไม่มี "จุดข้ามโดเมน" แบบนั้นให้ต้องแปลงอีกแล้ว)
  const basePrice = product.sale_price ?? product.product_price;
  const variantPrice = variant?.variant_price ?? 0;
  const optionsPrice = options.reduce((s, o) => s + o.extra_price, 0);
  const price_snapshot = basePrice + variantPrice + optionsPrice;

  const cart = await getOrCreateCart(userId);

  // ถ้ามีรายการเหมือนกันเป๊ะอยู่แล้ว (สินค้า+variant+ชุด option เดียวกัน) → เพิ่มจำนวน
  const candidates = await cartItemModel.find({
    cart_id: cart._id,
    product_id: input.product_id,
    variant_id: input.variant_id ?? null,
    deleted_at: null,
  });

  const dup = candidates.find((c: any) => sameOptionSet(options, c.selected_options ?? []));
  if (dup) {
    dup.quantity += quantity;
    dup.price_snapshot = price_snapshot; // อัปเดตให้เป็นราคาปัจจุบัน
    await dup.save();
    return presentCartItem(dup.toObject());
  }

  const doc = await cartItemModel.create({
    cart_id: cart._id,
    product_id: input.product_id,
    variant_id: input.variant_id ?? null,
    selected_options: options,
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
      { new: true }
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
