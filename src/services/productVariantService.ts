/**
 * productVariantService — CRUD ตัวเลือกสินค้าแบบมีหลายแบบ (ProductVariants)
 * เช่น รสชาติ / ขนาด ที่มีราคาบวกเพิ่ม (ไม่มีสต็อกแยก — สต็อกอยู่ที่ตัวสินค้า · docs/customer-backend-merge.md §8)
 * ตั้งทั้งชุดแบบกลุ่มได้ที่ productCustomizationService (/api/admin/products/[id]/customization)
 *
 * ต่อยอดจาก crudService + ตรวจว่า product_id (และ unit_id ถ้ามี) อ้างถึงเอกสารที่มีจริง
 */
import type { Model } from "mongoose";
import productVariantModel from "../models/productVariantModel";
import productModel from "../models/productModel";
import unitModel from "../models/unitModel";
import productVariantGroupModel from "../models/productVariantGroupModel";
import { createCrudService } from "../lib/crudService";
import { assertRefExists } from "../lib/refs";
import { badRequest } from "../lib/httpError";
import { toSatang, toBahtFields } from "../lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRITABLE = [
  "product_id",
  "variant_name",
  "variant_price",
  "group_id",
  "unit_id",
] as const;

// variant_price — เงินเก็บเป็นบาท ทศนิยม 2 ตำแหน่ง (docs/money-units.md) · presenter แค่ปัดก่อนคืน
function presentVariant<T extends Record<string, unknown>>(v: T): T {
  return toBahtFields(v, ["variant_price"] as const);
}

const base = createCrudService(productVariantModel as Model<any>, {
  label: "ตัวเลือกสินค้า",
  searchFields: ["variant_name"],
  createFields: WRITABLE,
  updateFields: ["variant_name", "variant_price", "group_id", "unit_id"], // ห้ามย้าย product_id
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
  if (input.group_id) {
    const group = await productVariantGroupModel
      .findOne({ _id: input.group_id, deleted_at: null })
      .select("product_id")
      .lean<{ product_id: unknown } | null>();
    if (!group) throw badRequest("ไม่พบกลุ่มตัวเลือก (group_id)");
    if (input.product_id && String(group.product_id) !== String(input.product_id)) {
      throw badRequest("กลุ่มตัวเลือกไม่ใช่ของสินค้านี้");
    }
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
    return base.create(payload);
  },

  async update(id: string, input: Record<string, any>) {
    await assertRefs(input);
    const payload =
      input.variant_price != null
        ? { ...input, variant_price: toSatang(Number(input.variant_price)) }
        : input;
    return base.update(id, payload);
  },
};

export default productVariantService;
