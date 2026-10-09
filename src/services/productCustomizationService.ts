/**
 * productCustomizationService — ตัวเลือกสินค้าแบบกลุ่ม (ย้ายมาจาก backend ฝั่งลูกค้า · docs/customer-backend-merge.md §8)
 *
 *   - กลุ่มตัวเลือก (ProductVariantGroups + ProductVariants) เช่น "ขนาด" เลือก 1, "รสชาติ" เลือกได้สูงสุด 2
 *     แต่ละกลุ่มกำหนด min_select (0 = ไม่บังคับ) / max_select · variant_price = ราคาที่ "บวกเพิ่ม" จากราคาสินค้า
 *     ตัวเลือกเก่าที่ยังไม่มีกลุ่ม (group_id = null) นับเป็นกลุ่ม "ตัวเลือก" เลือก 1 (บังคับ)
 *   - ออปชันเสริม (ProductOptions) เช่น เทียนวันเกิด (+20) / ข้อความบนเค้ก (กรอกข้อความ) — เลือกได้หลายอย่าง
 *     is_required = ต้องเลือก (ถ้าเป็นช่องกรอกข้อความ = ต้องกรอก)
 *   - ตัวเลือกเป็นแค่ราคาเพิ่ม **ไม่มีสต็อกแยก** — สต็อกอยู่ที่ตัวสินค้า (เลิก Y9 แล้ว)
 *
 * ราคาและชื่อดึงจาก DB เสมอ — ไม่เชื่อราคา/ชื่อจาก client · ใช้ร่วมกันทั้งตะกร้า ออเดอร์ (เว็บ + POS) และพรีออเดอร์
 */
import productModel from "../models/productModel";
import productVariantGroupModel from "../models/productVariantGroupModel";
import productVariantModel from "../models/productVariantModel";
import productOptionModel from "../models/productOptionModel";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId, isObjectId } from "../lib/objectId";
import { round2 } from "../lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CustomizationVariant {
  _id: string;
  variant_name: string;
  variant_price: number;
}

export interface CustomizationGroup {
  _id: string;
  group_name: string;
  min_select: number;
  max_select: number;
  variants: CustomizationVariant[];
}

export interface CustomizationOption {
  _id: string;
  option_name: string;
  is_text_input: boolean;
  max_text_length: number | null;
  extra_price: number;
  is_required: boolean;
}

export interface ProductCustomization {
  groups: CustomizationGroup[];
  options: CustomizationOption[];
}

/** สิ่งที่ client ส่งมาต่อ 1 รายการ */
export interface CustomizationInput {
  /** ตัวเลือกที่เลือกทุกกลุ่ม */
  variant_ids?: string[] | null;
  /** แบบเดิม — ตัวเลือกเดียว (POS / ตะกร้าเก่า) */
  variant_id?: string | null;
  selected_options?: { option_id: string; text_value?: string | null }[] | null;
}

export interface SelectedVariant {
  group_name: string;
  variant_id: string;
  variant_name: string;
  variant_price: number;
}

export interface SelectedOption {
  option_id: string;
  option_name: string;
  extra_price: number;
  text_value: string | null;
}

export interface ResolvedCustomization {
  /** variant_id เดิมรองรับตัวเลือกเดียว — มีค่าเมื่อเลือกอย่างเดียว ที่เหลือดูจาก selected_variants */
  variant_id: string | null;
  selected_variants: SelectedVariant[];
  /** ข้อความรวม เช่น "ขนาด: 2 ปอนด์ · รสชาติ: ช็อกโกแลต, วานิลลา" — null = ไม่มีตัวเลือก */
  variant_name: string | null;
  selected_options: SelectedOption[];
  /** ราคาที่บวกเพิ่มต่อชิ้น (ตัวเลือก + ออปชัน) — บาท */
  extra_price: number;
  /** key ของชุดตัวเลือก — ใช้รวมรายการซ้ำในตะกร้า ("" = ไม่มีตัวเลือก) */
  key: string;
}

