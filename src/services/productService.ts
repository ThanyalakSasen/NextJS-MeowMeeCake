import { Types } from "mongoose";

type Filter = Record<string, unknown>;
import dbConnect from "../lib/dbConnect";
import { HttpError } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import { softDeleteDoc, restoreDoc } from "../lib/crudService";
import {
  generateProductCode,
  isProductCode,
  isPreorderProduct,
  productCodePrefix,
} from "../lib/productCode";
import productModel from "../models/productModel";
import productCategoryModel from "../models/productCategoryModel";
import productVariantModel from "../models/productVariantModel";
import { getProductCustomization, productIdsWithCustomization } from "./productCustomizationService";
import * as searchSynonymService from "./searchSynonymService";
import unitModel from "../models/unitModel";
import { notificationService } from "./notificationService";
import { log } from "../lib/logger";
import { deleteImages } from "../lib/upload";
import { toSatang, toBahtFields } from "../lib/money";
import { adminLinks } from "../lib/adminLinks";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  LOW_STOCK_EXPR,
  crossedLowStock,
  effectiveLowStockThreshold,
} from "../lib/lowStock";

/**
 * แจ้งเจ้าของร้าน (DB + LINE) ตอนสต็อกสินค้า "เพิ่งข้าม" เกณฑ์ใกล้หมดของสินค้านั้นลงมา — กัน spam ทุกครั้งที่ต่ำอยู่แล้ว
 * เกณฑ์ = products.low_stock_threshold (ไม่ตั้ง = 5 — src/lib/lowStock.ts)
 * ใช้ร่วมทุกทางที่ลดสต็อก: ขาย (deductStockForOrder) + ปรับเอง (setStock/adjustStock — นับสต็อก/ตัดของเสีย)
 * best-effort ไม่ throw (docs/LINE.md §9.2, §9.5)
 */
function notifyIfLowStockCrossed(
  product: { _id: unknown; product_name_th?: string; low_stock_threshold?: number | null },
  before: number,
  after: number
): void {
  const threshold = effectiveLowStockThreshold(product);
  if (!crossedLowStock(threshold, before, after)) return;
  // หมายเหตุ: enum module ไม่มีหมวด "product" แยก — ใช้ "ingredient" ร่วมกัน (หมวดสต็อกสินค้าคงคลัง)
  notificationService
    .notify({
      title: `สินค้าใกล้จะหมด: ${product.product_name_th}`,
      message: `คงเหลือ ${after} ชิ้น (เกณฑ์แจ้งเตือน ${threshold})`,
      module: "ingredient",
      type: "warning",
      link: adminLinks.product(product._id),
    })
    .catch((err) => log.error("product.notify_failed", { product_id: String(product._id), err }));
}

// purchase_cost / product_price / sale_price — เงินเก็บเป็นบาท ทศนิยม 2 ตำแหน่ง (docs/money-units.md) · presenter แค่ปัดก่อนคืน
// (หลังร้านเท่านั้น — API สาธารณะใช้ toPublicProduct() ที่ไม่มี purchase_cost · BACKLOG5 R1)
function presentProduct<T extends Record<string, unknown>>(product: T): T {
  return toBahtFields(product, ["purchase_cost", "product_price", "sale_price"] as const);
}

/**
 * productService — CRUD + จัดการสต็อกของสินค้า (Products)
 *
 * ทุกฟังก์ชันเป็น service function ที่ไม่ผูกกับ framework
 * เรียกใช้ได้จาก Next.js Route Handler (src/app/api/products/**) / Server Action
 * ใช้แนวทาง soft delete ผ่านฟิลด์ deleted_at เหมือน model อื่นในโปรเจกต์
 */

// ── Types ─────────────────────────────────────────────────────
export interface PreorderConfigInput {
  min_order_qty: number;
  max_order_qty: number;
  lead_time_days: number;
}

