/**
 * shippingService — ค่าส่ง + จุดรับสินค้าของออเดอร์/พรีออเดอร์จากหน้าเว็บลูกค้า (storefront)
 * ย้ายมาจาก backend ฝั่งลูกค้า (docs/customer-backend-merge.md §8.7)
 *
 *   - ค่าส่ง: ShippingZones (โซนตามจังหวัด · เริ่มต้น A–D เพิ่ม/ลบได้ · D = จังหวัดที่เหลือ · ไม่มีส่งฟรีตามยอด — ส่งฟรีได้จากโปรโมชันเท่านั้น)
 *     หลังร้าน/POS ยังใช้ DeliveryZones (deliveryService) ตามเดิม — ผู้ใช้เลือกเก็บทั้งสองระบบ
 *   - ขอบเขตจัดส่ง: หมวดที่ไม่ส่งทั่วประเทศ (ships_nationwide) → ส่งได้เฉพาะในจังหวัดร้าน (StoreSettings.province)
 *   - จุดรับสินค้า: หน้าร้านประจำสัปดาห์ (StoreProfile.weekly_markets) ที่เปิดแสดง · กติกาวันรับใน src/lib/pickupLocations.ts
 */
import mongoose from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { round2 } from "../lib/money";
import type { ShippingZoneCreate, ShippingZoneUpdate } from "../schemas/shipping";
import shippingZoneModel from "../models/shippingZoneModel";
import storeProfileModel from "../models/storeProfileModel";
import storeSettingsModel from "../models/storeSettingsModel";
import productModel from "../models/productModel";
import productCategoryModel from "../models/productCategoryModel";
import {
  DEFAULT_SHIPPING_ZONES,
  categoryShipsNationwide,
  checkDeliveryArea,
  productShipsNationwide,
  computeShippingFee,
  FALLBACK_ZONE_CODE,
  type ShippingZone,
} from "../lib/shipping";
import {
  DAY_ORDER,
  dateKeyToBangkokMidnight,
  formatLocationSchedule,
  orderPickupDateOptions,
  preorderPickupDateOptions,
  type DayKey,
  type PickupLocation,
} from "../lib/pickupLocations";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── โซนค่าส่ง ────────────────────────────────────────────────
/** โซนค่าส่งทั้งหมด (เรียงตามรหัส · โซนสำรอง D ไว้ท้ายสุด) — ยังไม่มีใน DB เลย → สร้างชุดเริ่มต้น A–D ให้ (แบบเดียวกับฝั่งลูกค้า) */
export async function getShippingZones(): Promise<ShippingZone[]> {
  await dbConnect();
  if ((await shippingZoneModel.countDocuments()) === 0) {
    await shippingZoneModel.insertMany(DEFAULT_SHIPPING_ZONES).catch((err: any) => {
      if (err?.code !== 11000) throw err; // อีกคำขอ seed พร้อมกัน (zone_code unique)
    });
  }
  const zones = await shippingZoneModel
    .find()
    .select("zone_code zone_label provinces fee")
    .sort({ zone_code: 1 })
    .lean<ShippingZone[]>();
  // โซนสำรองไว้ท้ายสุด (ใช้เมื่อไม่ตรงโซนไหนเลย) — โซนที่เพิ่มใหม่ (E, F, …) อยู่ก่อนหน้า
  return [...zones.filter((z) => z.zone_code !== FALLBACK_ZONE_CODE), ...zones.filter((z) => z.zone_code === FALLBACK_ZONE_CODE)];
}

/** จังหวัดซ้ำกับโซนอื่น → 409 บอกชื่อจังหวัด + โซน */
function assertNoProvinceClash(zones: ShippingZone[], zoneCode: string | null, provinces: string[]) {
  const taken = new Map<string, string>();
  for (const z of zones) if (z.zone_code !== zoneCode) for (const p of z.provinces) taken.set(p.trim(), z.zone_code);
  const clashes = provinces.filter((p) => taken.has(p));
  if (clashes.length > 0) {
    throw conflict(`จังหวัดอยู่ในโซนอื่นแล้ว: ${clashes.map((p) => `${p} (โซน ${taken.get(p)})`).join(", ")} — เอาออกจากโซนเดิมก่อน`);
  }
}

