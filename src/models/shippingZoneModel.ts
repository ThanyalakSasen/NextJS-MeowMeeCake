// shippingZoneModel.ts
// โซนค่าจัดส่งตามจังหวัด — ชุดเริ่มต้น A–D · เพิ่มโซนได้ (E, F, … — 2026-10-26) · ลบ = ลบจริง (ไม่มี deleted_at · ยกเว้นโซน D) · ย้ายมาจาก backend ฝั่งลูกค้า (collection เดียวกัน)
import mongoose from "mongoose";

const shippingZoneSchema = new mongoose.Schema(
  {
    zone_code: { type: String, match: /^[A-Z]$/, required: true, unique: true },
    zone_label: { type: String, required: true },
    provinces: { type: [String], default: [] },
    fee: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);


const ShippingZoneModel = mongoose.models.ShippingZones || mongoose.model("ShippingZones", shippingZoneSchema);

export default ShippingZoneModel;
