/**
 * orderService — คำสั่งซื้อ (Orders + OrderItems)
 *
 * ขอบเขต: ออเดอร์ปกติ (สินค้า product_type = "inStore" / "online") เท่านั้น
 *   สินค้าพรีออเดอร์เก็บแยกคนละคอลเลกชัน (preorderModel / preorderItemModel) ไม่ปนกับ orderModel
 *
 * ครอบคลุม:
 *  - สร้างออเดอร์จากตะกร้า (createOrderFromCart) หรือระบุรายการเอง (createOrder เช่น หน้าร้าน/POS)
 *  - ออกเลขออเดอร์ OP-YYYYMMDD-XXXXXX (กันซ้ำด้วย unique index + retry)
 *  - ตัดสต็อกตอนสร้าง และคืนสต็อกตอนยกเลิก (ผ่าน productService)
 *  - state machine ของ order_status + จัดการสถานะจัดส่ง/ชำระเงิน
 *  - ปฏิเสธสินค้า product_type = "preorder" ทั้งใน createOrder และ createOrderFromCart
 *
 * ข้อจำกัดที่ทราบ:
 *  - MongoDB แบบ standalone ไม่มี transaction — ใช้แนวทาง best-effort + ชดเชย (คืนสต็อก/ลบออเดอร์) เมื่อผิดพลาด
 *  - ส่วนลดจากโปรโมชันคิดผ่าน promotionService.validateForOrder + discountEngine
 *    (ส่ง promotion_code/promotion_id มา ระบบคิดเอง — ไม่เชื่อ discount_amount จาก client เมื่อมีโปรโมชัน)
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { Saga } from "../lib/compensation";
import { badRequest, conflict, notFound, isHttpError } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import orderModel from "../models/orderModel";
import orderItemModel from "../models/orderItemModel";
import paymentModel from "../models/paymentModel";
import productModel from "../models/productModel";
import productVariantModel from "../models/productVariantModel";
import productOptionModel from "../models/productOptionModel";
import userModel from "../models/userModel";
import * as cartService from "./cartService";
import * as promotionService from "./promotionService";
import * as promotionUsageService from "./promotionUsageService";
import * as deliveryService from "./deliveryService";
import * as recipeService from "./recipeService";
import * as productService from "./productService";
import { notificationService } from "./notificationService";
import type { z } from "zod";
import type { updateDeliveryBody } from "../schemas/order";

type UpdateDeliveryInput = z.infer<typeof updateDeliveryBody>;

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DELIVERY_STATUSES = ["pending", "shipping", "delivered", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// state machine: สถานะปัจจุบัน → สถานะถัดไปที่อนุญาต
const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const ADDRESS_FIELDS = [
  "recipient_name",
  "recipient_phone",
  "house_no",
  "sub_district",
  "district",
  "province",
  "zip_code",
] as const;

// ── Types ────────────────────────────────────────────────────
export interface OrderLineInput {
  product_id: string;
  variant_id?: string | null;
  selected_options?: { option_id: string; text_value?: string | null }[];
  special_request?: string | null;
  quantity: number;
}

export interface CreateOrderCommon {
  order_type: "delivery" | "takeaway";
  delivery_address?: Record<string, string> | null;
  /** ใช้โปรโมชัน: ส่ง promotion_code หรือ promotion_id อย่างใดอย่างหนึ่ง — ระบบคิดส่วนลดเอง */
  promotion_code?: string | null;
  promotion_id?: string | null;
  /** ส่วนลดที่กรอกมือ (เฉพาะเมื่อไม่ได้ใช้โปรโมชัน — เช่น แอดมินลดให้หน้าร้าน) */
  discount_amount?: number;
  /** ค่าส่ง: ปกติระบบคิดเองจากที่อยู่ + ยอดสั่งซื้อ — ใส่ค่านี้ได้เฉพาะเมื่อ delivery_fee_override = true (แอดมิน) */
  delivery_fee?: number;
  /** true = ใช้ delivery_fee ที่ส่งมาแทนการคิดอัตโนมัติ (สำหรับแอดมิน/POS) */
  delivery_fee_override?: boolean;
  /** ช่องทางสำหรับตรวจ applicable_channels ของโปรโมชัน (ค่าเริ่มต้น "online") */
  channel?: "online" | "instore";
}

