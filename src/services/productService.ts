import { Types } from "mongoose";

type Filter = Record<string, unknown>;
import dbConnect from "../lib/dbConnect";
import { HttpError } from "../lib/httpError";
import {
  generateProductCode,
  isProductCode,
  isStockProductType,
  PRODUCT_TYPES,
  type ProductType,
} from "../lib/productCode";
import productModel from "../models/productModel";
import productCategoryModel from "../models/productCategoryModel";
import productVariantModel from "../models/productVariantModel";
import unitModel from "../models/unitModel";

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
  product_type: ProductType; // "inStore" | "online" | "preorder"
  sale_price?: number | null;
  is_visible?: boolean;
  product_img?: string[];
  product_description?: string | null;
  preparation_heating?: string | null;
  yield_per_batch?: number | null;
  product_stock_quantity?: number | null;
  preorder_config?: PreorderConfigInput | null;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export interface ListProductQuery {
  page?: number;
  limit?: number;
  search?: string;
  category_id?: string;
  product_type?: ProductType;
  is_visible?: boolean;
  includeDeleted?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

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

// ── Helpers ───────────────────────────────────────────────────
function assertObjectId(id: string, field = "id"): void {
  if (!Types.ObjectId.isValid(id)) {
    throw new ProductError(`รูปแบบ ${field} ไม่ถูกต้อง`, 400);
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
 * ตรวจความสอดคล้องระหว่าง product_type กับฟิลด์ที่เกี่ยวข้อง
 * - inStore / online : ต้องมี product_stock_quantity, ห้ามมี preorder_config
 * - preorder         : ต้องมี preorder_config ที่ถูกต้อง, product_stock_quantity ต้องเป็น null
 */
function validateTypeConsistency(
  type: ProductType | undefined,
  data: UpdateProductInput
): void {
  if (!type) return;

  if (isStockProductType(type)) {
    if (data.preorder_config != null) {
      throw new ProductError(
        `สินค้าประเภท "${type}" ต้องไม่มี preorder_config`,
        400
      );
    }
  }

  if (type === "preorder") {
    const cfg = data.preorder_config;
    if (!cfg) {
      throw new ProductError(
        'สินค้าประเภท "preorder" ต้องระบุ preorder_config',
        400
      );
    }
    if (
      cfg.min_order_qty == null ||
      cfg.max_order_qty == null ||
      cfg.lead_time_days == null
    ) {
      throw new ProductError(
        "preorder_config ต้องมี min_order_qty, max_order_qty และ lead_time_days",
        400
      );
    }
    if (cfg.min_order_qty < 1 || cfg.max_order_qty < 1 || cfg.lead_time_days < 1) {
      throw new ProductError("ค่าใน preorder_config ต้องมากกว่าหรือเท่ากับ 1", 400);
    }
    if (cfg.max_order_qty < cfg.min_order_qty) {
      throw new ProductError(
        "max_order_qty ต้องไม่น้อยกว่า min_order_qty",
        400
      );
    }
    if (data.product_stock_quantity != null) {
      throw new ProductError(
        'สินค้าประเภท "preorder" ต้องไม่มี product_stock_quantity',
        400
      );
    }
  }
}

// ── CREATE ────────────────────────────────────────────────────
export async function createProduct(input: CreateProductInput) {
  await dbConnect();

  const required: (keyof CreateProductInput)[] = [
    "product_name_th",
    "product_name_eng",
    "category_id",
    "product_price",
    "unit_id",
    "product_type",
  ];
  for (const field of required) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      throw new ProductError(`กรุณาระบุ ${field}`, 400);
    }
  }

  if (input.product_price < 0) {
    throw new ProductError("product_price ต้องไม่ติดลบ", 400);
  }
  if (input.sale_price != null && input.sale_price < 0) {
    throw new ProductError("sale_price ต้องไม่ติดลบ", 400);
  }
  if (!PRODUCT_TYPES.includes(input.product_type)) {
    throw new ProductError(
      `product_type ต้องเป็นหนึ่งใน: ${PRODUCT_TYPES.join(", ")}`,
      400
    );
  }

  await assertCategoryExists(input.category_id);
  await assertUnitExists(input.unit_id);
  validateTypeConsistency(input.product_type, input);

  const payload = {
    product_name_th: input.product_name_th,
    product_name_eng: input.product_name_eng,
    category_id: input.category_id,
    product_price: input.product_price,
    sale_price: input.sale_price ?? null,
    is_visible: input.is_visible ?? true,
    product_img: input.product_img ?? [],
    product_description: input.product_description ?? null,
    preparation_heating: input.preparation_heating ?? null,
    yield_per_batch: input.yield_per_batch ?? null,
    unit_id: input.unit_id,
    product_type: input.product_type,
    product_stock_quantity: isStockProductType(input.product_type)
      ? input.product_stock_quantity ?? 0
      : null,
    preorder_config:
      input.product_type === "preorder" ? input.preorder_config : null,
  };

  // สร้างรหัสสินค้า (product_id) แบบสุ่ม + retry เมื่อชนกับที่มีอยู่
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any = null;
  for (let attempt = 0; attempt < 20 && !doc; attempt++) {
    try {
      doc = await productModel.create({
        ...payload,
        product_id: generateProductCode(input.product_type),
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

  return doc.toObject();
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
  return product;
}

/**
 * resolveScan — ใช้กับการสแกนหน้าร้าน: รับได้ทั้งรหัสสินค้า (pos-/pre-...) หรือ _id ดิบ
 * คืนสินค้า + ราคาปัจจุบัน + สต็อก + variants (ถ้ามี ให้ POS เลือกก่อนเพิ่มลงบิล)
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

  const variants = await productVariantModel
    .find({ product_id: product._id, deleted_at: null })
    .select("variant_name variant_price variant_stock unit_id")
    .lean();

  return {
    product,
    current_price: (product.sale_price as number | null) ?? (product.product_price as number),
    stock: (product.product_stock_quantity as number | null) ?? null,
    variants,
  };
}

// ── READ (list) ───────────────────────────────────────────────
export async function getProducts(query: ListProductQuery = {}) {
  await dbConnect();

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Filter = {};

  if (!query.includeDeleted) {
    filter.deleted_at = null;
  }
  if (query.category_id) {
    assertObjectId(query.category_id, "category_id");
    filter.category_id = query.category_id;
  }
  if (query.product_type) {
    filter.product_type = query.product_type;
  }
  if (typeof query.is_visible === "boolean") {
    filter.is_visible = query.is_visible;
  }
  if (query.search) {
    const rx = new RegExp(escapeRegExp(query.search.trim()), "i");
    filter.$or = [
      { product_name_th: rx },
      { product_name_eng: rx },
      { product_description: rx },
    ];
  }

  const sortField = query.sortBy || "created_at";
  const sortDir = query.sortOrder === "asc" ? 1 : -1;

  const [items, total] = await Promise.all([
    productModel
      .find(filter)
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(limit)
      .populate("category_id", "product_category_name")
      .populate("unit_id", "unit_name unit_abbr")
      .lean(),
    productModel.countDocuments(filter),
  ]);

  // key `meta` (เดิม `pagination`) — โครงมาตรฐานเดียวของ list endpoint · ดู docs/api-conventions.md
  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
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
  return product;
}

// ── UPDATE ────────────────────────────────────────────────────
export async function updateProduct(id: string, input: UpdateProductInput) {
  await dbConnect();
  assertObjectId(id);

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
  if (input.category_id) {
    await assertCategoryExists(input.category_id);
  }
  if (input.unit_id) {
    await assertUnitExists(input.unit_id);
  }

  // ประเภทหลังอัปเดต (ใช้ค่าใหม่ถ้าส่งมา ไม่งั้นใช้ค่าเดิม)
  const nextType = (input.product_type ?? existing.product_type) as ProductType;

  if (input.product_type || input.preorder_config !== undefined ||
      input.product_stock_quantity !== undefined) {
    validateTypeConsistency(nextType, {
      preorder_config:
        input.preorder_config !== undefined
          ? input.preorder_config
          : existing.preorder_config,
      product_stock_quantity:
        input.product_stock_quantity !== undefined
          ? input.product_stock_quantity
          : existing.product_stock_quantity,
    });
  }

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
    "unit_id",
    "product_type",
  ];
  for (const field of updatable) {
    if (input[field] !== undefined) {
      (existing as Record<string, unknown>)[field] = input[field];
    }
  }

  // ปรับฟิลด์ที่ผูกกับ product_type ให้สอดคล้องเสมอ
  if (isStockProductType(nextType)) {
    existing.preorder_config = null;
    if (input.product_stock_quantity !== undefined) {
      existing.product_stock_quantity = input.product_stock_quantity;
    } else if (existing.product_stock_quantity == null) {
      existing.product_stock_quantity = 0;
    }
  } else {
    existing.product_stock_quantity = null;
    if (input.preorder_config !== undefined) {
      existing.preorder_config = input.preorder_config;
    }
  }

  await existing.save();
  return existing.toObject();
}

// ── DELETE (soft) ─────────────────────────────────────────────
export async function deleteProduct(id: string) {
  await dbConnect();
  assertObjectId(id);

  const product = await productModel.findOneAndUpdate(
    { _id: id, deleted_at: null },
    { $set: { deleted_at: new Date() } },
    { new: true }
  ).lean();

  if (!product) {
    throw new ProductError("ไม่พบสินค้าที่ระบุ หรือถูกลบไปแล้ว", 404);
  }
  return product;
}

// ── RESTORE (กู้คืนจาก soft delete) ───────────────────────────
export async function restoreProduct(id: string) {
  await dbConnect();
  assertObjectId(id);

  const product = await productModel.findOneAndUpdate(
    { _id: id, deleted_at: { $ne: null } },
    { $set: { deleted_at: null } },
    { new: true }
  ).lean();

  if (!product) {
    throw new ProductError("ไม่พบสินค้าที่ถูกลบไว้", 404);
  }
  return product;
}

// ── DELETE (ถาวร) ────────────────────────────────────────────
export async function hardDeleteProduct(id: string) {
  await dbConnect();
  assertObjectId(id);

  const product = await productModel.findByIdAndDelete(id).lean();
  if (!product) {
    throw new ProductError("ไม่พบสินค้าที่ระบุ", 404);
  }
  return product;
}

// ─────────────────────────────────────────────────────────────
//  STOCK MANAGEMENT — จัดการสต็อกสินค้า
//  ใช้ได้กับสินค้าที่มีสต็อก (product_type = "inStore" หรือ "online")
//  ("preorder" ไม่มีสต็อก product_stock_quantity = null)
//  ทุก operation ที่แก้จำนวนใช้ update แบบ atomic กัน race condition
// ─────────────────────────────────────────────────────────────

/** เงื่อนไข query สำหรับ "สินค้าที่มีสต็อก" = ทุกประเภทยกเว้น preorder */
const STOCKABLE_MATCH = { product_type: { $ne: "preorder" } } as const;

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
  if (product.product_type === "preorder") {
    throw new ProductError(
      'สินค้าประเภท "preorder" ไม่มีการจัดการสต็อก',
      400
    );
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

  const product = await productModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null, ...STOCKABLE_MATCH },
      { $set: { product_stock_quantity: quantity } },
      { new: true }
    )
    .lean();

  if (!product) {
    throw new ProductError("ไม่พบสินค้าที่ระบุ", 404);
  }
  return product;
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
      { new: true }
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
        .select("product_name_th product_type product_stock_quantity")
        .lean<{
          _id: Types.ObjectId;
          product_name_th: string;
          product_type: ProductType;
          product_stock_quantity: number | null;
        }>();

      if (!product) {
        return { product_id, requested: quantity, available: 0, ok: false, reason: "not_found" };
      }
      if (product.product_type === "preorder") {
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
      if (product.product_type === "preorder") continue;

      const updated = await productModel.findOneAndUpdate(
        {
          _id: product_id,
          deleted_at: null,
          ...STOCKABLE_MATCH,
          product_stock_quantity: { $gte: quantity },
        },
        { $inc: { product_stock_quantity: -quantity } },
        { new: true }
      );

      if (!updated) {
        const current = product.product_stock_quantity ?? 0;
        throw new ProductError(
          `สต็อกไม่พอสำหรับ ${product.product_name_th} (คงเหลือ ${current}, ต้องการ ${quantity})`,
          409
        );
      }
      applied.push({ product_id, quantity });
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
export async function getLowStockProducts(
  threshold = 5,
  options: { includeOutOfStock?: boolean; limit?: number } = {}
) {
  await dbConnect();
  if (typeof threshold !== "number" || threshold < 0) {
    throw new ProductError("threshold ต้องเป็นตัวเลขไม่ติดลบ", 400);
  }
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 100));
  const min = options.includeOutOfStock ? 0 : 1;

  const items = await productModel
    .find({
      deleted_at: null,
      ...STOCKABLE_MATCH,
      product_stock_quantity: { $gte: min, $lte: threshold },
    })
    .sort({ product_stock_quantity: 1 })
    .limit(limit)
    .select("product_name_th product_name_eng product_stock_quantity category_id unit_id is_visible")
    .populate("category_id", "product_category_name")
    .populate("unit_id", "unit_name unit_abbr")
    .lean();

  return { threshold, count: items.length, items };
}

// ── utils ────────────────────────────────────────────────────
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default {
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
