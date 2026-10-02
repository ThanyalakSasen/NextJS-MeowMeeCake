/**
 * dataIntegrityService — ตรวจข้อมูลผิดปกติที่มักเกิดจากการเขียน DB ตรงนอกแอป (docs/BACKLOG4.md Y11)
 *
 * ที่มา: BACKLOG2 §16 / BACKLOG4 R7 (ราคาหน่วยปนกันเพราะ FrontOffice เขียน DB ตรงเป็นบาท ขณะ backend เคยเก็บสตางค์ —
 * ตอนนี้ทั้งระบบเก็บเป็นบาทแล้ว docs/money-units.md) +
 * `product_type: "ready"` ที่เจอ 2026-09-30 — ทั้งคู่ไม่มี userlog เพราะไม่ผ่าน API จึงไม่มีใครรู้จนลูกค้าเห็นราคาเพี้ยน
 * ต้นทางยังหาไม่เจอ → ตรวจ "อาการ" แทนทุกวัน แล้วแจ้งเจ้าของร้านทันทีที่พบ (อ่านอย่างเดียว ไม่แก้ข้อมูลให้เอง)
 *
 * ตรวจเฉพาะสินค้า/ตัวเลือก/ตัวเลือกเสริมที่ยังไม่ถูกลบ:
 *   legacy_fields        ฟิลด์ schema เก่าค้าง (product_type / product_types / delete_at)
 *                        = สัญญาณว่ามีการ import export เก่าทับ
 *   is_preorder_missing  ไม่มี is_preorder แบบ boolean (ข้อมูลที่ไม่ผ่าน migrate-is-preorder)
 *   price_bad_precision  เงินมีทศนิยมเกิน 2 ตำแหน่ง (บาทมีแค่ถึงสตางค์)
 *   price_too_low        product_price < 1 บาท — น่าจะถูกหาร 100 ซ้ำ
 *   price_too_high       product_price > 10,000 บาท — น่าจะถูกเขียนเป็นสตางค์ (เช่นโค้ด/เครื่องมือรุ่นเก่า)
 *   sale_not_below_price sale_price ≥ product_price
 *   code_prefix_mismatch รหัสสินค้า pos-/pre- ไม่ตรงกับ is_preorder
 *   stock_invalid        สต็อกสินค้าปกติติดลบ/ไม่ใช่จำนวนเต็ม
 *   variant_stock_sum    สต็อกสินค้า ≠ ผลรวม variant_stock (BACKLOG4 Y9)
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { productCodePrefix } from "../lib/productCode";
import productModel from "../models/productModel";
import productVariantModel from "../models/productVariantModel";
import productOptionModel from "../models/productOptionModel";
import { notificationService } from "./notificationService";

export type IntegrityIssueCode =
  | "legacy_fields"
  | "is_preorder_missing"
  | "price_bad_precision"
  | "price_too_low"
  | "price_too_high"
  | "sale_not_below_price"
  | "code_prefix_mismatch"
  | "stock_invalid"
  | "variant_stock_sum";

export interface IntegrityIssue {
  code: IntegrityIssueCode;
  collection: "products" | "productvariants" | "productoptions";
  id: string;
  label: string;
  detail: string;
}

export interface IntegrityResult {
  checked: { products: number; variants: number; options: number };
  issues: IntegrityIssue[];
  notified: boolean;
}

/** ช่วงราคาสินค้าที่สมเหตุสมผล (บาท) — นอกช่วงนี้ = น่าจะหน่วยผิด (×100 / ÷100) */
export const MIN_PLAUSIBLE_PRICE_BAHT = 1;
export const MAX_PLAUSIBLE_PRICE_BAHT = 10_000;

/** มีทศนิยมเกิน 2 ตำแหน่งไหม (เผื่อ float error เล็กน้อย) */
const badPrecision = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) > 1e-6;
// หมายเหตุ: preparation_heating / yield_per_batch ยังอยู่ใน schema ปัจจุบัน (BACKLOG2 §16 เข้าใจผิดว่าเป็นฟิลด์เก่า) — ไม่นับ
const LEGACY_PRODUCT_FIELDS = ["product_type", "product_types", "delete_at"];

type RawDoc = Record<string, unknown> & { _id: unknown };

