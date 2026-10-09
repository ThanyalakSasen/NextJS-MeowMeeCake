/**
 * schemas/shipping — validation ของ PATCH /api/admin/shipping-zones/:zone_code (โซนค่าส่งเว็บ A–D · frontend Q-BE2)
 * ตรวจรูปแบบเท่านั้น — กติกาที่ต้องดูข้อมูลโซนอื่น (จังหวัดซ้ำข้ามโซน · โซน D ไม่มีจังหวัด) อยู่ที่ shippingService
 */
import { z } from "zod";
import { isThaiProvince } from "@/lib/thaiProvinces";

export const shippingZoneUpdate = z
  .object({
    zone_label: z.string().trim().min(1).max(120).optional(),
    fee: z.coerce.number().min(0).max(100_000).optional(),
    provinces: z
      .array(z.string().trim().min(1))
      .max(77)
      .superRefine((list, ctx) => {
        const unknown = list.filter((p) => !isThaiProvince(p));
        if (unknown.length > 0) {
          ctx.addIssue({ code: "custom", message: `ไม่ใช่ชื่อจังหวัด (ใช้ชื่อทางการ 77 จังหวัด): ${unknown.join(", ")}` });
        }
      })
      .transform((list) => [...new Set(list)])
      .optional(),
  })
  .refine((d) => Object.keys(d).some((k) => d[k as keyof typeof d] !== undefined), {
    message: "ต้องระบุอย่างน้อย 1 ฟิลด์ที่จะแก้ไข",
  });
export type ShippingZoneUpdate = z.infer<typeof shippingZoneUpdate>;