export interface CreateProductInput {
  product_name_th: string;
  product_name_eng: string;
  category_id: string;
  product_price: number;
  unit_id: string;
  /**
   * true = สินค้าพรีออเดอร์ (รหัส pre-, ต้องมี preorder_config, ไม่มีสต็อก) · false/ไม่ส่ง = สินค้าปกติ (รหัส pos-, มีสต็อก)
   * ช่องทางขาย (เว็บ/หน้าร้าน) ไม่ได้ผูกกับสินค้าแล้ว — ดูจากออเดอร์ (ORD-/POS-) · ซ่อนจากเว็บใช้ is_visible
   */
  is_preorder?: boolean;
  sale_price?: number | null;
  is_visible?: boolean;
  product_img?: string[];
  product_description?: string | null;
  preparation_heating?: string | null;
  yield_per_batch?: number | null;
  /** ต้นทุนต่อหน่วยกรอกมือ (BACKLOG §3.16) — ใช้เฉพาะสินค้าที่ไม่มีสูตรการผลิต ดู recipeService.getUnitCostByProduct */
  purchase_cost?: number | null;
  product_stock_quantity?: number | null;
  /** เกณฑ์สินค้าใกล้หมดรายสินค้า (จำนวนเต็ม ≥ 0) · null/ไม่ส่ง = ใช้ค่าเริ่มต้น 5 (src/lib/lowStock.ts) */
  low_stock_threshold?: number | null;
  preorder_config?: PreorderConfigInput | null;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export interface ListProductQuery {
  pagination: Pagination;
  search?: string;
  /** true = ขยายคำค้นด้วยกลุ่มคำพ้อง (หน้าร้าน · searchSynonymService — customer-backend-merge.md §8.16) */
  expandSynonyms?: boolean;
  category_id?: string;
  /** true = เฉพาะพรีออเดอร์ · false = เฉพาะสินค้าปกติ · ไม่ส่ง = ทั้งหมด */
  is_preorder?: boolean;
  is_visible?: boolean;
  includeDeleted?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** field ที่อนุญาตให้เรียง (ค่าเริ่มต้น ADMIN_PRODUCT_SORTS) — หน้าร้านส่ง PUBLIC_PRODUCT_SORTS (BACKLOG5 Y5) */
  sortable?: readonly string[];
}

/** field ที่หลังร้านเรียงได้ — นอกรายการ = 400 (เดิมรับชื่อ field อะไรก็ได้ · BACKLOG5 Y5) */
export const ADMIN_PRODUCT_SORTS = [
  "created_at",
  "updated_at",
  "product_id",
  "product_name_th",
  "product_name_eng",
  "product_price",
  "sale_price",
  "purchase_cost",
  "product_stock_quantity",
  "avg_rating",
  "review_count",
] as const;

// ── Errors ────────────────────────────────────────────────────
/** error เฉพาะโดเมนสินค้า — สืบทอด HttpError กลาง เพื่อให้ route handler แปลงเป็น status code ได้เลย */
export class ProductError extends HttpError {
  constructor(message: string, status = 400) {
    const code =
      status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "BAD_REQUEST";
    super(message, status, code);
    this.name = "ProductError";
  }
}

/** low_stock_threshold: null = ใช้ค่าเริ่มต้น · ไม่งั้นต้องเป็นจำนวนเต็ม ≥ 0 */
function assertLowStockThreshold(value: unknown): void {
  if (value == null) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ProductError("low_stock_threshold ต้องเป็นจำนวนเต็มไม่ติดลบ (หรือ null = ใช้ค่าเริ่มต้น)", 400);
  }
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  assertObjectId(categoryId, "category_id");
  const found = await productCategoryModel
    .exists({ _id: categoryId, deleted_at: null })
    .lean();
  if (!found) {
    throw new ProductError("ไม่พบหมวดหมู่สินค้าที่ระบุ", 404);
  }
}

async function assertUnitExists(unitId: string): Promise<void> {
  assertObjectId(unitId, "unit_id");
  const found = await unitModel
    .exists({ _id: unitId, deleted_at: null })
    .lean();
  if (!found) {
    throw new ProductError("ไม่พบหน่วยสินค้าที่ระบุ", 404);
  }
}

/**
 * ตรวจความสอดคล้องระหว่าง is_preorder กับฟิลด์ที่เกี่ยวข้อง
 * - สินค้าปกติ (is_preorder: false) — ห้ามมี preorder_config
 * - พรีออเดอร์ (is_preorder: true) — ต้องมี preorder_config ที่ถูกต้อง, product_stock_quantity ต้องเป็น null
 */
function validateTypeConsistency(isPreorder: boolean, data: UpdateProductInput): void {
  if (!isPreorder) {
    if (data.preorder_config != null) {
      throw new ProductError("สินค้าปกติ (is_preorder: false) ต้องไม่มี preorder_config", 400);
    }
    return;
  }

  const cfg = data.preorder_config;
  if (!cfg) {
    throw new ProductError("สินค้าพรีออเดอร์ (is_preorder: true) ต้องระบุ preorder_config", 400);
  }
  if (cfg.min_order_qty == null || cfg.max_order_qty == null || cfg.lead_time_days == null) {
    throw new ProductError("preorder_config ต้องมี min_order_qty, max_order_qty และ lead_time_days", 400);
  }
  if (cfg.min_order_qty < 1 || cfg.max_order_qty < 1 || cfg.lead_time_days < 1) {
    throw new ProductError("ค่าใน preorder_config ต้องมากกว่าหรือเท่ากับ 1", 400);
  }
  if (cfg.max_order_qty < cfg.min_order_qty) {
    throw new ProductError("max_order_qty ต้องไม่น้อยกว่า min_order_qty", 400);
  }
  if (data.product_stock_quantity != null) {
    throw new ProductError("สินค้าพรีออเดอร์ (is_preorder: true) ต้องไม่มี product_stock_quantity", 400);
  }
}

/**
 * เตรียมฟิลด์ประเภทจาก request ก่อน validate — ปฏิเสธฟิลด์เก่าชัด ๆ (ถ้าปล่อยผ่าน mongoose จะทิ้งเงียบ ๆ
 * เพราะไม่อยู่ใน schema → client ที่ยังส่งแบบเดิมจะแก้ประเภทไม่ได้โดยไม่รู้ตัว):
 *   product_type (string, รุ่นแรก) / product_types (array, รุ่น 2026-09-24) → 400 ให้ส่ง is_preorder แทน
 * is_preorder ต้องเป็น boolean
 */
