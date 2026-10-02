/**
 * productVariantService — CRUD ตัวเลือกสินค้าแบบมีหลายแบบ (ProductVariants)
 * เช่น รสชาติ / ขนาด ที่มีราคาส่วนเพิ่มและสต็อกแยกของตัวเอง
 *
 * ต่อยอดจาก crudService + ตรวจว่า product_id (และ unit_id ถ้ามี) อ้างถึงเอกสารที่มีจริง
 */
import type { Model } from "mongoose";
import productVariantModel from "../models/productVariantModel";
import productModel from "../models/productModel";
import unitModel from "../models/unitModel";
import { createCrudService } from "../lib/crudService";
import { assertRefExists } from "../lib/refs";
import { badRequest } from "../lib/httpError";
import { toSatang, toBahtFields } from "../lib/money";
import { applyVariantStockDelta, productHasVariants, syncStockFromVariants } from "./productService";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRITABLE = [
  "product_id",
  "variant_name",
  "variant_price",
  "variant_stock",
  "unit_id",
] as const;

// BACKLOG §3.11 เฟส 5b — variant_price เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
function presentVariant<T extends Record<string, unknown>>(v: T): T {
  return toBahtFields(v, ["variant_price"] as const);
}

const base = createCrudService(productVariantModel as Model<any>, {
  label: "ตัวเลือกสินค้า",
  searchFields: ["variant_name"],
  createFields: WRITABLE,
  updateFields: ["variant_name", "variant_price", "variant_stock", "unit_id"], // ห้ามย้าย product_id
  populate: [{ path: "unit_id", select: "unit_name unit_abbr" }],
  present: presentVariant, // BACKLOG3 §8 — ครอบ list/getById/create/update/remove/restore ให้เองในตัว
});

async function assertRefs(input: Record<string, any>): Promise<void> {
  if (input.product_id) {
    await assertRefExists(productModel, input.product_id, "สินค้า", "product_id");
  }
  if (input.unit_id) {
    await assertRefExists(unitModel, input.unit_id, "หน่วยนับ", "unit_id");
  }
  if (input.variant_price != null && Number(input.variant_price) < 0) {
    throw badRequest("variant_price ต้องไม่ติดลบ");
  }
  if (input.variant_stock != null && Number(input.variant_stock) < 0) {
    throw badRequest("variant_stock ต้องไม่ติดลบ");
  }
}

// BACKLOG3 §8 — list/getById/remove/restore ไม่ต้อง override เองแล้ว (base.present ทำให้แล้ว) เหลือแค่
// create/update ที่ยังต้อง override เพราะมี validation เพิ่มเติม (?product_id= ยัง filter ได้ตามปกติ
// ผ่าน args.filter ที่ route ส่งเข้า base.list โดยตรง ไม่เคยต้องพึ่ง override ตรงนี้อยู่แล้ว)
export const productVariantService = {
  ...base,

  async create(input: Record<string, any>) {
    if (!input.product_id) throw badRequest("กรุณาระบุ product_id");
    if (!input.variant_name) throw badRequest("กรุณาระบุ variant_name");
    await assertRefs(input);
    const payload =
      input.variant_price != null
        ? { ...input, variant_price: toSatang(Number(input.variant_price)) }
        : input;
    const hadVariants = await productHasVariants(String(input.product_id));
    const created = await base.create(payload);
    // docs/BACKLOG4.md Y9 — สต็อกสินค้า = ผลรวม variant_stock: variant ตัวแรก → ตั้งสต็อกสินค้าเป็นผลรวม
    // (ทิ้งสต็อกเดิมที่ไม่ได้แยกตัวเลือก) · ตัวถัดไป → บวกส่วนของมันเข้าไป
    await syncVariantStock(String(input.product_id), Number(created.variant_stock ?? 0), hadVariants);
    return created;
  },

  async update(id: string, input: Record<string, any>) {
    await assertRefs(input);
    const { variant_stock, ...rest } = input;
    const payload =
      rest.variant_price != null
        ? { ...rest, variant_price: toSatang(Number(rest.variant_price)) }
        : rest;
    const updated = await base.update(id, payload);
    if (variant_stock == null) return updated;

    // ตั้ง variant_stock แบบ atomic แล้วเลื่อนสต็อกสินค้าตามส่วนต่าง (ค่าก่อน-หลังจาก doc เดียวกัน —
    // ไม่ชนกับออเดอร์ที่ตัด $inc variant เดียวกันพร้อมกัน)
    const before = await productVariantModel
      .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: { variant_stock: Number(variant_stock) } })
      .lean<{ product_id: unknown; variant_stock?: number } | null>();
    if (!before) return updated;
    await applyVariantStockDelta(String(before.product_id), Number(variant_stock) - (before.variant_stock ?? 0));
    return base.getById(id);
  },

  async remove(id: string) {
    const removed = await base.remove(id);
    // ลบตัวเลือก → สต็อกของตัวเลือกนั้นออกจากผลรวมของสินค้าด้วย
    await applyVariantStockDelta(String(removed.product_id), -Number(removed.variant_stock ?? 0));
    return removed;
  },

  async restore(id: string) {
    const doc = await productVariantModel.findOne({ _id: id }).select("product_id").lean<{ product_id: unknown } | null>();
    const hadVariants = doc ? await productHasVariants(String(doc.product_id)) : false;
    const restored = await base.restore(id);
    await syncVariantStock(String(restored.product_id), Number(restored.variant_stock ?? 0), hadVariants);
    return restored;
  },
};

/** variant เพิ่มเข้ามา (สร้าง/กู้คืน): ตัวแรกของสินค้า → ตั้งสต็อกสินค้า = ผลรวม · ไม่ใช่ตัวแรก → บวกเพิ่ม */
async function syncVariantStock(productId: string, stock: number, hadVariants: boolean): Promise<void> {
  if (hadVariants) await applyVariantStockDelta(productId, stock);
  else await syncStockFromVariants(productId);
}

export default productVariantService;