const ZONE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** เพิ่มโซนใหม่ — รหัสเป็นตัวอักษรถัดไปที่ยังว่าง (E, F, … หรือรหัสที่เคยลบไป) · สูงสุด 26 โซน */
export async function createShippingZone(input: ShippingZoneCreate): Promise<ShippingZone> {
  const zones = await getShippingZones();
  const used = new Set(zones.map((z) => z.zone_code));
  const code = ZONE_LETTERS.find((c) => !used.has(c));
  if (!code) throw badRequest("เพิ่มโซนได้สูงสุด 26 โซน (A–Z)");
  assertNoProvinceClash(zones, null, input.provinces);
  try {
    const doc = await shippingZoneModel.create({ zone_code: code, zone_label: input.zone_label, fee: round2(input.fee), provinces: input.provinces });
    return { zone_code: doc.zone_code, zone_label: doc.zone_label, provinces: doc.provinces, fee: doc.fee };
  } catch (err: any) {
    if (err?.code === 11000) throw conflict("มีคนเพิ่มโซนพร้อมกัน กรุณาลองอีกครั้ง");
    throw err;
  }
}

/** ลบโซน — โซนสำรอง (D) ลบไม่ได้ · จังหวัดของโซนที่ลบจะไปใช้ค่าส่งโซน D */
export async function deleteShippingZone(zoneCode: string): Promise<ShippingZone> {
  if (zoneCode === FALLBACK_ZONE_CODE) throw badRequest(`โซน ${FALLBACK_ZONE_CODE} ใช้กับจังหวัดที่ไม่อยู่ในโซนอื่น — ลบไม่ได้`);
  await getShippingZones();
  const doc = await shippingZoneModel.findOneAndDelete({ zone_code: zoneCode }).select("zone_code zone_label provinces fee").lean<ShippingZone | null>();
  if (!doc) throw notFound("ไม่พบโซนค่าส่งนี้");
  return doc;
}

/**
 * แก้โซนค่าส่ง 1 โซน (หลังร้าน · PATCH /api/admin/shipping-zones/:zone_code · frontend Q-BE2)
 *   - รูปแบบ (ชื่อจังหวัด 77 จังหวัด · fee ≥ 0) ตรวจที่ schemas/shipping.ts แล้ว
 *   - โซน D = จังหวัดที่ไม่อยู่ใน A–C (computeShippingFee ไม่ดู provinces ของ D) → ใส่จังหวัดไม่ได้
 *   - จังหวัดเดียวกันอยู่ได้โซนเดียว — ชนกับโซนอื่น = 409 บอกชื่อจังหวัด + โซน
 * คืน { before, after } ให้ route เขียน audit log
 */
export async function updateShippingZone(
  zoneCode: string,
  input: ShippingZoneUpdate
): Promise<{ before: ShippingZone; after: ShippingZone }> {
  const zones = await getShippingZones(); // seed ชุดเริ่มต้นให้ถ้ายังไม่มี
  const before = zones.find((z) => z.zone_code === zoneCode);
  if (!before) throw notFound("ไม่พบโซนค่าส่งนี้");

  const set: Partial<ShippingZone> = {};
  if (input.zone_label !== undefined) set.zone_label = input.zone_label;
  if (input.fee !== undefined) set.fee = round2(input.fee);
  if (input.provinces !== undefined) {
    if (zoneCode === FALLBACK_ZONE_CODE && input.provinces.length > 0) {
      throw badRequest(`โซน ${FALLBACK_ZONE_CODE} ใช้กับจังหวัดที่ไม่อยู่ในโซนอื่นอัตโนมัติ — ใส่รายชื่อจังหวัดไม่ได้`);
    }
    assertNoProvinceClash(zones, zoneCode, input.provinces);
    set.provinces = input.provinces;
  }

  const after = await shippingZoneModel
    .findOneAndUpdate({ zone_code: zoneCode }, { $set: set }, { returnDocument: "after", runValidators: true })
    .select("zone_code zone_label provinces fee")
    .lean<ShippingZone | null>();
  if (!after) throw notFound("ไม่พบโซนค่าส่งนี้");
  return { before, after };
}

export interface StorefrontDeliveryQuote {
  fee: number;
  zone_code: string | null;
  zone_label: string | null;
}

/**
 * ค่าส่งออเดอร์เว็บไปจังหวัดนี้ + ตรวจขอบเขตจัดส่ง (สินค้าที่ส่งทั่วประเทศไม่ได้ → เฉพาะจังหวัดร้าน)
 * ส่งไม่ได้ → 400 พร้อมข้อความให้ลูกค้าเปลี่ยนที่อยู่/รับเอง
 */
