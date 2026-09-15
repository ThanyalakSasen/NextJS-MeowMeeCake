/**
 * schemas/delivery — validation ของ /api/admin/delivery-zones (BACKLOG §3.15)
 */
import { z } from "zod";

export const deliveryZoneCreate = z.object({
  zone_name: z.string().trim().min(1).max(200),
  provinces: z.array(z.string().trim().min(1)).default([]),
  is_catch_all: z.boolean().default(false),
  fee: z.coerce.number().min(0),
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true),
});
export type DeliveryZoneCreate = z.infer<typeof deliveryZoneCreate>;

// เขียนแยกจาก deliveryZoneCreate.partial() ตรง ๆ (ไม่ reuse) เพราะ deliveryZoneCreate มีฟิลด์ที่ตั้ง
// .default() ไว้หลายตัว (provinces/is_catch_all/sort_order/is_active) — ถ้า .partial() แล้ว parse({})
// defaults เหล่านี้จะเติมเข้ามาเองจนออบเจกต์ผลลัพธ์ไม่ว่างเปล่าเสมอ ทำให้ refine ด้านล่างเช็คไม่ได้ผล
// (ทุกฟิลด์ที่นี่ต้องเป็น .optional() ล้วน ไม่มี .default() เลยสักตัว — ตรงกับ permissionUpdate ที่ทำแบบนี้อยู่แล้ว)
export const deliveryZoneUpdate = z
  .object({
    zone_name: z.string().trim().min(1).max(200).optional(),
    provinces: z.array(z.string().trim().min(1)).optional(),
    is_catch_all: z.boolean().optional(),
    fee: z.coerce.number().min(0).optional(),
    sort_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "ต้องระบุอย่างน้อย 1 ฟิลด์ที่จะแก้ไข",
  });
export type DeliveryZoneUpdate = z.infer<typeof deliveryZoneUpdate>;
