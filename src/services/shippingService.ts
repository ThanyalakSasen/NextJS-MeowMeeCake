/**
 * shippingService — ค่าส่ง + จุดรับสินค้าของออเดอร์/พรีออเดอร์จากหน้าเว็บลูกค้า (storefront)
 * ย้ายมาจาก backend ฝั่งลูกค้า (docs/customer-backend-merge.md §8.7)
 *
 *   - ค่าส่ง: ShippingZones (โซน A–D ตามจังหวัด · ไม่มีส่งฟรีตามยอด — ส่งฟรีได้จากโปรโมชันเท่านั้น)
 *     หลังร้าน/POS ยังใช้ DeliveryZones (deliveryService) ตามเดิม — ผู้ใช้เลือกเก็บทั้งสองระบบ
 *   - ขอบเขตจัดส่ง: หมวดที่ไม่ส่งทั่วประเทศ (ships_nationwide) → ส่งได้เฉพาะในจังหวัดร้าน (StoreSettings.province)
 *   - จุดรับสินค้า: หน้าร้านประจำสัปดาห์ (StoreProfile.weekly_markets) ที่เปิดแสดง · กติกาวันรับใน src/lib/pickupLocations.ts
 */
import mongoose from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest } from "../lib/httpError";
import shippingZoneModel from "../models/shippingZoneModel";
import storeProfileModel from "../models/storeProfileModel";
import storeSettingsModel from "../models/storeSettingsModel";
import productModel from "../models/productModel";
import productCategoryModel from "../models/productCategoryModel";
import {
  DEFAULT_SHIPPING_ZONES,
  categoryShipsNationwide,
  checkDeliveryArea,
  computeShippingFee,
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
/** โซนค่าส่งทั้งหมด (A–D) — ยังไม่มีใน DB เลย → สร้างชุดเริ่มต้นให้ (แบบเดียวกับฝั่งลูกค้า) */
export async function getShippingZones(): Promise<ShippingZone[]> {
  await dbConnect();
  if ((await shippingZoneModel.countDocuments()) === 0) {
    await shippingZoneModel.insertMany(DEFAULT_SHIPPING_ZONES).catch((err: any) => {
      if (err?.code !== 11000) throw err; // อีกคำขอ seed พร้อมกัน (zone_code unique)
    });
  }
  return shippingZoneModel
    .find()
    .select("zone_code zone_label provinces fee")
    .sort({ zone_code: 1 })
    .lean<ShippingZone[]>();
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
    productModel.find({ _id: { $in: input.productIds } }).select("category_id").lean<any[]>(),
  ]);

  const nationwide = new Set(categories.filter(categoryShipsNationwide).map((c) => String(c._id)));
  const hasLocalOnlyItems = products.some((p) => !nationwide.has(String(p.category_id ?? "")));
  const area = checkDeliveryArea(province, String(settings?.province ?? ""), hasLocalOnlyItems);
  if (!area.ok) throw badRequest(area.message);

  const fee = computeShippingFee(province, zones);
  const zone =
    zones.find((z) => z.zone_code !== "D" && z.provinces.some((p) => p.trim() === province)) ??
    zones.find((z) => z.zone_code === "D") ??
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