export async function quoteStorefrontDelivery(input: {
  province: string | null | undefined;
  productIds: string[];
}): Promise<StorefrontDeliveryQuote> {
  await dbConnect();
  const province = String(input.province ?? "").trim();
  const [zones, settings, categories, products] = await Promise.all([
    getShippingZones(),
    storeSettingsModel.findOne().select("province").lean<{ province?: string } | null>(),
    productCategoryModel.find({ deleted_at: null }).select("product_category_name ships_nationwide").lean<any[]>(),
    productModel.find({ _id: { $in: input.productIds } }).select("category_id ships_nationwide").lean<any[]>(),
  ]);

  const nationwide = new Set(categories.filter(categoryShipsNationwide).map((c) => String(c._id)));
  // รายสินค้าก่อน (ตั้งยกเว้นไว้) แล้วค่อยตามหมวด — lib/shipping.ts productShipsNationwide
  const hasLocalOnlyItems = products.some(
    (p) => !productShipsNationwide(p, nationwide.has(String(p.category_id ?? "")))
  );
  const area = checkDeliveryArea(province, String(settings?.province ?? ""), hasLocalOnlyItems);
  if (!area.ok) throw badRequest(area.message);

  const fee = computeShippingFee(province, zones);
  const zone =
    zones.find((z) => z.zone_code !== FALLBACK_ZONE_CODE && z.provinces.some((p) => p.trim() === province)) ??
    zones.find((z) => z.zone_code === FALLBACK_ZONE_CODE) ??
    null;
  return { fee, zone_code: zone?.zone_code ?? null, zone_label: zone?.zone_label ?? null };
}

// ── จุดรับสินค้า ─────────────────────────────────────────────
type AnyDoc = Record<string, any>;

/** แปลงเวลาทำการเดิม (business_hours) เป็นรายการ "หน้าร้าน" — เหมือนฝั่งลูกค้า (วันที่เวลาเหมือนกันรวมเป็นรายการเดียว) */
async function marketsFromBusinessHours(profile: AnyDoc): Promise<AnyDoc[]> {
  const hours = (profile.business_hours ?? {}) as Partial<Record<DayKey, { is_open?: boolean; open_time?: string; close_time?: string }>>;
  const groups = new Map<string, DayKey[]>();
  for (const day of DAY_ORDER) {
    const h = hours[day] ?? {};
    if (h.is_open === false) continue;
    const key = `${h.open_time ?? "09:00"}-${h.close_time ?? "18:00"}`;
    groups.set(key, [...(groups.get(key) ?? []), day]);
  }
  if (groups.size === 0) return [];

  const settings = await storeSettingsModel
    .findOne()
    .select("house_no sub_district district province zip_code latitude longitude")
    .lean<AnyDoc>();
  const location = [
    settings?.house_no,
    settings?.sub_district && `ต.${settings.sub_district}`,
    settings?.district && `อ.${settings.district}`,
    settings?.province && `จ.${settings.province}`,
    settings?.zip_code,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);
  const mapUrl =
    typeof settings?.latitude === "number" && typeof settings?.longitude === "number"
      ? `https://www.google.com/maps?q=${settings.latitude},${settings.longitude}`
      : "";
  const name = `หน้าร้าน ${String(profile.store_name ?? "").trim()}`.trim().slice(0, 100);
  return [...groups.entries()].map(([range, days]) => {
    const [open_time, close_time] = range.split("-");
    return { _id: new mongoose.Types.ObjectId(), name, location, days, open_time, close_time, map_url: mapUrl, is_active: true };
  });
}

/**
 * ย้ายเวลาทำการเดิมเข้า weekly_markets + ใส่ _id ให้รายการที่ไม่มี (ครั้งเดียว · idempotent — ตรงกับฝั่งลูกค้า
 * ensureWeeklyMarketsReady เพราะใช้ StoreProfile เอกสารเดียวกัน) แล้วคืนเอกสารล่าสุด
 */
export async function ensureWeeklyMarketsReady(): Promise<AnyDoc> {
  let profile = await storeProfileModel.findOne().lean<AnyDoc>();
  if (!profile) profile = (await storeProfileModel.create({})).toObject() as AnyDoc;

  const original = (profile.weekly_markets ?? []) as AnyDoc[];
  const markets = original.map((m) => (m._id ? m : { ...m, _id: new mongoose.Types.ObjectId() }));
  const missingIds = markets.some((m, i) => m !== original[i]);

  if (profile.business_hours_migrated !== true) {
    const merged = [...(await marketsFromBusinessHours(profile)), ...markets];
    await storeProfileModel.updateOne(
      { _id: profile._id, business_hours_migrated: { $ne: true } },
      { $set: { weekly_markets: merged, business_hours_migrated: true } }
    );
  } else if (missingIds) {
    await storeProfileModel.updateOne({ _id: profile._id }, { $set: { weekly_markets: markets } });
  } else {
    return profile;
  }
  return (await storeProfileModel.findOne({ _id: profile._id }).lean<AnyDoc>()) ?? profile;
}

