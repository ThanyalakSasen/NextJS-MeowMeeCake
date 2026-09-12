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
import { createCrudService, type ListArgs } from "../lib/crudService";
import { assertRefExists } from "../lib/refs";
import { badRequest } from "../lib/httpError";
import { toSatang, toBahtFields } from "../lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRITABLE = [
  "product_id",
  "variant_name",
  "variant_price",
  "variant_stock",
  "unit_id",
] as const;

const base = createCrudService(productVariantModel as Model<any>, {
  label: "ตัวเลือกสินค้า",
  searchFields: ["variant_name"],
  createFields: WRITABLE,
  updateFields: ["variant_name", "variant_price", "variant_stock", "unit_id"], // ห้ามย้าย product_id
  populate: [{ path: "unit_id", select: "unit_name unit_abbr" }],
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

// BACKLOG §3.11 เฟส 5b — variant_price เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
function presentVariant<T extends Record<string, unknown>>(v: T): T {
  return toBahtFields(v, ["variant_price"] as const);
}

export const productVariantService = {
  ...base,

  /** list โดยกรองด้วย product_id ได้ (?product_id=) ผ่าน filter ที่ route ส่งมา */
  async list(args: ListArgs) {
    const result = await base.list(args);
    return { ...result, items: result.items.map(presentVariant) };
  },

  async getById(id: string, includeDeleted?: boolean) {
    return presentVariant(await base.getById(id, includeDeleted));
  },

  async create(input: Record<string, any>) {
    if (!input.product_id) throw badRequest("กรุณาระบุ product_id");
    if (!input.variant_name) throw badRequest("กรุณาระบุ variant_name");
    await assertRefs(input);
    const payload =
      input.variant_price != null
        ? { ...input, variant_price: toSatang(Number(input.variant_price)) }
        : input;
    return presentVariant(await base.create(payload));
  },

  async update(id: string, input: Record<string, any>) {
    await assertRefs(input);
    const payload =
      input.variant_price != null
        ? { ...input, variant_price: toSatang(Number(input.variant_price)) }
        : input;
    return presentVariant(await base.update(id, payload));
  },

  async remove(id: string) {
    return presentVariant(await base.remove(id));
  },

  async restore(id: string) {
    return presentVariant(await base.restore(id));
  },
};

export default productVariantService;