const MAX_TEXT_LENGTH_DEFAULT = 100;
/** id ของกลุ่มสมมติสำหรับตัวเลือกเก่าที่ยังไม่มีกลุ่ม */
export const LEGACY_GROUP_ID = "legacy";

// ── อ่าน ─────────────────────────────────────────────────────
function build(groups: any[], variants: any[], options: any[]): ProductCustomization {
  const byOrder = (a: any, b: any) =>
    (a.display_order ?? 0) - (b.display_order ?? 0) ||
    new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
  const toVariant = (v: any): CustomizationVariant => ({
    _id: String(v._id),
    variant_name: String(v.variant_name ?? ""),
    variant_price: Number(v.variant_price ?? 0),
  });
  const sortedVariants = [...variants].sort(byOrder);

  const groupIds = new Set(groups.map((g) => String(g._id)));
  const result: CustomizationGroup[] = [...groups]
    .sort(byOrder)
    .map((g) => {
      const min = Math.max(0, Number(g.min_select ?? 1));
      return {
        _id: String(g._id),
        group_name: String(g.group_name ?? ""),
        min_select: min,
        max_select: Math.max(1, min, Number(g.max_select ?? 1)),
        variants: sortedVariants.filter((v) => String(v.group_id ?? "") === String(g._id)).map(toVariant),
      };
    })
    .filter((g) => g.variants.length > 0);

  // ตัวเลือกเก่าที่ไม่มีกลุ่ม (หรือกลุ่มถูกลบไปแล้ว) → กลุ่ม "ตัวเลือก" เลือก 1 (บังคับ)
  const orphans = sortedVariants.filter((v) => !v.group_id || !groupIds.has(String(v.group_id)));
  if (orphans.length > 0) {
    result.unshift({ _id: LEGACY_GROUP_ID, group_name: "ตัวเลือก", min_select: 1, max_select: 1, variants: orphans.map(toVariant) });
  }

  return {
    groups: result,
    options: [...options].sort(byOrder).map((o) => ({
      _id: String(o._id),
      option_name: String(o.option_name ?? ""),
      is_text_input: o.is_text_input === true,
      max_text_length: typeof o.max_text_length === "number" ? o.max_text_length : null,
      extra_price: Number(o.extra_price ?? 0),
      is_required: o.is_required === true,
    })),
  };
}

/** ตัวเลือกของสินค้าหลายตัวพร้อมกัน (query ละ 1 ครั้งต่อ collection — กัน N+1 ตอนคิดราคาทั้งออเดอร์) */
export async function getCustomizations(productIds: string[]): Promise<Map<string, ProductCustomization>> {
  const ids = [...new Set(productIds.map(String))].filter(isObjectId);
  const out = new Map<string, ProductCustomization>();
  if (ids.length === 0) return out;
  const filter = { product_id: { $in: ids }, deleted_at: null };
  const [groups, variants, options] = await Promise.all([
    productVariantGroupModel.find(filter).lean<any[]>(),
    productVariantModel.find(filter).lean<any[]>(),
    productOptionModel.find(filter).lean<any[]>(),
  ]);
  const of = (rows: any[], id: string) => rows.filter((r) => String(r.product_id) === id);
  for (const id of ids) out.set(id, build(of(groups, id), of(variants, id), of(options, id)));
  return out;
}

/**
 * สินค้าไหนมีตัวเลือกให้เลือก (เทียบเท่า groups.length > 0 || options.length > 0 ของ getCustomizations —
 * กลุ่มที่ไม่มีตัวเลือกไม่นับ · ตัวเลือกที่ไม่มีกลุ่มนับ) · distinct 2 ครั้ง ไม่โหลดทั้งแถว
 * POS ใช้เป็น flag has_customization ในรายการสินค้า — ไม่ต้องเรียกทีละสินค้า (frontend Q-BE9)
 */