/** จุดรับสินค้าที่ลูกค้าเลือกได้ (หน้าร้านประจำสัปดาห์ที่เปิดแสดง) */
export async function getActivePickupLocations(): Promise<PickupLocation[]> {
  await dbConnect();
  const profile = await ensureWeeklyMarketsReady();
  return ((profile.weekly_markets ?? []) as AnyDoc[])
    .filter((m) => m.is_active !== false)
    .map((m) => ({
      _id: String(m._id),
      name: String(m.name ?? ""),
      location: String(m.location ?? ""),
      days: DAY_ORDER.filter((d) => ((m.days ?? []) as string[]).includes(d)),
      open_time: String(m.open_time ?? ""),
      close_time: String(m.close_time ?? ""),
      map_url: String(m.map_url ?? ""),
    }));
}

export interface PickupSnapshot {
  point_id: mongoose.Types.ObjectId;
  point_name: string;
  address: string;
  note: string;
}

/**
 * ตรวจจุดรับ + วันรับที่ลูกค้าเลือก (ผิด = 400) แล้วคืนค่าที่พร้อมบันทึกลงออเดอร์/พรีออเดอร์
 * order: วันที่จุดเปิดภายใน 14 วัน · preorder: ช่วงวันของรอบ เฉพาะวันที่จุดเปิด
 */
export async function resolvePickupSelection(
  locationId: unknown,
  dateKey: unknown,
  kind: { type: "order" } | { type: "preorder"; roundPickupDate: Date | string | null | undefined }
): Promise<{ pickup_date: Date; pickup_point: PickupSnapshot }> {
  if (typeof locationId !== "string" || !locationId) throw badRequest("กรุณาเลือกจุดรับสินค้า");
  const loc = (await getActivePickupLocations()).find((l) => l._id === locationId);
  if (!loc) throw badRequest("จุดรับสินค้าที่เลือกไม่เปิดให้บริการแล้ว กรุณาเลือกใหม่");

  const options =
    kind.type === "order" ? orderPickupDateOptions(loc) : preorderPickupDateOptions(loc, kind.roundPickupDate);
  if (typeof dateKey !== "string" || !options.includes(dateKey)) {
    throw badRequest("กรุณาเลือกวันรับสินค้าในวันที่จุดรับเปิด");
  }
  return {
    pickup_date: dateKeyToBangkokMidnight(dateKey),
    pickup_point: {
      point_id: new mongoose.Types.ObjectId(loc._id),
      point_name: loc.name,
      address: loc.location,
      note: formatLocationSchedule(loc),
    },
  };
}

// ── ขอบเขตจัดส่งรายหมวดหมู่สินค้า (หน้า "ค่าจัดส่งหน้าร้านออนไลน์" · สิทธิ์ store_info) ─────────
// ย้ายมาจากตัวจัดการหมวดหมู่ในหน้าสินค้า — ตั้งได้ด้วยสิทธิ์เดียวกับโซนค่าส่ง ไม่ต้องมีสิทธิ์จัดการสินค้า

export interface CategoryShipping {
  _id: string;
  product_category_name: string;
  /** ค่าที่มีผลจริง (ตั้งไว้ หรือเดาจากชื่อเมื่อยังไม่ตั้ง — lib/shipping.ts categoryShipsNationwide) */
  ships_nationwide: boolean;
  /** true = ยังไม่เคยตั้ง ใช้ค่าที่เดาจากชื่อหมวด */
  ships_nationwide_auto: boolean;
}

function toCategoryShipping(c: AnyDoc): CategoryShipping {
  return {
    _id: String(c._id),
    product_category_name: String(c.product_category_name ?? ""),
    ships_nationwide: categoryShipsNationwide(c),
    ships_nationwide_auto: typeof c.ships_nationwide !== "boolean",
  };
}

/** หมวดหมู่สินค้าทั้งหมด (ที่ยังไม่ลบ) + ขอบเขตจัดส่ง — เรียงตามชื่อ */
export async function listCategoryShipping(): Promise<CategoryShipping[]> {
  await dbConnect();
  const rows = await productCategoryModel
    .find({ deleted_at: null })
    .select("product_category_name ships_nationwide")
    .sort({ product_category_name: 1 })
    .lean<AnyDoc[]>();
  return rows.map(toCategoryShipping);
}

