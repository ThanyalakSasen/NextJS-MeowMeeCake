/**
 * deliveryZoneService — โซนค่าจัดส่งที่แอดมินแก้ได้เอง (BACKLOG §3.15)
 *
 * แทนที่ config/env ตายตัวเดิมที่ deliveryService.ts เคยใช้ — โซนอ่านจาก DB, cache ไว้สั้น ๆ (TTL)
 * กันยิง query ทุกครั้งที่คิดค่าส่ง (เรียกถี่ทุกออเดอร์/พรีวิวตะกร้า) แล้วล้าง cache ทันทีทุกครั้งที่แก้ไข
 *
 * มีโซน is_catch_all (รับจังหวัดที่ไม่ตรงกับโซนไหนเลย) active พร้อมกันได้แค่ 1 โซน — ตั้ง true ที่โซนใหม่
 * จะปลดโซนอื่นให้อัตโนมัติ (เหมือน addressService.is_default)
 *
 * ถ้ายังไม่มีโซนไหนใน DB เลย (ยังไม่ตั้งค่า/deploy ใหม่) — deliveryService.calcDeliveryFee จะ fallback
 * ไปใช้ config จาก env ตัวเดิมให้เอง (ดู deliveryService.ts) ไม่ทำให้คิดค่าส่งพังกลางทาง
 */
import type { Model } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { createCrudService } from "../lib/crudService";
import deliveryZoneModel from "../models/deliveryZoneModel";

const WRITABLE = ["zone_name", "provinces", "is_catch_all", "fee", "sort_order", "is_active"] as const;

const base = createCrudService(deliveryZoneModel as Model<unknown>, {
  label: "โซนค่าจัดส่ง",
  searchFields: ["zone_name"],
  createFields: WRITABLE,
});

export interface DeliveryZoneRow {
  _id: unknown;
  zone_name: string;
  provinces: string[];
  is_catch_all: boolean;
  fee: number;
  sort_order: number;
  is_active: boolean;
}

// ── cache: โซน active ทั้งหมด เรียงตาม sort_order ──────────────
// (ตั้ง DELIVERY_ZONE_CACHE_TTL_MS=0 ปิด cache ได้ เช่นตอนเทส — ใช้ Number.isFinite เช็คแทน `|| fallback`
// เพราะ 0 เป็น falsy ใน JS ถ้าใช้ `||` ตรง ๆ จะไม่มีทางตั้งเป็น 0 ได้เลย)
const envTtl = Number(process.env.DELIVERY_ZONE_CACHE_TTL_MS);
const CACHE_TTL_MS = Number.isFinite(envTtl) && envTtl >= 0 ? envTtl : 60_000;
let cache: { rows: DeliveryZoneRow[]; expiresAt: number } | null = null;

function invalidateCache(): void {
  cache = null;
}

/** โซน active ทั้งหมด เรียงตาม sort_order (ใช้โดย deliveryService.calcDeliveryFee) — cache ไว้ TTL วิ */
export async function getActiveZonesCached(): Promise<DeliveryZoneRow[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.rows;

  await dbConnect();
  const rows = await deliveryZoneModel
    .find({ deleted_at: null, is_active: true })
    .sort({ sort_order: 1 })
    .lean<DeliveryZoneRow[]>();

  cache = { rows, expiresAt: Date.now() + CACHE_TTL_MS };
  return rows;
}

async function unsetOtherCatchAll(exceptId?: string): Promise<void> {
  await dbConnect();
  const filter: Record<string, unknown> = { is_catch_all: true, deleted_at: null };
  if (exceptId) filter._id = { $ne: exceptId };
  await deliveryZoneModel.updateMany(filter, { $set: { is_catch_all: false } });
}

export const deliveryZoneService = {
  ...base,

  async create(input: Record<string, unknown>) {
    if (input.is_catch_all === true) await unsetOtherCatchAll();
    const doc = await base.create(input);
    invalidateCache();
    return doc;
  },

  async update(id: string, input: Record<string, unknown>) {
    if (input.is_catch_all === true) await unsetOtherCatchAll(id);
    const doc = await base.update(id, input);
    invalidateCache();
    return doc;
  },

  async remove(id: string) {
    const doc = await base.remove(id);
    invalidateCache();
    return doc;
  },

  async restore(id: string) {
    const doc = await base.restore(id);
    invalidateCache();
    return doc;
  },
};

export default deliveryZoneService;