const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export async function checkDataIntegrity(opts: { notify?: boolean } = {}): Promise<IntegrityResult> {
  await dbConnect();
  const issues: IntegrityIssue[] = [];

  const products = (await productModel.collection.find({ deleted_at: null }).toArray()) as RawDoc[];
  const variants = (await productVariantModel.collection.find({ deleted_at: null }).toArray()) as RawDoc[];
  const options = (await productOptionModel.collection.find({ deleted_at: null }).toArray()) as RawDoc[];

  const variantSum = new Map<string, number>();
  for (const v of variants) {
    const key = String(v.product_id);
    variantSum.set(key, (variantSum.get(key) ?? 0) + (typeof v.variant_stock === "number" ? v.variant_stock : 0));
  }
  const productName = new Map(products.map((p) => [String(p._id), String(p.product_name_th ?? p._id)]));

  for (const p of products) {
    const id = String(p._id);
    const label = `${String(p.product_name_th ?? "")} (${String(p.product_id ?? id)})`;
    const add = (code: IntegrityIssueCode, detail: string) =>
      issues.push({ code, collection: "products", id, label, detail });

    const legacy = LEGACY_PRODUCT_FIELDS.filter((f) => f in p);
    if (legacy.length) add("legacy_fields", `มีฟิลด์เก่า: ${legacy.join(", ")}`);

    if (typeof p.is_preorder !== "boolean") add("is_preorder_missing", "ไม่มี is_preorder (true/false)");
    const isPreorder = p.is_preorder === true;

    for (const field of ["product_price", "sale_price", "purchase_cost"] as const) {
      const v = p[field];
      if (isMoney(v) && badPrecision(v)) add("price_bad_precision", `${field} = ${v} (ทศนิยมเกิน 2 ตำแหน่ง)`);
    }
    if (isMoney(p.product_price) && p.product_price < MIN_PLAUSIBLE_PRICE_BAHT) {
      add("price_too_low", `product_price = ${p.product_price} บาท (ต่ำผิดปกติ — ถูกหาร 100 ซ้ำ?)`);
    }
    if (isMoney(p.product_price) && p.product_price > MAX_PLAUSIBLE_PRICE_BAHT) {
      add("price_too_high", `product_price = ${p.product_price} บาท (สูงผิดปกติ — ถูกเขียนเป็นสตางค์?)`);
    }
    if (isMoney(p.sale_price) && isMoney(p.product_price) && p.sale_price >= p.product_price) {
      add("sale_not_below_price", `sale_price ${p.sale_price} ≥ product_price ${p.product_price}`);
    }

    if (typeof p.product_id === "string" && typeof p.is_preorder === "boolean") {
      const prefix = p.product_id.split("-")[0];
      if (prefix !== productCodePrefix(isPreorder)) {
        add("code_prefix_mismatch", `รหัส ${p.product_id} แต่ is_preorder = ${isPreorder}`);
      }
    }

    if (!isPreorder) {
      const stock = p.product_stock_quantity;
      if (typeof stock === "number" && (stock < 0 || !Number.isInteger(stock))) {
        add("stock_invalid", `product_stock_quantity = ${stock}`);
      }
      const sum = variantSum.get(id);
      if (sum !== undefined && (stock ?? 0) !== sum) {
        add("variant_stock_sum", `สต็อกสินค้า ${String(stock ?? 0)} ≠ ผลรวมตัวเลือก ${sum}`);
      }
    }
  }

  for (const v of variants) {
    if (isMoney(v.variant_price) && badPrecision(v.variant_price)) {
      issues.push({
        code: "price_bad_precision",
        collection: "productvariants",
        id: String(v._id),
        label: `${productName.get(String(v.product_id)) ?? String(v.product_id)} / ${String(v.variant_name ?? "")}`,
        detail: `variant_price = ${v.variant_price} (ทศนิยมเกิน 2 ตำแหน่ง)`,
      });
    }
  }
  for (const o of options) {
    if (isMoney(o.extra_price) && badPrecision(o.extra_price)) {
      issues.push({
        code: "price_bad_precision",
        collection: "productoptions",
        id: String(o._id),
        label: `${productName.get(String(o.product_id)) ?? String(o.product_id)} / ${String(o.option_name ?? "")}`,
        detail: `extra_price = ${o.extra_price} (ทศนิยมเกิน 2 ตำแหน่ง)`,
      });
    }
  }

  let notified = false;
  if (opts.notify && issues.length) {
    const lines = issues.slice(0, 10).map((i) => `• ${i.label}: ${i.detail}`);
    if (issues.length > 10) lines.push(`… และอีก ${issues.length - 10} รายการ`);
    try {
      await notificationService.notify({
        title: `ตรวจพบข้อมูลสินค้าผิดปกติ ${issues.length} รายการ`,
        message: `อาจมีการแก้ฐานข้อมูลตรงนอกระบบ — ตรวจและแก้ผ่านหน้าหลังบ้าน:\n${lines.join("\n")}`,
        module: "system",
        type: "warning",
        link: "/owner/products",
      });
      notified = true;
    } catch (err) {
      log.error("data_integrity.notify_failed", { err });
    }
  }
  if (issues.length) log.warn("data_integrity.issues", { count: issues.length, codes: [...new Set(issues.map((i) => i.code))] });

  return {
    checked: { products: products.length, variants: variants.length, options: options.length },
    issues,
    notified,
  };
}
