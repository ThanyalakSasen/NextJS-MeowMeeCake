/**
 * schemas/shipping — validation ของ PATCH /api/admin/shipping-zones/:zone_code (โซนค่าส่งเว็บ A–D · frontend Q-BE2)
 * ตรวจรูปแบบเท่านั้น — กติกาที่ต้องดูข้อมูลโซนอื่น (จังหวัดซ้ำข้ามโซน · โซน D ไม่มีจังหวัด) อยู่ที่ shippingService
 */
import { z } from "zod";
import { isThaiProvince } from "@/lib/thaiProvinces";
import { objectId } from "./common";

const provinceList = z
  .array(z.string().trim().min(1))
  .max(77)
  .superRefine((list, ctx) => {
    const unknown = list.filter((p) => !isThaiProvince(p));
    if (unknown.length > 0) {
      ctx.addIssue({ code: "custom", message: `ไม่ใช่ชื่อจังหวัด (ใช้ชื่อทางการ 77 จังหวัด): ${unknown.join(", ")}` });
    }
  })
  .transform((list) => [...new Set(list)]);

/** POST /api/admin/shipping-zones — เพิ่มโซนใหม่ (รหัสโซนระบบตั้งให้) */
export const shippingZoneCreate = z.object({
  zone_label: z.string().trim().min(1).max(120),
  fee: z.coerce.number().min(0).max(100_000),
  provinces: provinceList.default([]),
});
export type ShippingZoneCreate = z.infer<typeof shippingZoneCreate>;

export const shippingZoneUpdate = z
  .object({
    zone_label: z.string().trim().min(1).max(120).optional(),
    fee: z.coerce.number().min(0).max(100_000).optional(),
    provinces: provinceList.optional(),
  })
  .refine((d) => Object.keys(d).some((k) => d[k as keyof typeof d] !== undefined), {
    message: "ต้องระบุอย่างน้อย 1 ฟิลด์ที่จะแก้ไข",
  });
export type ShippingZoneUpdate = z.infer<typeof shippingZoneUpdate>;

/** PATCH /api/admin/shipping-zones/categories/:id — หมวดนี้ส่งทั่วประเทศได้ไหม (ออเดอร์เว็บ) */
export const categoryShippingUpdate = z.object({
  ships_nationwide: z.boolean(),
  /** true = ล้างค่ายกเว้นรายสินค้าในหมวดด้วย (เปิด/ปิดทั้งหมวด) */
  reset_products: z.boolean().optional(),
});

/** PATCH /api/admin/shipping-zones/products — ตั้งยกเว้นหลายสินค้า · null = กลับไปใช้ค่าตามหมวด */
export const productShippingUpdate = z.object({
  product_ids: z.array(objectId).min(1, "เลือกสินค้าอย่างน้อย 1 รายการ").max(500),
  ships_nationwide: z.boolean().nullable(),
});