function normalizeTypesInput(input: UpdateProductInput): void {
  const raw = input as Record<string, unknown>;
  for (const legacy of ["product_type", "product_types"]) {
    if (legacy in raw) {
      throw new ProductError(
        `ฟิลด์ ${legacy} เลิกใช้แล้ว — ส่ง is_preorder (true = พรีออเดอร์ / false = สินค้าปกติ) แทน ` +
          "ช่องทางขาย (เว็บ/หน้าร้าน) ดูจากออเดอร์ ไม่ได้ผูกกับสินค้าแล้ว",
        400
      );
    }
  }
  if (input.is_preorder !== undefined && typeof input.is_preorder !== "boolean") {
    throw new ProductError("is_preorder ต้องเป็น true หรือ false", 400);
  }
}

// ── CREATE ────────────────────────────────────────────────────
export async function createProduct(input: CreateProductInput) {
  await dbConnect();
  normalizeTypesInput(input);

  const required: (keyof CreateProductInput)[] = [
    "product_name_th",
    "product_name_eng",
    "category_id",
    "product_price",
    "unit_id",
  ];
  for (const field of required) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      throw new ProductError(`กรุณาระบุ ${field}`, 400);
    }
  }
  const isPreorder = input.is_preorder === true;

  if (input.product_price < 0) {
    throw new ProductError("product_price ต้องไม่ติดลบ", 400);
  }
  if (input.sale_price != null && input.sale_price < 0) {
    throw new ProductError("sale_price ต้องไม่ติดลบ", 400);
  }
  if (input.purchase_cost != null && input.purchase_cost < 0) {
    throw new ProductError("purchase_cost ต้องไม่ติดลบ", 400);
  }
  assertLowStockThreshold(input.low_stock_threshold);

  await assertCategoryExists(input.category_id);
  await assertUnitExists(input.unit_id);
  validateTypeConsistency(isPreorder, input);

  const payload = {
    product_name_th: input.product_name_th,
    product_name_eng: input.product_name_eng,
    category_id: input.category_id,
    // BACKLOG §3.11 เฟส 5b — input.product_price/sale_price เป็นบาทจาก request เสมอ (API contract)
    product_price: toSatang(Number(input.product_price)),
    sale_price: input.sale_price != null ? toSatang(Number(input.sale_price)) : null,
    is_visible: input.is_visible ?? true,
    product_img: input.product_img ?? [],
    product_description: input.product_description ?? null,
    preparation_heating: input.preparation_heating ?? null,
    yield_per_batch: input.yield_per_batch ?? null,
    purchase_cost: input.purchase_cost != null ? toSatang(Number(input.purchase_cost)) : null,
    unit_id: input.unit_id,
    is_preorder: isPreorder,
    product_stock_quantity: isPreorder ? null : input.product_stock_quantity ?? 0,
    // พรีออเดอร์ไม่มีสต็อก → ไม่มีเกณฑ์ใกล้หมด
    low_stock_threshold: isPreorder ? null : input.low_stock_threshold ?? null,
    preorder_config: isPreorder ? input.preorder_config : null,
  };

  // สร้างรหัสสินค้า (product_id) แบบสุ่ม + retry เมื่อชนกับที่มีอยู่
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any = null;
  for (let attempt = 0; attempt < 20 && !doc; attempt++) {
    try {
      doc = await productModel.create({
        ...payload,
        product_id: generateProductCode(isPreorder),
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 11000 && attempt < 19) continue; // ชน product_id ที่สุ่มได้ → สุ่มใหม่
      if (code === 11000) {
        throw new ProductError("สร้างรหัสสินค้าไม่สำเร็จ (รหัสสุ่มชนกันหลายครั้ง) กรุณาลองใหม่", 409);
      }
      throw err;
    }
  }

  return presentProduct(doc.toObject());
}

// ── READ by รหัสสินค้า (product_id เช่น "pos-0126487") ────────
export async function getProductByCode(
  code: string,
  options: { includeDeleted?: boolean } = {}
) {
  await dbConnect();
  const filter: Filter = { product_id: String(code).trim() };
  if (!options.includeDeleted) filter.deleted_at = null;

  const product = await productModel
    .findOne(filter)
    .populate("category_id", "product_category_name")
    .populate("unit_id", "unit_name unit_abbr")
    .lean();
  if (!product) throw new ProductError("ไม่พบสินค้าตามรหัสที่ระบุ", 404);
  return presentProduct(product);
}

/**
 * resolveScan — ใช้กับการสแกนหน้าร้าน: รับได้ทั้งรหัสสินค้า (pos-/pre-...) หรือ _id ดิบ
 * คืนสินค้า + ราคาปัจจุบัน + สต็อก + variants + customization (กลุ่มตัวเลือก/ออปชัน — ถ้ามี ให้ POS เลือกก่อนเพิ่มลงบิล
 * แล้วส่ง variant_ids + selected_options มากับรายการ · ตัวเลือกไม่มีสต็อกแยก)
 */
export async function resolveScan(code: string) {
  await dbConnect();
  const raw = String(code ?? "").trim();
  if (!raw) throw new ProductError("กรุณาระบุรหัส/บาร์โค้ดที่สแกน", 400);

  let product: Record<string, unknown>;
  if (isProductCode(raw)) {
    product = (await getProductByCode(raw)) as Record<string, unknown>;
  } else if (Types.ObjectId.isValid(raw)) {
    product = (await getProductById(raw)) as Record<string, unknown>;
  } else {
    throw new ProductError("รูปแบบรหัสที่สแกนไม่ถูกต้อง", 400);
  }

  const [variants, customization] = await Promise.all([
    productVariantModel
      .find({ product_id: product._id, deleted_at: null })
      .select("group_id variant_name variant_price unit_id display_order")
      .sort({ display_order: 1, created_at: 1 })
      .lean(),
    getProductCustomization(String(product._id)),
  ]);

  return {
    product,
    current_price: (product.sale_price as number | null) ?? (product.product_price as number),
    stock: (product.product_stock_quantity as number | null) ?? null,
    variants,
    customization,
  };
}

