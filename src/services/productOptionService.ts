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

export const productOptionService = {
  ...base,

  async create(input: Record<string, any>) {
    if (!input.product_id) throw badRequest("กรุณาระบุ product_id");
    if (!input.option_name) throw badRequest("กรุณาระบุ option_name");
    await assertRefExists(productModel, input.product_id, "สินค้า", "product_id");
    validateShape(input);
    return base.create(input);
  },

  async update(id: string, input: Record<string, any>) {
    validateShape(input);
    return base.update(id, input);
  },
};

export default productOptionService;