export async function productIdsWithCustomization(productIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(productIds.map(String))].filter(isObjectId);
  if (ids.length === 0) return new Set();
  const filter = { product_id: { $in: ids }, deleted_at: null };
  const [withVariants, withOptions] = await Promise.all([
    productVariantModel.distinct("product_id", filter),
    productOptionModel.distinct("product_id", filter),
  ]);
  return new Set([...withVariants, ...withOptions].map(String));
}

export async function getProductCustomization(productId: string): Promise<ProductCustomization> {
  return (await getCustomizations([productId])).get(String(productId)) ?? { groups: [], options: [] };
}

// ── ตรวจ + คิดราคา ───────────────────────────────────────────
/** รวม variant_ids / variant_id (แบบเดิม) เป็นรายการเดียว */
function wantedVariantIds(input: CustomizationInput): string[] {
  const ids = Array.isArray(input.variant_ids) && input.variant_ids.length > 0
    ? input.variant_ids
    : input.variant_id
      ? [input.variant_id]
      : [];
  return [...new Set(ids.map((id) => String(id ?? "")).filter(Boolean))];
}

/** assert รูปแบบ id ที่ client ส่งมา (เรียกก่อน query DB) */
export function assertCustomizationIds(input: CustomizationInput): void {
  for (const id of wantedVariantIds(input)) assertObjectId(id, "variant_ids");
  for (const o of input.selected_options ?? []) assertObjectId(o?.option_id, "option_id");
}

export function joinSelectedVariants(selected: { group_name: string; variant_name: string }[]): string | null {
  if (selected.length === 0) return null;
  const byGroup = new Map<string, string[]>();
  for (const v of selected) byGroup.set(v.group_name, [...(byGroup.get(v.group_name) ?? []), v.variant_name]);
  return [...byGroup.entries()]
    .map(([group, names]) => (group ? `${group}: ${names.join(", ")}` : names.join(", ")))
    .join(" · ");
}

/**
 * ตรวจตัวเลือกที่เลือกกับข้อมูลจริง แล้วคืนราคาเพิ่ม + snapshot ที่พร้อมบันทึก — ผิดกติกา → throw 400
 * กติกา: แต่ละกลุ่มเลือกได้ min_select–max_select อย่าง · ออปชันที่บังคับต้องเลือก/กรอก · ข้อความยาวไม่เกินที่ร้านกำหนด
 */
