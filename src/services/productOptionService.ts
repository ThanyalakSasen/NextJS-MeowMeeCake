/**
 * productOptionService — CRUD ตัวเลือกเสริมของสินค้า (ProductOptions)
 * เช่น เขียนข้อความบนเค้ก / เพิ่มท็อปปิ้ง ที่มีราคาส่วนเพิ่ม
 *
 * ต่อยอดจาก crudService + ตรวจ product_id และความสอดคล้องของ is_text_input / max_text_length
 */
import type { Model } from "mongoose";
import productOptionModel from "../models/productOptionModel";
import productModel from "../models/productModel";
import { createCrudService } from "../lib/crudService";
import { assertRefExists } from "../lib/refs";
import { badRequest } from "../lib/httpError";
import { toSatang, toBahtFields } from "../lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRITABLE = [
  "product_id",
  "option_name",
  "is_text_input",
  "max_text_length",
  "extra_price",
  "is_required",
] as const;

const base = createCrudService(productOptionModel as Model<any>, {
  label: "ตัวเลือกเสริมสินค้า",
  searchFields: ["option_name"],
  createFields: WRITABLE,
  updateFields: [
    "option_name",
    "is_text_input",
    "max_text_length",
    "extra_price",
    "is_required",
  ],
});

function validateShape(input: Record<string, any>): void {
  if (input.extra_price != null && Number(input.extra_price) < 0) {
    throw badRequest("extra_price ต้องไม่ติดลบ");
  }
  // ถ้าเป็น text input ต้องมี max_text_length > 0; ถ้าไม่ใช่ ต้องไม่มีค่านี้
  if (input.is_text_input === true) {
    if (input.max_text_length == null || Number(input.max_text_length) < 1) {
      throw badRequest("ตัวเลือกแบบกรอกข้อความต้องระบุ max_text_length อย่างน้อย 1");
    }
  } else if (input.is_text_input === false) {
    input.max_text_length = null;
  }
}

// BACKLOG §3.11 เฟส 5b — extra_price เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
function presentOption<T extends Record<string, unknown>>(o: T): T {
  return toBahtFields(o, ["extra_price"] as const);
}

export const productOptionService = {
  ...base,

  async list(args: Parameters<typeof base.list>[0]) {
    const result = await base.list(args);
    return { ...result, items: result.items.map(presentOption) };
  },

  async getById(id: string, includeDeleted?: boolean) {
    return presentOption(await base.getById(id, includeDeleted));
  },

  async create(input: Record<string, any>) {
    if (!input.product_id) throw badRequest("กรุณาระบุ product_id");
    if (!input.option_name) throw badRequest("กรุณาระบุ option_name");
    await assertRefExists(productModel, input.product_id, "สินค้า", "product_id");
    validateShape(input);
    const payload =
      input.extra_price != null ? { ...input, extra_price: toSatang(Number(input.extra_price)) } : input;
    return presentOption(await base.create(payload));
  },

  async update(id: string, input: Record<string, any>) {
    validateShape(input);
    const payload =
      input.extra_price != null ? { ...input, extra_price: toSatang(Number(input.extra_price)) } : input;
    return presentOption(await base.update(id, payload));
  },

  async remove(id: string) {
    return presentOption(await base.remove(id));
  },

  async restore(id: string) {
    return presentOption(await base.restore(id));
  },
};

export default productOptionService;