// ── READ (list สำหรับ POS) ────────────────────────────────────
/** ฟิลด์ที่ POS ใช้ — ไม่มี purchase_cost (พนักงานหน้าร้านที่มีแค่สิทธิ์ orders ไม่ควรเห็นต้นทุน) */
const POS_PRODUCT_FIELDS =
  "product_id product_name_th product_name_eng category_id unit_id product_price sale_price product_img product_stock_quantity is_preorder";

export interface PosProductQuery {
  pagination: Pagination;
  /** ค้นจากรหัสสินค้า (product_id) หรือชื่อ th/en */
  search?: string;
}

/**
 * getPosProducts — รายการสินค้าที่ขายหน้าร้านได้ ให้ POS ใช้เป็นคำแนะนำในช่องค้นหา (สิทธิ์ orders · frontend Q-BE10)
 * ขายได้ = ยังไม่ลบ + ไม่ใช่พรีออเดอร์ (พรีออเดอร์ขายผ่านรอบ) · ไม่กรอง is_visible — ใช้ซ่อนจากเว็บเท่านั้น (เหมือน resolveScan)
 * แต่ละรายการมี has_customization — true = ต้องให้พนักงานเลือกตัวเลือกก่อนลงบิล (ดึงรายละเอียดจาก /admin/pos/scan)
 */