/**
 * ตั้งว่าหมวดนี้ส่งทั่วประเทศได้ไหม → { before, after, products_reset } สำหรับ audit log
 * resetProducts = ล้างค่ายกเว้นรายสินค้าในหมวดด้วย (ทุกชิ้นกลับไปตามหมวด) — สวิตช์หัวหมวดในหน้า "จัดส่งนอกจังหวัด"
 * ใช้ความหมาย "เปิด/ปิดทั้งหมวด" · ไม่ส่ง = แตะเฉพาะค่าของหมวด (สวิตช์ในหน้าต่างจัดการหมวดหมู่สินค้า)
 */
export async function setCategoryShipsNationwide(
  id: string,
  value: boolean,
  opts: { resetProducts?: boolean } = {}
): Promise<{ before: CategoryShipping; after: CategoryShipping; products_reset: number }> {
  await dbConnect();
  if (!mongoose.isValidObjectId(id)) throw notFound("ไม่พบหมวดหมู่สินค้าที่ระบุ");
  const before = await productCategoryModel
    .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: { ships_nationwide: value } })
    .select("product_category_name ships_nationwide")
    .lean<AnyDoc | null>();
  if (!before) throw notFound("ไม่พบหมวดหมู่สินค้าที่ระบุ");
  let products_reset = 0;
  if (opts.resetProducts) {
    const res = await productModel.updateMany(
      { category_id: id, deleted_at: null, ships_nationwide: { $type: "bool" } },
      { $set: { ships_nationwide: null } },
      { strict: false } // ดู setProductShipping — กัน schema เก่าที่ค้างใน process ตัดฟิลด์ทิ้งเงียบ ๆ
    );
    products_reset = res.modifiedCount;
  }
  return {
    before: toCategoryShipping(before),
    after: toCategoryShipping({ ...before, ships_nationwide: value }),
    products_reset,
  };
}

// ── ขอบเขตจัดส่งรายสินค้า (ยกเว้นจากหมวด) — "จัดส่งนอกจังหวัด" · สิทธิ์ store_info ─────────

export interface ProductShipping {
  _id: string;
  product_name_th: string;
  /** รหัสสินค้า pos-/pre- */
  product_code: string | null;
  category_id: string | null;
  category_name: string;
  is_preorder: boolean;
  /** ค่าที่ตั้งยกเว้นไว้ที่ตัวสินค้า · null = ตามหมวด */
  ships_nationwide: boolean | null;
  /** ค่าของหมวด (ที่มีผลจริง) */
  category_ships_nationwide: boolean;
  /** ค่าที่ใช้คิดจริง = ยกเว้นก่อน ไม่มีค่อยตามหมวด */
  effective_ships_nationwide: boolean;
}

/** สินค้าทั้งหมดที่ยังไม่ลบ + ขอบเขตจัดส่ง — เรียงตามชื่อหมวด แล้วชื่อสินค้า */
export async function listProductShipping(): Promise<ProductShipping[]> {
  await dbConnect();
  const [products, categories] = await Promise.all([
    productModel
      .find({ deleted_at: null })
      .select("product_name_th product_id category_id is_preorder ships_nationwide")
      .limit(2000)
      .lean<AnyDoc[]>(),
    productCategoryModel.find({}).select("product_category_name ships_nationwide").lean<AnyDoc[]>(),
  ]);
  const catById = new Map(categories.map((c) => [String(c._id), c]));
  const rows = products.map((p): ProductShipping => {
    const cat = p.category_id ? catById.get(String(p.category_id)) : undefined;
    const catNationwide = cat ? categoryShipsNationwide(cat) : false;
    const override = typeof p.ships_nationwide === "boolean" ? p.ships_nationwide : null;
    return {
      _id: String(p._id),
      product_name_th: String(p.product_name_th ?? ""),
      product_code: typeof p.product_id === "string" ? p.product_id : null,
      category_id: p.category_id ? String(p.category_id) : null,
      category_name: String(cat?.product_category_name ?? ""),
      is_preorder: p.is_preorder === true,
      ships_nationwide: override,
      category_ships_nationwide: catNationwide,
      effective_ships_nationwide: productShipsNationwide(p, catNationwide),
    };
  });
  return rows.sort(
    (a, b) =>
      a.category_name.localeCompare(b.category_name, "th") || a.product_name_th.localeCompare(b.product_name_th, "th")
  );
}

