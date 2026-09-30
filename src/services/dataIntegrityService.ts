/**
 * dataIntegrityService — ตรวจข้อมูลผิดปกติที่มักเกิดจากการเขียน DB ตรงนอกแอป (docs/BACKLOG4.md Y11)
 *
 * ที่มา: BACKLOG2 §16 (product_price ถูกเขียนทับเป็นบาทผ่าน Compass/Atlas UI ทั้งที่ API แปลงสตางค์ถูกต้อง) +
 * `product_type: "ready"` ที่เจอ 2026-09-30 — ทั้งคู่ไม่มี userlog เพราะไม่ผ่าน API จึงไม่มีใครรู้จนลูกค้าเห็นราคาเพี้ยน
 * ต้นทางยังหาไม่เจอ → ตรวจ "อาการ" แทนทุกวัน แล้วแจ้งเจ้าของร้านทันทีที่พบ (อ่านอย่างเดียว ไม่แก้ข้อมูลให้เอง)
 *
 * ตรวจเฉพาะสินค้า/ตัวเลือก/ตัวเลือกเสริมที่ยังไม่ถูกลบ:
 *   legacy_fields        ฟิลด์ schema เก่าค้าง (product_type / product_types / delete_at)
 *                        = สัญญาณว่ามีการ import export เก่าทับ
 *   is_preorder_missing  ไม่มี is_preorder แบบ boolean (ข้อมูลที่ไม่ผ่าน migrate-is-preorder)
 *   price_not_integer    เงินมีทศนิยม — สตางค์เป็นจำนวนเต็มเสมอ → เป็นบาทแน่นอน
 *   price_too_low        product_price < 1,000 สตางค์ (10 บาท) — อาการเดียวกับ §16 (65 → แสดง 0.65 บาท)
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
  | "price_not_integer"
  | "price_too_low"
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

/** ราคาต่ำกว่านี้ (สตางค์) = น่าจะถูกเขียนเป็นบาท — ร้านเบเกอรี่ไม่มีสินค้าต่ำกว่า 10 บาท */
export const MIN_PLAUSIBLE_PRICE_SATANG = 1000;
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
      if (isMoney(v) && !Number.isInteger(v)) add("price_not_integer", `${field} = ${v} (มีทศนิยม — น่าจะเป็นบาท)`);
    }
    if (isMoney(p.product_price) && p.product_price < MIN_PLAUSIBLE_PRICE_SATANG) {
      add("price_too_low", `product_price = ${p.product_price} สตางค์ (แสดง ${p.product_price / 100} บาท)`);
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
    if (isMoney(v.variant_price) && !Number.isInteger(v.variant_price)) {
      issues.push({
        code: "price_not_integer",
        collection: "productvariants",
        id: String(v._id),
        label: `${productName.get(String(v.product_id)) ?? String(v.product_id)} / ${String(v.variant_name ?? "")}`,
        detail: `variant_price = ${v.variant_price} (มีทศนิยม — น่าจะเป็นบาท)`,
      });
    }
  }
  for (const o of options) {
    if (isMoney(o.extra_price) && !Number.isInteger(o.extra_price)) {
      issues.push({
        code: "price_not_integer",
        collection: "productoptions",
        id: String(o._id),
        label: `${productName.get(String(o.product_id)) ?? String(o.product_id)} / ${String(o.option_name ?? "")}`,
        detail: `extra_price = ${o.extra_price} (มีทศนิยม — น่าจะเป็นบาท)`,
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