export function resolveCustomization(
  custom: ProductCustomization,
  input: CustomizationInput,
  productName = "สินค้านี้"
): ResolvedCustomization {
  // ── กลุ่มตัวเลือก ──
  const wanted = new Set(wantedVariantIds(input));
  const allVariantIds = new Set(custom.groups.flatMap((g) => g.variants.map((v) => v._id)));
  for (const id of wanted) {
    if (!allVariantIds.has(id)) {
      throw badRequest(
        custom.groups.length > 0
          ? `ไม่พบตัวเลือกสินค้าที่เลือกของ "${productName}" กรุณาเลือกใหม่`
          : `ไม่พบตัวเลือกสินค้า — "${productName}" ไม่มีตัวเลือกให้เลือก`
      );
    }
  }

  const selectedVariants: SelectedVariant[] = [];
  for (const group of custom.groups) {
    const picked = group.variants.filter((v) => wanted.has(v._id));
    if (picked.length < group.min_select) {
      throw badRequest(
        group.min_select === 1 && group.max_select === 1
          ? `กรุณาเลือก "${group.group_name}" ของ "${productName}"`
          : `กรุณาเลือก "${group.group_name}" ของ "${productName}" อย่างน้อย ${group.min_select} อย่าง`
      );
    }
    if (picked.length > group.max_select) {
      throw badRequest(`"${group.group_name}" ของ "${productName}" เลือกได้ไม่เกิน ${group.max_select} อย่าง`);
    }
    for (const v of picked) {
      selectedVariants.push({ group_name: group.group_name, variant_id: v._id, variant_name: v.variant_name, variant_price: v.variant_price });
    }
  }

  // ── ออปชันเสริม ──
  const chosen = new Map<string, string | null>();
  for (const raw of (input.selected_options ?? []).slice(0, 50)) {
    const id = String(raw?.option_id ?? "");
    if (!id || chosen.has(id)) continue;
    chosen.set(id, typeof raw?.text_value === "string" ? raw.text_value : null);
  }
  for (const [id] of chosen) {
    if (!custom.options.some((o) => o._id === id)) throw badRequest(`ไม่พบตัวเลือกเสริม ${id} ของ "${productName}"`);
  }

  const selectedOptions: SelectedOption[] = [];
  for (const option of custom.options) {
    if (option.is_text_input) {
      const text = (chosen.get(option._id) ?? "").replace(/\s+/g, " ").trim();
      if (!text) {
        if (option.is_required) throw badRequest(`ตัวเลือก "${option.option_name}" ของ "${productName}" ต้องกรอกข้อความ`);
        continue; // ไม่กรอก = ไม่เลือก (ไม่คิดเงิน)
      }
      const max = option.max_text_length ?? MAX_TEXT_LENGTH_DEFAULT;
      if (text.length > max) throw badRequest(`ข้อความของ "${option.option_name}" ยาวเกิน ${max} ตัวอักษร`);
      selectedOptions.push({ option_id: option._id, option_name: option.option_name, extra_price: option.extra_price, text_value: text });
    } else {
      if (!chosen.has(option._id)) {
        if (option.is_required) throw badRequest(`กรุณาเลือก "${option.option_name}" ของ "${productName}"`);
        continue;
      }
      selectedOptions.push({ option_id: option._id, option_name: option.option_name, extra_price: option.extra_price, text_value: null });
    }
  }

  const extra = round2(
    selectedVariants.reduce((s, v) => s + v.variant_price, 0) + selectedOptions.reduce((s, o) => s + o.extra_price, 0)
  );
  const variantKey = selectedVariants.map((v) => v.variant_id).sort().join(",");
  const optionKey = selectedOptions.map((o) => `${o.option_id}=${o.text_value ?? ""}`).join("|");

  return {
    variant_id: selectedVariants.length === 1 ? selectedVariants[0].variant_id : null,
    selected_variants: selectedVariants,
    variant_name: joinSelectedVariants(selectedVariants),
    selected_options: selectedOptions,
    extra_price: extra,
    key: variantKey || optionKey ? `${variantKey}#${optionKey}` : "",
  };
}

// ── หลังร้าน: บันทึกทั้งชุด ───────────────────────────────────
const MAX_OPTIONS = 20;
const MAX_GROUPS = 10;
const MAX_VARIANTS_PER_GROUP = 20;
const MAX_NAME = 100;
const MAX_PRICE = 100000;
const MAX_TEXT_LIMIT = 200;

function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function cleanPrice(v: unknown): number | null {
  const n = v === "" || v === null || v === undefined ? 0 : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? round2(n) : null;
}

const idOrNull = (v: unknown) => (v && isObjectId(String(v)) ? String(v) : null);

/**
 * PUT ทั้งชุด: { groups: [{ _id?, group_name, min_select, max_select, variants: [{ _id?, variant_name, variant_price }] }],
 *               options: [{ _id?, option_name, is_text_input, max_text_length, extra_price, is_required }] }
 * มี _id = แก้ · ไม่มี _id = เพิ่ม · หายไปจากชุด = ลบ (soft delete) — ออเดอร์เก่าเก็บ snapshot ไว้แล้ว ไม่กระทบ
 * MongoDB ของร้านเป็น standalone (ไม่มี transaction) → ตรวจทั้งชุดให้ผ่านก่อน แล้วค่อยเขียน
 */