export interface CreateOrderFromCartInput extends CreateOrderCommon {
  item_notes?: Record<string, string>; // cartItemId -> special_request
}

export interface CreateOrderInput extends CreateOrderCommon {
  items: OrderLineInput[];
}

export interface ListOrderQuery {
  pagination: Pagination;
  user_id?: string;
  order_status?: OrderStatus;
  payment_status?: PaymentStatus;
  order_type?: "delivery" | "takeaway";
  search?: string;
  date_from?: string;
  date_to?: string;
  includeDeleted?: boolean;
  sort?: Record<string, 1 | -1>;
}

interface PricedLine {
  product_id: any;
  variant_id: any;
  product_snapshot: {
    product_name_th: string;
    product_name_eng: string;
    variant_name: string | null;
  };
  selected_options: {
    option_id: any;
    option_name: string;
    extra_price: number;
    text_value: string | null;
  }[];
  special_request: string | null;
  quantity: number;
  unit_price: number;
  cost_per_unit: number | null;
}

// ── helper: ออกเลขออเดอร์ ────────────────────────────────────
function randomOrderNo(now = new Date()): string {
  const ymd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `OP-${ymd}-${rand}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── helper: resolve รายการสั่งซื้อจาก input ดิบ (ใช้ตอนสั่งเองไม่ผ่านตะกร้า) ──
async function resolveLine(input: OrderLineInput): Promise<PricedLine> {
  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw badRequest("quantity ของแต่ละรายการต้องเป็นจำนวนเต็มตั้งแต่ 1");
  }
  assertObjectId(input.product_id, "product_id");

  const product = await productModel
    .findOne({ _id: input.product_id, deleted_at: null })
    .lean<any>();
  if (!product) throw notFound(`ไม่พบสินค้า ${input.product_id}`);
  if (product.product_type === "preorder") {
    throw badRequest(
      `สินค้า "${product.product_name_th}" เป็นสินค้าพรีออเดอร์ ต้องสั่งผ่านระบบพรีออเดอร์ (Preorders) ไม่ใช่ออเดอร์ปกติ`
    );
  }

  let variant: any = null;
  if (input.variant_id) {
    assertObjectId(input.variant_id, "variant_id");
    variant = await productVariantModel
      .findOne({ _id: input.variant_id, product_id: input.product_id, deleted_at: null })
      .lean<any>();
    if (!variant) throw badRequest("ไม่พบตัวเลือกสินค้า (variant) ของสินค้านี้");
  }

  const selected = input.selected_options ?? [];
  let options: PricedLine["selected_options"] = [];
  if (selected.length) {
    const ids = selected.map((s) => {
      assertObjectId(s.option_id, "option_id");
      return s.option_id;
    });
    const found = await productOptionModel
      .find({ _id: { $in: ids }, product_id: input.product_id, deleted_at: null })
      .lean<any[]>();
    const byId = new Map(found.map((o) => [String(o._id), o]));
    options = selected.map((sel) => {
      const opt = byId.get(String(sel.option_id));
      if (!opt) throw badRequest(`ไม่พบตัวเลือกเสริม ${sel.option_id} ของสินค้านี้`);
      let text: string | null = null;
      if (opt.is_text_input) {
        text = (sel.text_value ?? "").trim() || null;
        if (opt.is_required && !text) throw badRequest(`ตัวเลือก "${opt.option_name}" ต้องกรอกข้อความ`);
        if (text && opt.max_text_length && text.length > opt.max_text_length) {
          throw badRequest(`ข้อความของ "${opt.option_name}" ยาวเกิน ${opt.max_text_length} ตัวอักษร`);
        }
      }
      return {
        option_id: opt._id,
        option_name: opt.option_name,
        extra_price: opt.extra_price ?? 0,
        text_value: text,
      };
    });
  }

  const basePrice = product.sale_price ?? product.product_price;
  const unit_price =
    basePrice + (variant?.variant_price ?? 0) + options.reduce((s, o) => s + o.extra_price, 0);

  return {
    product_id: product._id,
    variant_id: variant?._id ?? null,
    product_snapshot: {
      product_name_th: product.product_name_th,
      product_name_eng: product.product_name_eng,
      variant_name: variant?.variant_name ?? null,
    },
    selected_options: options,
    special_request: input.special_request?.trim() || null,
    quantity,
    unit_price,
    cost_per_unit: null,
  };
}

// ── helper: บันทึกออเดอร์ + รายการ + ตัดสต็อก (best-effort) ──
async function persistOrder(
  userId: string,
  lines: PricedLine[],
  opts: CreateOrderCommon
) {
  if (lines.length === 0) throw badRequest("ออเดอร์ต้องมีอย่างน้อย 1 รายการ");

  if (opts.order_type === "delivery") {
    const addr = opts.delivery_address ?? null;
    if (!addr) throw badRequest("การจัดส่งแบบ delivery ต้องระบุ delivery_address");
    for (const f of ADDRESS_FIELDS) {
      if (!addr[f]) throw badRequest(`delivery_address.${f} จำเป็นต้องระบุ`);
    }
  }
  // ต้นทุนต่อหน่วย (snapshot จากสูตรล่าสุดของสินค้า) — ใส่ลง orderItem เพื่อคำนวณกำไรใน dashboard
  const costByProduct = await recipeService.getUnitCostByProduct(
    lines.map((l) => String(l.product_id))
  );

  const itemsPayload = lines.map((l) => ({
    ...l,
    total_price: l.unit_price * l.quantity,
    cost_per_unit: costByProduct.get(String(l.product_id)) ?? l.cost_per_unit ?? null,
  }));
  const subtotal = round2(itemsPayload.reduce((s, it) => s + it.total_price, 0));

  // ── ค่าส่ง: คิดฝั่ง server เสมอ (เว้นแต่แอดมินสั่ง override) ──
  let delivery_fee = 0;
  if (opts.order_type === "delivery") {
    if (opts.delivery_fee_override && opts.delivery_fee != null) {
      delivery_fee = Math.max(0, Number(opts.delivery_fee) || 0);
    } else {
      delivery_fee = (
        await deliveryService.calcDeliveryFee({
          province: opts.delivery_address?.province ?? null,
          subtotal,
        })
      ).fee;
    }
  }

  // ── ส่วนลด: ใช้โปรโมชัน (ระบบคิดเอง) หรือส่วนลดกรอกมือ ──
  let discount_amount = 0;
  let appliedPromotion: { promotion_id: string; discount_amount: number } | null = null;

  if (opts.promotion_code || opts.promotion_id) {
    const prodIds = [...new Set(lines.map((l) => String(l.product_id)))];
    const prods = await productModel
      .find({ _id: { $in: prodIds } })
      .select("category_id")
      .lean<Array<{ _id: any; category_id?: any }>>();
    const catByProduct = new Map(
      prods.map((p) => [String(p._id), p.category_id ? String(p.category_id) : null])
    );
    const discountLines = lines.map((l) => ({
      product_id: String(l.product_id),
      category_id: catByProduct.get(String(l.product_id)) ?? null,
      quantity: l.quantity,
      line_total: round2(l.unit_price * l.quantity),
    }));

    const result = await promotionService.validateForOrder({
      code: opts.promotion_code ?? undefined,
      promotion_id: opts.promotion_id ?? undefined,
      user_id: userId,
      lines: discountLines,
      subtotal,
      delivery_fee,
      channel: opts.channel ?? "online",
    });
    discount_amount = result.discount_amount;
    appliedPromotion = { promotion_id: result.promotion_id, discount_amount };
  } else {
    discount_amount = Math.max(0, Number(opts.discount_amount) || 0);
  }

  if (discount_amount > subtotal + delivery_fee) {
    throw badRequest("ส่วนลดมากกว่ายอดที่ต้องชำระ");
  }
  const total_amount = round2(subtotal - discount_amount + delivery_fee);

  const stockItems = lines.map((l) => ({
    product_id: String(l.product_id),
    quantity: l.quantity,
  }));

  // ── สร้างออเดอร์แบบ best-effort + ชดเชยผ่าน Saga (MongoDB standalone ไม่มี transaction) ──
  const saga = new Saga();
  let order: any = null;
  try {
    // 1) ตัดสต็อก (productService ข้าม preorder ให้เอง, คืนสต็อกอัตโนมัติถ้ารายการใดไม่พอ)
    await productService.deductStockForOrder(stockItems);
    saga.onRollback("restock", () => productService.restockForOrder(stockItems));

    // 2) สร้างออเดอร์ (retry เมื่อเลขออเดอร์ชนกัน)
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      try {
        order = await orderModel.create({
          order_no: randomOrderNo(),
          user_id: userId,
          order_type: opts.order_type,
          delivery_address: opts.order_type === "delivery" ? opts.delivery_address : null,
          subtotal,
          discount_amount,
          delivery_fee,
          total_amount,
          promotion_id: appliedPromotion?.promotion_id ?? opts.promotion_id ?? null,
        });
      } catch (err: any) {
        if (err?.code === 11000 && attempt < 4) continue;
        throw err;
      }
    }
    saga.onRollback("delete-order", () => orderModel.deleteOne({ _id: order._id }));

    // 3) สร้าง order items
    await orderItemModel.insertMany(
      itemsPayload.map((it) => ({ ...it, order_id: order._id }))
    );
    saga.onRollback("delete-order-items", () => orderItemModel.deleteMany({ order_id: order._id }));

    // 4) บันทึกการใช้โปรโมชัน — จองสิทธิ์แบบ atomic (กันใช้เกิน usage_limit / per-user)
    //    computeDiscount reject ส่วนลด 0 ไปแล้ว → มี appliedPromotion = discount > 0 เสมอ
    //    limit เต็ม (HttpError 422) = reject จริง → โยนต่อให้ saga.rollback ล้มออเดอร์
    //    error อื่น (transient) = best-effort ไม่ล้มออเดอร์ที่สร้างสำเร็จแล้ว
    //    (recordUsage rollback used_count ของตัวเองแล้ว จึงไม่ต้อง onRollback ที่นี่)
    if (appliedPromotion) {
      try {
        await promotionUsageService.recordUsage({
          promotion_id: appliedPromotion.promotion_id,
          user_id: userId,
          order_id: String(order._id),
          discount_applied: appliedPromotion.discount_amount,
        });
      } catch (e) {
        if (isHttpError(e) && e.status === 422) throw e;
        log.error("order.record_usage_failed", { order_id: String(order._id), err: e });
      }
    }

    saga.commit();
  } catch (err) {
    await saga.rollback();
    throw err;
  }

  // แจ้งเตือนออเดอร์ใหม่ (DB + LINE) — best-effort ไม่ทำให้สร้างออเดอร์ล้มเหลวถ้าแจ้งเตือนพัง
  notificationService
    .notify({
      title: `ออเดอร์ใหม่ ${order.order_no}`,
      message: `ยอดรวม ${total_amount.toLocaleString("th-TH")} บาท`,
      module: "order",
      type: "info",
      link: `/owner/orders/manageOrders?id=${order._id}`,
    })
    .catch((err) => log.error("order.notify_failed", { order_id: String(order._id), err }));

  return getOrderById(String(order._id));
}

// ── CREATE จากตะกร้า ────────────────────────────────────────
export async function createOrderFromCart(
  userId: string,
  input: CreateOrderFromCartInput
) {
  await dbConnect();
  await assertRefExists(userModel, userId, "ผู้ใช้", "user_id");

  const detail = await cartService.getCartDetail(userId);
  if (detail.items.length === 0) throw badRequest("ตะกร้าว่าง ไม่สามารถสร้างออเดอร์ได้");

  // ออเดอร์ปกติเก็บเฉพาะ inStore/online — สินค้าพรีออเดอร์ต้องไปทางระบบ Preorders (preorderModel)
  const preorderInCart = (detail.items as any[]).find(
    (it) => it.product_id?.product_type === "preorder"
  );
  if (preorderInCart) {
    const name = preorderInCart.product_id?.product_name_th ?? "บางรายการ";
    throw badRequest(
      `ในตะกร้ามีสินค้าพรีออเดอร์ ("${name}") กรุณานำออกก่อน แล้วสั่งผ่านระบบพรีออเดอร์แทน`
    );
  }

  // re-price ทุกบรรทัดจากราคาปัจจุบัน — ไม่เชื่อ price_snapshot ที่แช่ไว้ตอนหยิบใส่ตะกร้า
  // ใช้ resolveLine ตัวเดียวกับ path สั่งเอง (POS): ได้ราคา/ชื่อสินค้าสด + re-validate ว่าสินค้า/variant/option ยังมีอยู่
  const notes = input.item_notes ?? {};
  const lines: PricedLine[] = [];
  for (const it of detail.items as any[]) {
    const product = it.product_id ?? {};
    const variant = it.variant_id ?? null;
    lines.push(
      await resolveLine({
        product_id: String(product._id ?? it.product_id),
        variant_id: variant?._id ? String(variant._id) : null,
        selected_options: (it.selected_options ?? [])
          .filter((o: any) => o?.option_id != null)
          .map((o: any) => ({
            option_id: String(o.option_id),
            text_value: o.text_value ?? null,
          })),
        special_request: notes[String(it._id)] ?? null,
        quantity: it.quantity,
      })
    );
  }

  const order = await persistOrder(userId, lines, input);
  // เคลียร์ตะกร้า — best-effort เหมือน notify ด้านบน: ออเดอร์ commit สำเร็จไปแล้ว (persistOrder
  // saga.commit() แล้ว) ถ้า clearCart พังไม่ควรทำให้ client เห็น 500 ทั้งที่ออเดอร์สร้างสำเร็จจริง
  // (BACKLOG 2c.1 — เดิมไม่มี .catch() จุดเดียวในไฟล์นี้ที่รันหลัง commit แล้วไม่กันพัง)
  await cartService
    .clearCart(userId)
    .catch((err) => log.error("order.clear_cart_failed", { user_id: userId, order_id: String(order._id), err }));
  return order;
}

// ── CREATE โดยระบุรายการเอง ─────────────────────────────────
export async function createOrder(userId: string, input: CreateOrderInput) {
  await dbConnect();
  await assertRefExists(userModel, userId, "ผู้ใช้", "user_id");

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw badRequest("ต้องระบุ items อย่างน้อย 1 รายการ");
  }
  const lines: PricedLine[] = [];
  for (const raw of input.items) lines.push(await resolveLine(raw));

  return persistOrder(userId, lines, input);
}

// ── READ ────────────────────────────────────────────────────
export async function listOrders(query: ListOrderQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (query.user_id) {
    assertObjectId(query.user_id, "user_id");
    filter.user_id = query.user_id;
  }
  if (query.order_status) filter.order_status = query.order_status;
  if (query.payment_status) filter.payment_status = query.payment_status;
  if (query.order_type) filter.order_type = query.order_type;
  if (query.search) {
    filter.order_no = new RegExp(escapeRegExp(query.search.trim()), "i");
  }
  if (query.date_from || query.date_to) {
    filter.created_at = {};
    if (query.date_from) filter.created_at.$gte = new Date(query.date_from);
    if (query.date_to) filter.created_at.$lte = new Date(query.date_to);
  }

  const [items, total] = await Promise.all([
    orderModel
      .find(filter)
      .sort(query.sort ?? { created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("user_id", "user_fullname email user_phone")
      .lean(),
    orderModel.countDocuments(filter),
  ]);

  return { items, meta: buildMeta(total, query.pagination) };
}

export async function getOrderById(id: string, opts: { includeDeleted?: boolean } = {}) {
  await dbConnect();
  assertObjectId(id);

  const filter: Record<string, any> = { _id: id };
  if (!opts.includeDeleted) filter.deleted_at = null;

  const order = await orderModel
    .findOne(filter)
    .populate("user_id", "user_fullname email user_phone")
    .lean<any>();
  if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");

  const items = await orderItemModel
    .find({ order_id: order._id, deleted_at: null })
    .lean();
  return { ...order, items };
}

export async function getOrderByNo(orderNo: string) {
  await dbConnect();
  const order = await orderModel
    .findOne({ order_no: orderNo, deleted_at: null })
    .populate("user_id", "user_fullname email user_phone")
    .lean<any>();
  if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");
  const items = await orderItemModel.find({ order_id: order._id, deleted_at: null }).lean();
  return { ...order, items };
}

// ── เปลี่ยนสถานะออเดอร์ (state machine) ─────────────────────
export async function updateOrderStatus(
  id: string,
  next: OrderStatus,
  opts: { cancelled_by?: string; cancelled_reason?: string } = {}
) {
  await dbConnect();
  assertObjectId(id);
  if (!ORDER_STATUSES.includes(next)) {
    throw badRequest(`order_status ต้องเป็นหนึ่งใน: ${ORDER_STATUSES.join(", ")}`);
  }

  const order = await orderModel.findOne({ _id: id, deleted_at: null });
  if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");

  const current = order.order_status as OrderStatus;
  if (current === next) return getOrderById(id);
  if (!NEXT_STATUS[current].includes(next)) {
    throw conflict(`เปลี่ยนสถานะจาก "${current}" เป็น "${next}" ไม่ได้`);
  }

  if (next === "cancelled") {
    // cleanup ตอนยกเลิก — best-effort ทั้งหมด (step ที่ fail จะ log ผ่าน logger ไม่ล้มการยกเลิก)
    // ใช้ Saga เพื่อ log สม่ำเสมอ แทน .catch(() => undefined) ที่กลืน error เงียบ
    const cleanup = new Saga();

    const items = await orderItemModel.find({ order_id: order._id, deleted_at: null }).lean<any[]>();
    const stockItems = items.map((it) => ({
      product_id: String(it.product_id),
      quantity: it.quantity,
    }));
    if (stockItems.length) {
      cleanup.onRollback("restock", () => productService.restockForOrder(stockItems));
    }
    cleanup.onRollback("revoke-promo-usage", () =>
      promotionUsageService.revokeUsage({ order_id: String(order._id) })
    );

    // ออเดอร์ที่จ่ายเงินแล้ว → คืนเงินอัตโนมัติ · ป้องกัน "order = cancelled แต่ payment ยัง paid" (BACKLOG 2.8)
    if (order.payment_status === "paid") {
      const paidPayment = await paymentModel
        .findOne({ order_id: order._id, status: "paid", deleted_at: null })
        .lean<{ _id: unknown } | null>();
      if (paidPayment && opts.cancelled_by) {
        const verifiedBy = opts.cancelled_by;
        cleanup.onRollback("auto-refund", async () => {
          // dynamic import — เลี่ยง circular import (paymentService → orderService)
          const { refundPayment } = await import("./paymentService");
          await refundPayment(String(paidPayment._id), { verified_by: verifiedBy });
        });
      } else {
        log.warn("order.auto_refund_skipped", {
          order_id: String(order._id),
          reason: "ไม่พบ payment ที่ paid หรือไม่มี cancelled_by",
        });
      }
    }

    await cleanup.rollback();

    order.cancelled_at = new Date();
    if (opts.cancelled_by) {
      assertObjectId(opts.cancelled_by, "cancelled_by");
      order.cancelled_by = opts.cancelled_by;
    }
    order.cancelled_reason = opts.cancelled_reason ?? null;
  }

  order.order_status = next;
  await order.save();
  return getOrderById(id);
}

/** สถานะที่ "ลูกค้า" ยกเลิกออเดอร์เองได้ — พอร้านเริ่มเตรียม (preparing ขึ้นไป) ต้องติดต่อร้าน */
export const CUSTOMER_CANCELABLE_STATUSES: readonly OrderStatus[] = ["pending", "confirmed"];

export async function cancelOrder(
  id: string,
  opts: {
    cancelled_by?: string;
    cancelled_reason?: string;
    /** ถ้าระบุ: ยกเลิกได้เฉพาะเมื่อสถานะปัจจุบันอยู่ในลิสต์นี้ (ใช้จำกัดสิทธิ์ฝั่งลูกค้า — แอดมินไม่ส่ง = ยกเลิกได้ทุกสถานะที่ยังไม่ completed) */
    allowedFrom?: readonly OrderStatus[];
  } = {}
) {
  const { allowedFrom, ...rest } = opts;
  if (allowedFrom) {
    await dbConnect();
    assertObjectId(id);
    const order = await orderModel
      .findOne({ _id: id, deleted_at: null })
      .select("order_status payment_status")
      .lean<{ order_status: OrderStatus; payment_status?: PaymentStatus } | null>();
    if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");
    if (!allowedFrom.includes(order.order_status)) {
      throw conflict(
        `ยกเลิกออเดอร์เองได้เฉพาะตอนสถานะ ${allowedFrom.join(" / ")} เท่านั้น ` +
          `(สถานะปัจจุบัน: "${order.order_status}") — หากต้องการยกเลิกกรุณาติดต่อร้าน`
      );
    }
    // ออเดอร์ที่ชำระเงินแล้ว: ลูกค้ายกเลิกเองไม่ได้ — ต้องให้แอดมินยกเลิก + คืนเงิน (refundPayment)
    // ไม่งั้นจะได้ order_status = cancelled แต่ payment_status ยัง paid โดยไม่มี refund record
    if (order.payment_status === "paid") {
      throw conflict(
        "ออเดอร์นี้ชำระเงินแล้ว ยกเลิกเองไม่ได้ — กรุณาติดต่อร้านเพื่อขอยกเลิกและคืนเงิน"
      );
    }
  }
  return updateOrderStatus(id, "cancelled", rest);
}

// ── อัปเดตสถานะการชำระเงิน (เรียกจาก paymentService) ────────
export async function setPaymentStatus(orderId: string, status: PaymentStatus, paymentId?: string) {
  await dbConnect();
  assertObjectId(orderId, "order_id");
  if (!PAYMENT_STATUSES.includes(status)) {
    throw badRequest(`payment_status ต้องเป็นหนึ่งใน: ${PAYMENT_STATUSES.join(", ")}`);
  }
  const set: Record<string, any> = { payment_status: status };
  if (paymentId) set.payment_id = paymentId;

  const order = await orderModel
    .findOneAndUpdate({ _id: orderId, deleted_at: null }, { $set: set }, { new: true })
    .lean<any>();
  if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");

  // จ่ายเงินสำเร็จ + ออเดอร์ยัง pending → ยืนยันออเดอร์อัตโนมัติ
  if (status === "paid" && order.order_status === "pending") {
    await orderModel.updateOne({ _id: orderId }, { $set: { order_status: "confirmed" } });
  }
  return order;
}

// ── อัปเดตข้อมูลการจัดส่ง ───────────────────────────────────
// delivery_status enum validate ที่ route ผ่าน schemas/order.ts updateDeliveryBody แล้ว
export async function updateDelivery(id: string, input: UpdateDeliveryInput) {
  await dbConnect();
  assertObjectId(id);

  const order = await orderModel.findOne({ _id: id, deleted_at: null });
  if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");
  if (order.order_type !== "delivery") {
    throw badRequest("ออเดอร์นี้ไม่ใช่ประเภทจัดส่ง (delivery)");
  }

  const payload: Record<string, any> = { ...input };
  if (payload.delivery_status === "shipping" && !order.shipped_at && !payload.shipped_at) {
    payload.shipped_at = new Date();
  }
  if (payload.delivery_status === "delivered" && !payload.delivered_at) {
    payload.delivered_at = new Date();
  }

  const updated = await orderModel
    .findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true })
    .lean();
  return updated;
}

// ── DELETE (soft) ───────────────────────────────────────────
export async function deleteOrder(id: string) {
  await dbConnect();
  assertObjectId(id);
  const order = await orderModel.findOne({ _id: id, deleted_at: null });
  if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ หรือถูกลบไปแล้ว");
  if (!["completed", "cancelled"].includes(order.order_status)) {
    throw conflict("ลบได้เฉพาะออเดอร์ที่เสร็จสิ้นหรือถูกยกเลิกแล้วเท่านั้น");
  }
  order.deleted_at = new Date();
  await order.save();
  await orderItemModel.updateMany(
    { order_id: order._id, deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  return { deleted: true, _id: order._id };
}