export async function getPosProducts(query: PosProductQuery) {
  await dbConnect();

  const filter: Filter = { deleted_at: null, is_preorder: { $ne: true } };
  const search = query.search?.trim();
  if (search) {
    const rx = new RegExp(escapeRegExp(search), "i");
    filter.$or = [{ product_id: rx }, { product_name_th: rx }, { product_name_eng: rx }];
  }

  const [items, total] = await Promise.all([
    productModel
      .find(filter)
      .select(POS_PRODUCT_FIELDS)
      .sort({ product_name_th: 1, _id: 1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("category_id", "product_category_name")
      .populate("unit_id", "unit_name unit_abbr")
      .lean(),
    productModel.countDocuments(filter),
  ]);

  const customizable = await productIdsWithCustomization(items.map((p) => String(p._id)));
  return {
    items: items.map((p) => ({ ...presentProduct(p), has_customization: customizable.has(String(p._id)) })),
    meta: buildMeta(total, query.pagination),
  };
}

// ── READ (list) ───────────────────────────────────────────────
export async function getProducts(query: ListProductQuery) {
  await dbConnect();

  const filter: Filter = {};

  if (!query.includeDeleted) {
    filter.deleted_at = null;
  }
  if (query.category_id) {
    assertObjectId(query.category_id, "category_id");
    filter.category_id = query.category_id;
  }
  if (typeof query.is_preorder === "boolean") {
    // $ne: true (ไม่ใช่ false ตรง ๆ) — นับเอกสารที่ยังไม่มีฟิลด์นี้เป็นสินค้าปกติ ให้ตรงกับ STOCKABLE_MATCH
    filter.is_preorder = query.is_preorder ? true : { $ne: true };
  }
  if (typeof query.is_visible === "boolean") {
    filter.is_visible = query.is_visible;
  }
  if (query.search) {
    const words = query.expandSynonyms
      ? await searchSynonymService.searchWordsFor(query.search)
      : [query.search.trim()];
    filter.$or = words.flatMap((w) => {
      const rx = new RegExp(escapeRegExp(w), "i");
      return [{ product_name_th: rx }, { product_name_eng: rx }, { product_description: rx }];
    });
  }

  const sortField = query.sortBy || "created_at";
  const sortable: readonly string[] = query.sortable ?? ADMIN_PRODUCT_SORTS;
  if (!sortable.includes(sortField)) {
    throw new ProductError(`sortBy ต้องเป็นหนึ่งใน: ${sortable.join(", ")}`, 400);
  }
  const sortDir = query.sortOrder === "asc" ? 1 : -1;

  const [items, total] = await Promise.all([
    productModel
      .find(filter)
      .sort({ [sortField]: sortDir })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("category_id", "product_category_name")
      .populate("unit_id", "unit_name unit_abbr")
      .lean(),
    productModel.countDocuments(filter),
  ]);

  return {
    items: items.map(presentProduct),
    meta: buildMeta(total, query.pagination),
  };
}

// ── READ (single) ─────────────────────────────────────────────
export async function getProductById(
  id: string,
  options: { includeDeleted?: boolean } = {}
) {
  await dbConnect();
  assertObjectId(id);

  const filter: Filter = { _id: id };
  if (!options.includeDeleted) {
    filter.deleted_at = null;
  }

  const product = await productModel
    .findOne(filter)
    .populate("category_id", "product_category_name")
    .populate("unit_id", "unit_name unit_abbr")
    .lean();

  if (!product) {
    throw new ProductError("ไม่พบสินค้าที่ระบุ", 404);
  }
  return presentProduct(product);
}

// ── UPDATE ────────────────────────────────────────────────────
export async function updateProduct(id: string, input: UpdateProductInput) {
  await dbConnect();
  assertObjectId(id);
  normalizeTypesInput(input);

  const existing = await productModel.findOne({ _id: id, deleted_at: null });
  if (!existing) {
    throw new ProductError("ไม่พบสินค้าที่ระบุ", 404);
  }

  if (input.product_price != null && input.product_price < 0) {
    throw new ProductError("product_price ต้องไม่ติดลบ", 400);
  }
  if (input.sale_price != null && input.sale_price < 0) {
    throw new ProductError("sale_price ต้องไม่ติดลบ", 400);
  }
  if (input.purchase_cost != null && input.purchase_cost < 0) {
    throw new ProductError("purchase_cost ต้องไม่ติดลบ", 400);
  }
  assertLowStockThreshold(input.low_stock_threshold);
  // input.purchase_cost/product_price/sale_price เป็นบาทจาก request — ปัด 2 ตำแหน่งก่อนให้ loop `updatable`
  // ด้านล่างเขียนลง existing.*
  if (input.purchase_cost != null) {
    input.purchase_cost = toSatang(Number(input.purchase_cost));
  }
  if (input.product_price != null) {
    input.product_price = toSatang(Number(input.product_price));
  }
  if (input.sale_price != null) {
    input.sale_price = toSatang(Number(input.sale_price));
  }
  if (input.category_id) {
    await assertCategoryExists(input.category_id);
  }
  if (input.unit_id) {
    await assertUnitExists(input.unit_id);
  }

  // ประเภทหลังอัปเดต (ใช้ค่าใหม่ถ้าส่งมา ไม่งั้นใช้ค่าเดิม)
  const nextIsPreorder = input.is_preorder !== undefined ? input.is_preorder : isPreorderProduct(existing);

  // สต็อกแก้ผ่าน PATCH ไม่ได้แล้ว — ใช้ /stock (atomic · บันทึกประวัติ · แจ้งสต็อกใกล้หมด) · customer-backend-merge.md §8.21
  // null ยังรับ (ผลเท่ากับไม่ส่ง — client เดิมส่งคู่กับการเปลี่ยนเป็นพรีออเดอร์)
  if (input.product_stock_quantity != null) {
    throw new ProductError(
      "แก้ product_stock_quantity ผ่าน PATCH ไม่ได้ — ใช้ PUT /api/admin/products/{id}/stock { quantity } หรือ PATCH …/stock { delta }",
      400
    );
  }

  if (input.is_preorder !== undefined || input.preorder_config !== undefined) {
    validateTypeConsistency(nextIsPreorder, {
      preorder_config:
        input.preorder_config !== undefined
          ? input.preorder_config
          : existing.preorder_config,
      // เปลี่ยนเป็นพรีออเดอร์ = สต็อกถูกล้างเป็น null ด้านล่างเสมอ → ไม่ต้องตรวจสต็อกเดิม
      // (เดิมตรวจสต็อกเดิม → สินค้าที่มีสต็อกเปลี่ยนเป็นพรีออเดอร์ไม่ได้ ถ้า client ไม่ส่ง null มาด้วย)
      product_stock_quantity: null,
    });
  }

  // BACKLOG §3.14 — จำรูปเดิมไว้ก่อนเขียนทับ เผื่อต้องลบไฟล์ที่ไม่ใช้แล้วหลัง save สำเร็จ
  const oldImages: string[] = input.product_img !== undefined ? [...(existing.product_img ?? [])] : [];

  const updatable: (keyof UpdateProductInput)[] = [
    "product_name_th",
    "product_name_eng",
    "category_id",
    "product_price",
    "sale_price",
    "is_visible",
    "product_img",
    "product_description",
    "preparation_heating",
    "yield_per_batch",
    "purchase_cost",
    "unit_id",
    "is_preorder",
  ];
  for (const field of updatable) {
    if (input[field] !== undefined) {
      (existing as Record<string, unknown>)[field] = input[field];
    }
  }

  // ปรับฟิลด์ที่ผูกกับ is_preorder ให้สอดคล้องเสมอ
  if (!nextIsPreorder) {
    existing.preorder_config = null;
    // พรีออเดอร์ → สินค้าปกติ: เริ่มสต็อก 0 (ตั้งจริงผ่าน /stock)
    if (existing.product_stock_quantity == null) existing.product_stock_quantity = 0;
    if (input.low_stock_threshold !== undefined) {
      existing.low_stock_threshold = input.low_stock_threshold;
    }
  } else {
    existing.product_stock_quantity = null;
    existing.low_stock_threshold = null;
    if (input.preorder_config !== undefined) {
      existing.preorder_config = input.preorder_config;
    }
  }

  // docs/BACKLOG2.md §14 — ส่ง is_preorder มา (เปลี่ยนหรือส่งค่าเดิมซ้ำก็ได้) แล้ว prefix ของ product_id
  // (pos-/pre-) ไม่ตรงกับประเภท → สร้างรหัสใหม่ให้ตรงทันที · ใช้แก้สินค้าที่รหัสค้างผิดประเภทได้ด้วยการ
  // PATCH { is_preorder: <ค่าเดิม> } (⚠️ รหัสสินค้าเปลี่ยน — บาร์โค้ด/ป้ายราคาที่พิมพ์ไว้ต้องพิมพ์ใหม่)
  let needsNewCode = false;
  if (input.is_preorder !== undefined) {
    const oldPrefix = typeof existing.product_id === "string" ? existing.product_id.split("-")[0] : null;
    if (oldPrefix && oldPrefix !== productCodePrefix(nextIsPreorder)) needsNewCode = true;
  }

  if (needsNewCode) {
    let saved = false;
    for (let attempt = 0; attempt < 20 && !saved; attempt++) {
      existing.product_id = generateProductCode(nextIsPreorder);
      try {
        await existing.save();
        saved = true;
      } catch (err) {
        const code = (err as { code?: number })?.code;
        if (code === 11000 && attempt < 19) continue; // ชน product_id ที่สุ่มได้ → สุ่มใหม่
        if (code === 11000) {
          throw new ProductError("สร้างรหัสสินค้าใหม่ไม่สำเร็จ (รหัสสุ่มชนกันหลายครั้ง) กรุณาลองใหม่", 409);
        }
        throw err;
      }
    }
  } else {
    await existing.save();
  }
  const result = existing.toObject();

  // BACKLOG §3.14 — ลบไฟล์รูปเดิมที่ไม่อยู่ในชุดใหม่แล้ว (best-effort, ไม่ทำให้ update พังถ้าลบไม่สำเร็จ —
  // deleteImages() ดักจับ error ของตัวเองทุกไฟล์ ไม่ throw ต่อ)
  if (oldImages.length > 0) {
    const kept = new Set<string>(result.product_img ?? []);
    const removed = oldImages.filter((url) => !kept.has(url));
    if (removed.length > 0) await deleteImages(removed);
  }

  return presentProduct(result);
}

// BACKLOG3 §9 — soft-delete/restore เป็น pattern เดียวกับ service อื่นทุกจุด ใช้ primitive กลางแทน
// (notFound() ของ primitive กับ ProductError(msg,404) เดิม คืน response shape เดียวกันเป๊ะ —
// {status:404, code:"NOT_FOUND"} ทั้งคู่ — ยืนยันแล้วว่าไม่มี instanceof ProductError check ที่ไหนเลย)
// ── DELETE (soft) ─────────────────────────────────────────────
export async function deleteProduct(id: string) {
  const product = await softDeleteDoc(productModel, id, {
    notFoundMsg: "ไม่พบสินค้าที่ระบุ หรือถูกลบไปแล้ว",
  });
  return presentProduct(product);
}

// ── RESTORE (กู้คืนจาก soft delete) ───────────────────────────
export async function restoreProduct(id: string) {
  const product = await restoreDoc(productModel, id, { notFoundMsg: "ไม่พบสินค้าที่ถูกลบไว้" });
  return presentProduct(product);
}

// ── DELETE (ถาวร) ────────────────────────────────────────────
export async function hardDeleteProduct(id: string) {
  await dbConnect();
  assertObjectId(id);

  const product = await productModel
    .findByIdAndDelete(id)
    .lean<{ product_img?: string[]; purchase_cost?: number | null } | null>();
  if (!product) {
    throw new ProductError("ไม่พบสินค้าที่ระบุ", 404);
  }

  // BACKLOG §3.14 — ลบถาวรแล้ว ไม่มีทาง restore กลับมาแสดงรูปเดิมได้อีก เก็บไฟล์ไว้ไม่มีประโยชน์
  if (product.product_img?.length) await deleteImages(product.product_img);

  return presentProduct(product);
}

// ─────────────────────────────────────────────────────────────
//  STOCK MANAGEMENT — จัดการสต็อกสินค้า
//  ใช้ได้กับสินค้าปกติ (is_preorder: false) เท่านั้น
//  (พรีออเดอร์ไม่มีสต็อก product_stock_quantity = null)
//  ทุก operation ที่แก้จำนวนใช้ update แบบ atomic กัน race condition
// ─────────────────────────────────────────────────────────────

/** เงื่อนไข query สำหรับ "สินค้าที่มีสต็อก" = ไม่ใช่พรีออเดอร์ — $ne: true (ไม่ใช่ false ตรง ๆ) ให้นับ
 *  เอกสารที่ยังไม่มีฟิลด์ is_preorder เป็นสินค้าปกติด้วย (ค่าเริ่มต้นของ schema) */
const STOCKABLE_MATCH = { is_preorder: { $ne: true } } as const;

export interface StockItemInput {
  product_id: string;
  quantity: number;
}

export interface StockAdjustOptions {
  /** ยอมให้สต็อกติดลบได้ (ปกติ = false) */
  allowNegative?: boolean;
}

function assertPositiveQty(qty: number, field = "quantity"): void {
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
    throw new ProductError(`${field} ต้องเป็นตัวเลขมากกว่า 0`, 400);
  }
}

/** โหลดสินค้าและยืนยันว่าเป็นชนิดที่มีสต็อก (inStore/online, ยังไม่ถูกลบ) */
async function loadStockableProduct(id: string) {
  assertObjectId(id, "product_id");
  const product = await productModel.findOne({ _id: id, deleted_at: null });
  if (!product) {
    throw new ProductError("ไม่พบสินค้าที่ระบุ", 404);
  }
  if (isPreorderProduct(product)) {
    throw new ProductError("สินค้าพรีออเดอร์ไม่มีการจัดการสต็อก", 400);
  }
  return product;
}

// ── อ่านจำนวนคงเหลือ ─────────────────────────────────────────
export async function getStock(id: string): Promise<number> {
  await dbConnect();
  const product = await loadStockableProduct(id);
  return product.product_stock_quantity ?? 0;
}

// ── ตั้งค่าสต็อกแบบระบุจำนวนตรง ๆ (นับสต็อก / แก้ยอด) ────────
export async function setStock(id: string, quantity: number) {
  await dbConnect();
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) {
    throw new ProductError("quantity ต้องเป็นตัวเลขไม่ติดลบ", 400);
  }
  await loadStockableProduct(id);

  // findOneAndUpdate คืนค่า "ก่อน" อัปเดต (ไม่ส่ง new) — ได้ before ที่แม่นแบบ atomic ไว้เช็คข้ามเกณฑ์
  const previous = await productModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null, ...STOCKABLE_MATCH },
      { $set: { product_stock_quantity: quantity } }
    )
    .lean<{ _id: unknown; product_name_th?: string; product_stock_quantity?: number } | null>();

  if (!previous) {
    throw new ProductError("ไม่พบสินค้าที่ระบุ", 404);
  }
  notifyIfLowStockCrossed(previous, previous.product_stock_quantity ?? 0, quantity);
  return { ...previous, product_stock_quantity: quantity };
}

