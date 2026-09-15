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

// BACKLOG §3.11 เฟส 5b — extra_price เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
function presentOption<T extends Record<string, unknown>>(o: T): T {
  return toBahtFields(o, ["extra_price"] as const);
}

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
  present: presentOption, // BACKLOG3 §8 — ครอบ list/getById/create/update/remove/restore ให้เองในตัว
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

export interface SelectedOptionInput {
  option_id: string;
  text_value?: string | null;
}

export interface ResolvedOption {
  option_id: unknown;
  option_name: string;
  extra_price: number;
  text_value: string | null;
}

/**
 * BACKLOG3 §6 — ตรวจ + คิดราคา option ที่ลูกค้าเลือก เทียบกับ option doc จริง เดิม cartService
 * (`resolveOptions`) กับ orderService (`resolveLines`) ต่างเขียน logic เดียวกันซ้ำ (is_text_input/
 * is_required/max_text_length + ข้อความ error) แยกกัน — รวมมาไว้ที่นี่
 *
 * **รับ `optionById` เป็น Map ที่ผู้เรียกเตรียมมาเอง ไม่ query เองในนี้** — เพราะ orderService.
 * resolveLines() ต้อง batch query option ของ**ทุกรายการในออเดอร์พร้อมกัน**ครั้งเดียว (BACKLOG §3.18
 * กัน N+1) ถ้าฟังก์ชันนี้ query เองต่อ 1 เรียก จะทำให้ resolveLines() กลับไปเป็น N+1 เหมือนก่อนแก้
 * §3.18 ทันที — ส่วน cartService (เพิ่ม/แก้ทีละ 1 รายการ ไม่มี "หลายรายการพร้อมกัน" ให้ batch) ยัง query
 * เองแบบเดิมแล้วสร้าง Map เล็ก ๆ ส่งเข้ามา
 */
export function resolveSelectedOptions(
  productId: string,
  selected: SelectedOptionInput[] = [],
  optionById: Map<string, Record<string, any>>
): ResolvedOption[] {
  if (!Array.isArray(selected) || selected.length === 0) return [];

  return selected.map((sel) => {
    const opt = optionById.get(String(sel.option_id));
    const belongsToProduct = opt && String(opt.product_id) === String(productId);
    if (!belongsToProduct) throw badRequest(`ไม่พบตัวเลือกเสริม ${sel.option_id} ของสินค้านี้`);

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

// BACKLOG3 §8 — list/getById/remove/restore ไม่ต้อง override เองแล้ว (base.present ทำให้แล้ว) เหลือแค่
// create/update ที่ยังต้อง override เพราะมี validation เพิ่มเติม
export const productOptionService = {
  ...base,

  async create(input: Record<string, any>) {
    if (!input.product_id) throw badRequest("กรุณาระบุ product_id");
    if (!input.option_name) throw badRequest("กรุณาระบุ option_name");
    await assertRefExists(productModel, input.product_id, "สินค้า", "product_id");
    validateShape(input);
    const payload =
      input.extra_price != null ? { ...input, extra_price: toSatang(Number(input.extra_price)) } : input;
    return base.create(payload);
  },

  async update(id: string, input: Record<string, any>) {
    validateShape(input);
    const payload =
      input.extra_price != null ? { ...input, extra_price: toSatang(Number(input.extra_price)) } : input;
    return base.update(id, payload);
  },
};

export default productOptionService;
