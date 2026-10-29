// shippingZoneModel.ts
// โซนค่าจัดส่งตามจังหวัด — ชุดเริ่มต้น A–D · เพิ่ม/ลบโซนได้ · ลบ = ลบจริง (ไม่มี deleted_at · ยกเว้นโซนจังหวัดอื่นทั้งหมด)
// is_fallback = โซน "จังหวัดอื่นทั้งหมด" — รหัสเป็นตัวอักษรสุดท้ายเสมอ (เพิ่ม/ลบโซนแล้วเลื่อนตาม · shippingService.normalizeZones) · ย้ายมาจาก backend ฝั่งลูกค้า (collection เดียวกัน)
import mongoose from "mongoose";

const shippingZoneSchema = new mongoose.Schema(
  {
    zone_code: { type: String, match: /^[A-Z]$/, required: true, unique: true },
    zone_label: { type: String, required: true },
    provinces: { type: [String], default: [] },
    fee: { type: Number, required: true, min: 0 },
    is_fallback: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);


const ShippingZoneModel = mongoose.models.ShippingZones || mongoose.model("ShippingZones", shippingZoneSchema);

export default ShippingZoneModel;