// ── ปรับสต็อกด้วยส่วนต่าง (+ รับเข้า / - ตัดออก) ──────────────
export async function adjustStock(
  id: string,
  delta: number,
  options: StockAdjustOptions = {}
) {
  await dbConnect();
  if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0) {
    throw new ProductError("delta ต้องเป็นตัวเลขที่ไม่ใช่ 0", 400);
  }
  await loadStockableProduct(id);

  const filter: Filter = {
    _id: id,
    deleted_at: null,
    ...STOCKABLE_MATCH,
  };
  // ตัดสต็อก: กันไม่ให้ติดลบ เว้นแต่สั่ง allowNegative
  if (delta < 0 && !options.allowNegative) {
    filter.product_stock_quantity = { $gte: -delta };
  }

  const product = await productModel
    .findOneAndUpdate(
      filter,
      { $inc: { product_stock_quantity: delta } },
      { returnDocument: "after" }
    )
    .lean();

  if (!product) {
    if (delta < 0 && !options.allowNegative) {
      const current = await getStock(id);
      throw new ProductError(
        `สต็อกไม่พอ (คงเหลือ ${current}, ต้องการ ${-delta})`,
        409
      );
    }
    throw new ProductError("ไม่พบสินค้าที่ระบุ", 404);
  }
  const after = (product as { product_stock_quantity?: number }).product_stock_quantity ?? 0;
  notifyIfLowStockCrossed(product as { _id: unknown; product_name_th?: string }, after - delta, after);
  return product;
}