/**
 * ตั้งยกเว้นหลายสินค้าพร้อมกัน — true = ส่งทั่วประเทศ · false = เฉพาะจังหวัดร้าน · null = กลับไปใช้ค่าตามหมวด
 * คืน before/after (ชื่อ + ค่าเดิม/ใหม่) สำหรับ audit log · id ที่ไม่พบ/ถูกลบ = 404 ทั้งชุด (ไม่แก้บางส่วน)
 */
export async function setProductShipping(
  productIds: string[],
  value: boolean | null
): Promise<{ updated: number; before: AnyDoc[]; after: AnyDoc[] }> {
  await dbConnect();
  const ids = [...new Set(productIds)];
  const existing = await productModel
    .find({ _id: { $in: ids }, deleted_at: null })
    .select("product_name_th ships_nationwide")
    .lean<AnyDoc[]>();
  if (existing.length !== ids.length) throw notFound("ไม่พบสินค้าบางรายการ หรือถูกลบไปแล้ว — กรุณาโหลดหน้าใหม่");
  // strict: false — model ของ mongoose ถูก cache ไว้ใน process (mongoose.models.Products || …) ถ้า process เริ่มก่อน
  // schema มีฟิลด์ ships_nationwide (dev hot-reload / deploy ที่ไม่ได้ restart) $set จะถูกตัดทิ้งเงียบ ๆ แต่ตอบสำเร็จ
  // (เจอจริง 2026-10-19: บันทึก 5 ครั้ง log ว่าสำเร็จ แต่ไม่มีค่าใน DB เลย) — ฟิลด์นี้ผ่าน zod (boolean | null) มาแล้ว
  const res = await productModel.updateMany(
    { _id: { $in: ids }, deleted_at: null },
    { $set: { ships_nationwide: value } },
    { strict: false }
  );
  const label = (p: AnyDoc) => String(p.product_name_th ?? p._id);
  return {
    updated: res.matchedCount,
    before: existing.map((p) => ({ product: label(p), ships_nationwide: typeof p.ships_nationwide === "boolean" ? p.ships_nationwide : null })),
    after: existing.map((p) => ({ product: label(p), ships_nationwide: value })),
  };
}

export interface ShippingException {
  _id: string;
  product_name_th: string;
  category_name: string;
}

/**
 * สินค้าที่ตั้งยกเว้นต่างจากหมวด (สาธารณะ — หน้า "การจัดส่ง" ของลูกค้า · GET /api/catalog/shipping-exceptions)
 *   nationwide    = หมวดส่งเฉพาะจังหวัด แต่สินค้าชิ้นนี้ส่งทั่วประเทศได้
 *   province_only = หมวดส่งทั่วประเทศ แต่สินค้าชิ้นนี้ส่งได้เฉพาะจังหวัดร้าน
 * เฉพาะสินค้าที่เปิดขาย (is_visible) · ค่าเดียวกับหมวด (ตั้งซ้ำ) ไม่นับ — ไม่ต้องบอกลูกค้าซ้ำกับรายชื่อหมวด
 */
export async function listShippingExceptions(): Promise<{ nationwide: ShippingException[]; province_only: ShippingException[] }> {
  await dbConnect();
  const [products, categories] = await Promise.all([
    productModel
      .find({ deleted_at: null, is_visible: { $ne: false }, ships_nationwide: { $type: "bool" } })
      .select("product_name_th category_id ships_nationwide")
      .lean<AnyDoc[]>(),
    productCategoryModel.find({}).select("product_category_name ships_nationwide").lean<AnyDoc[]>(),
  ]);
  const catById = new Map(categories.map((c) => [String(c._id), c]));
  const nationwide: ShippingException[] = [];
  const provinceOnly: ShippingException[] = [];
  for (const p of products) {
    const cat = p.category_id ? catById.get(String(p.category_id)) : undefined;
    const catNationwide = cat ? categoryShipsNationwide(cat) : false;
    if (p.ships_nationwide === catNationwide) continue;
    const row = { _id: String(p._id), product_name_th: String(p.product_name_th ?? ""), category_name: String(cat?.product_category_name ?? "") };
    (p.ships_nationwide ? nationwide : provinceOnly).push(row);
  }
  const byName = (a: ShippingException, b: ShippingException) => a.product_name_th.localeCompare(b.product_name_th, "th");
  return { nationwide: nationwide.sort(byName), province_only: provinceOnly.sort(byName) };
}