export async function saveProductCustomization(productId: string, body: any): Promise<ProductCustomization> {
  assertObjectId(productId, "product_id");
  if (!(await productModel.exists({ _id: productId, deleted_at: null }))) throw notFound("ไม่พบสินค้า");

  const rawGroups = Array.isArray(body?.groups) ? (body.groups as any[]) : null;
  const rawOptions = Array.isArray(body?.options) ? (body.options as any[]) : null;
  if (!rawGroups || !rawOptions) throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง (ต้องมี groups และ options)");
  if (rawGroups.length > MAX_GROUPS) throw badRequest(`กลุ่มตัวเลือกมีได้ไม่เกิน ${MAX_GROUPS} กลุ่ม`);
  if (rawOptions.length > MAX_OPTIONS) throw badRequest(`ออปชันเสริมมีได้ไม่เกิน ${MAX_OPTIONS} รายการ`);

  // ── ตรวจกลุ่มตัวเลือก ──
  type VariantIn = { _id: string | null; variant_name: string; variant_price: number };
  const groups: { _id: string | null; group_name: string; min_select: number; max_select: number; variants: VariantIn[] }[] = [];
  const groupNames = new Set<string>();
  for (const [gi, g] of rawGroups.entries()) {
    const groupName = cleanName(g?.group_name);
    const gLabel = `กลุ่มตัวเลือกลำดับที่ ${gi + 1}`;
    if (!groupName) throw badRequest(`${gLabel}: กรุณากรอกชื่อกลุ่ม`);
    if (groupName.length > MAX_NAME) throw badRequest(`${gLabel}: ชื่อยาวเกิน ${MAX_NAME} ตัวอักษร`);
    if (groupNames.has(groupName.toLowerCase())) throw badRequest(`กลุ่มตัวเลือก "${groupName}" ซ้ำกัน`);
    groupNames.add(groupName.toLowerCase());

    const rawVariants = Array.isArray(g?.variants) ? (g.variants as any[]) : [];
    if (rawVariants.length === 0) throw badRequest(`กลุ่ม "${groupName}": ต้องมีตัวเลือกอย่างน้อย 1 อย่าง`);
    if (rawVariants.length > MAX_VARIANTS_PER_GROUP) {
      throw badRequest(`กลุ่ม "${groupName}": มีตัวเลือกได้ไม่เกิน ${MAX_VARIANTS_PER_GROUP} อย่าง`);
    }
    const variants: VariantIn[] = [];
    const variantNames = new Set<string>();
    for (const [vi, v] of rawVariants.entries()) {
      const name = cleanName(v?.variant_name);
      const price = cleanPrice(v?.variant_price);
      const label = `กลุ่ม "${groupName}" ตัวเลือกที่ ${vi + 1}`;
      if (!name) throw badRequest(`${label}: กรุณากรอกชื่อ`);
      if (name.length > MAX_NAME) throw badRequest(`${label}: ชื่อยาวเกิน ${MAX_NAME} ตัวอักษร`);
      if (price === null) throw badRequest(`${label}: ราคาเพิ่มต้องเป็นตัวเลข 0–${MAX_PRICE}`);
      if (variantNames.has(name.toLowerCase())) throw badRequest(`กลุ่ม "${groupName}": ตัวเลือก "${name}" ซ้ำกัน`);
      variantNames.add(name.toLowerCase());
      variants.push({ _id: idOrNull(v?._id), variant_name: name, variant_price: price });
    }

    const min = Number(g?.min_select ?? 1);
    const max = Number(g?.max_select ?? 1);
    if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < 1) {
      throw badRequest(`กลุ่ม "${groupName}": จำนวนที่เลือกได้ไม่ถูกต้อง`);
    }
    if (min > max) throw badRequest(`กลุ่ม "${groupName}": เลือกขั้นต่ำต้องไม่มากกว่าเลือกได้สูงสุด`);
    if (min > variants.length) throw badRequest(`กลุ่ม "${groupName}": เลือกขั้นต่ำมากกว่าจำนวนตัวเลือกที่มี`);

    // กลุ่มของตัวเลือกเก่า (id "legacy") ยังไม่มีเอกสารจริง → สร้างใหม่
    groups.push({ _id: idOrNull(g?._id), group_name: groupName, min_select: min, max_select: Math.min(max, variants.length), variants });
  }

  // ── ตรวจออปชัน ──
  const options: {
    _id: string | null; option_name: string; is_text_input: boolean; max_text_length: number | null;
    extra_price: number; is_required: boolean;
  }[] = [];
  const optionNames = new Set<string>();
  for (const [i, o] of rawOptions.entries()) {
    const name = cleanName(o?.option_name);
    const price = cleanPrice(o?.extra_price);
    const label = `ออปชันลำดับที่ ${i + 1}`;
    if (!name) throw badRequest(`${label}: กรุณากรอกชื่อ`);
    if (name.length > MAX_NAME) throw badRequest(`${label}: ชื่อยาวเกิน ${MAX_NAME} ตัวอักษร`);
    if (price === null) throw badRequest(`${label}: ราคาเพิ่มต้องเป็นตัวเลข 0–${MAX_PRICE}`);
    if (optionNames.has(name.toLowerCase())) throw badRequest(`ออปชัน "${name}" ซ้ำกัน`);
    optionNames.add(name.toLowerCase());
    const isText = o?.is_text_input === true;
    let maxLen: number | null = null;
    if (isText) {
      maxLen = Number(o?.max_text_length);
      if (!Number.isInteger(maxLen) || maxLen < 1 || maxLen > MAX_TEXT_LIMIT) {
        throw badRequest(`${label}: จำนวนตัวอักษรสูงสุดต้องอยู่ระหว่าง 1–${MAX_TEXT_LIMIT}`);
      }
    }
    options.push({ _id: idOrNull(o?._id), option_name: name, is_text_input: isText, max_text_length: maxLen, extra_price: price, is_required: o?.is_required === true });
  }

  // ── เขียน: ลบตัวที่หายไปจากชุด → แก้ตัวเดิม → เพิ่มตัวใหม่ ──
  const now = new Date();
  const keepGroupIds = groups.map((g) => g._id).filter((x): x is string => !!x);
  const keepVariantIds = groups.flatMap((g) => g.variants.map((v) => v._id)).filter((x): x is string => !!x);
  await productVariantGroupModel.updateMany(
    { product_id: productId, deleted_at: null, _id: { $nin: keepGroupIds } },
    { $set: { deleted_at: now } }
  );
  await productVariantModel.updateMany(
    { product_id: productId, deleted_at: null, _id: { $nin: keepVariantIds } },
    { $set: { deleted_at: now } }
  );
  for (const [gIndex, g] of groups.entries()) {
    const groupFields = { group_name: g.group_name, min_select: g.min_select, max_select: g.max_select, display_order: gIndex };
    let groupId = g._id
      ? ((await productVariantGroupModel.findOneAndUpdate(
          { _id: g._id, product_id: productId, deleted_at: null },
          { $set: groupFields }
        )) as any)?._id ?? null
      : null;
    if (!groupId) groupId = (await productVariantGroupModel.create({ ...groupFields, product_id: productId }))._id;
    for (const [index, v] of g.variants.entries()) {
      const fields = { group_id: groupId, variant_name: v.variant_name, variant_price: v.variant_price, display_order: index };
      const updated = v._id
        ? await productVariantModel.findOneAndUpdate({ _id: v._id, product_id: productId, deleted_at: null }, { $set: fields })
        : null;
      if (!updated) await productVariantModel.create({ ...fields, product_id: productId });
    }
  }

  const keepOptionIds = options.map((o) => o._id).filter((x): x is string => !!x);
  await productOptionModel.updateMany(
    { product_id: productId, deleted_at: null, _id: { $nin: keepOptionIds } },
    { $set: { deleted_at: now } }
  );
  for (const [index, o] of options.entries()) {
    const { _id, ...rest } = o;
    const fields = { ...rest, display_order: index };
    const updated = _id
      ? await productOptionModel.findOneAndUpdate({ _id, product_id: productId, deleted_at: null }, { $set: fields })
      : null;
    if (!updated) await productOptionModel.create({ ...fields, product_id: productId });
  }

  return getProductCustomization(productId);
}