// ── รับสินค้าเข้าสต็อก ───────────────────────────────────────
export async function increaseStock(id: string, quantity: number) {
  assertPositiveQty(quantity);
  return adjustStock(id, Math.abs(quantity));
}

// ── ตัดสต็อกออก (เช่น ขาย / เสียหาย) ─────────────────────────
export async function decreaseStock(
  id: string,
  quantity: number,
  options: StockAdjustOptions = {}
) {
  assertPositiveQty(quantity);
  return adjustStock(id, -Math.abs(quantity), options);
}

// ── ตรวจว่ามีสต็อกพอสำหรับหลายรายการหรือไม่ (ไม่ตัดสต็อก) ────
export async function checkStockAvailability(items: StockItemInput[]) {
  await dbConnect();
  if (!Array.isArray(items) || items.length === 0) {
    throw new ProductError("items ต้องเป็น array ที่ไม่ว่าง", 400);
  }

  const results = await Promise.all(
    items.map(async ({ product_id, quantity }) => {
      assertObjectId(product_id, "product_id");
      assertPositiveQty(quantity);
      const product = await productModel
        .findOne({ _id: product_id, deleted_at: null })
        .select("product_name_th is_preorder product_stock_quantity")
        .lean<{
          _id: Types.ObjectId;
          product_name_th: string;
          is_preorder?: boolean;
          product_stock_quantity: number | null;
        }>();

      if (!product) {
        return { product_id, requested: quantity, available: 0, ok: false, reason: "not_found" };
      }
      if (isPreorderProduct(product)) {
        // preorder ไม่จำกัดด้วยสต็อก
        return { product_id, requested: quantity, available: null, ok: true, reason: "preorder" };
      }
      const available = product.product_stock_quantity ?? 0;
      return {
        product_id,
        product_name_th: product.product_name_th,
        requested: quantity,
        available,
        ok: available >= quantity,
        reason: available >= quantity ? "ok" : "insufficient",
      };
    })
  );

  return {
    ok: results.every((r) => r.ok),
    items: results,
  };
}

// ── ตัดสต็อกหลายรายการพร้อมกัน (เช่น ตอนยืนยันออเดอร์) ───────
//    ตัดทีละรายการแบบ atomic ถ้ามีรายการใดไม่พอจะคืนสต็อกที่ตัดไปแล้วกลับ
export async function deductStockForOrder(items: StockItemInput[]) {
  await dbConnect();
  if (!Array.isArray(items) || items.length === 0) {
    throw new ProductError("items ต้องเป็น array ที่ไม่ว่าง", 400);
  }

  // รวมจำนวนของ product ที่ซ้ำกันก่อน
  const merged = new Map<string, number>();
  for (const { product_id, quantity } of items) {
    assertObjectId(product_id, "product_id");
    assertPositiveQty(quantity);
    merged.set(product_id, (merged.get(product_id) ?? 0) + quantity);
  }

  const applied: { product_id: string; quantity: number }[] = [];
  try {
    for (const [product_id, quantity] of merged) {
      const product = await productModel.findOne({
        _id: product_id,
        deleted_at: null,
      });
      if (!product) {
        throw new ProductError(`ไม่พบสินค้า ${product_id}`, 404);
      }
      // preorder ข้ามการตัดสต็อก
      if (isPreorderProduct(product)) continue;

      const updated = await productModel.findOneAndUpdate(
        {
          _id: product_id,
          deleted_at: null,
          ...STOCKABLE_MATCH,
          product_stock_quantity: { $gte: quantity },
        },
        { $inc: { product_stock_quantity: -quantity } },
        { returnDocument: "after" }
      );

      if (!updated) {
        const current = product.product_stock_quantity ?? 0;
        throw new ProductError(
          `สต็อกไม่พอสำหรับ ${product.product_name_th} (คงเหลือ ${current}, ต้องการ ${quantity})`,
          409
        );
      }
      applied.push({ product_id, quantity });

      notifyIfLowStockCrossed(
        product,
        product.product_stock_quantity ?? 0,
        updated.product_stock_quantity ?? 0
      );
    }
  } catch (err) {
    // ชดเชย: คืนสต็อกทุกตัวที่ตัดไปแล้ว
    await Promise.all(
      applied.map((a) =>
        productModel.updateOne(
          { _id: a.product_id },
          { $inc: { product_stock_quantity: a.quantity } }
        )
      )
    );
    throw err;
  }

  return { ok: true, deducted: applied };
}

// ── คืนสต็อกหลายรายการ (เช่น ยกเลิก / คืนสินค้า) ─────────────
export async function restockForOrder(items: StockItemInput[]) {
  await dbConnect();
  if (!Array.isArray(items) || items.length === 0) {
    throw new ProductError("items ต้องเป็น array ที่ไม่ว่าง", 400);
  }

  const merged = new Map<string, number>();
  for (const { product_id, quantity } of items) {
    assertObjectId(product_id, "product_id");
    assertPositiveQty(quantity);
    merged.set(product_id, (merged.get(product_id) ?? 0) + quantity);
  }

  const restocked: { product_id: string; quantity: number }[] = [];
  for (const [product_id, quantity] of merged) {
    const updated = await productModel.updateOne(
      { _id: product_id, deleted_at: null, ...STOCKABLE_MATCH },
      { $inc: { product_stock_quantity: quantity } }
    );
    if (updated.modifiedCount > 0) {
      restocked.push({ product_id, quantity });
    }
  }

  return { ok: true, restocked };
}

// ── ลิสต์สินค้าใกล้หมด / หมดสต็อก ───────────────────────────
/**
 * threshold ไม่ส่ง (ค่าเริ่มต้น) = ใช้เกณฑ์ของแต่ละสินค้า (low_stock_threshold ?? 5 — src/lib/lowStock.ts)
 * ส่งตัวเลขมา = ใช้เกณฑ์เดียวกันทุกสินค้า (พฤติกรรมเดิม — ยังรองรับ ?threshold= ของ route)
 */
export async function getLowStockProducts(
  threshold?: number,
  options: { includeOutOfStock?: boolean; limit?: number } = {}
) {
  await dbConnect();
  if (threshold !== undefined && (typeof threshold !== "number" || threshold < 0)) {
    throw new ProductError("threshold ต้องเป็นตัวเลขไม่ติดลบ", 400);
  }
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 100));
  const min = options.includeOutOfStock ? 0 : 1;

  const items = await productModel
    .find({
      deleted_at: null,
      ...STOCKABLE_MATCH,
      ...(threshold === undefined
        ? { product_stock_quantity: { $gte: min }, ...LOW_STOCK_EXPR }
        : { product_stock_quantity: { $gte: min, $lte: threshold } }),
    })
    .sort({ product_stock_quantity: 1 })
    .limit(limit)
    .select(
      "product_name_th product_name_eng product_stock_quantity low_stock_threshold category_id unit_id is_visible"
    )
    .populate("category_id", "product_category_name")
    .populate("unit_id", "unit_name unit_abbr")
    .lean();

  return {
    // per_product = true: แต่ละรายการใช้ low_stock_threshold ของตัวเอง (null = ค่าเริ่มต้นด้านล่าง)
    threshold: threshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
    per_product: threshold === undefined,
    count: items.length,
    items,
  };
}

const productService = {
  // CRUD
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  restoreProduct,
  hardDeleteProduct,
  // Stock
  getStock,
  setStock,
  adjustStock,
  increaseStock,
  decreaseStock,
  checkStockAvailability,
  deductStockForOrder,
  restockForOrder,
  getLowStockProducts,
};

export default productService;
