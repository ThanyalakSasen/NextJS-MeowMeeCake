// shippingZoneModel.ts
// โซนค่าจัดส่งตามจังหวัด — เริ่มต้น 4 โซน (A–D) · เพิ่มโซนใหม่ได้ (รหัสตัวอักษรถัดไป E, F, …) · ลบได้ยกเว้นโซน D
// (โซน D = จังหวัดที่ไม่อยู่ในโซนอื่น — lib/shipping.ts FALLBACK_ZONE_CODE) · ย้ายมาจาก backend ฝั่งลูกค้า (collection เดียวกัน)
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


// dev (hot reload): โมเดลที่ cache ไว้ยังเป็น schema เดิม (enum A–D) → สร้างใหม่ ไม่งั้นเพิ่มโซน E ไม่ผ่าน validation
if (mongoose.models.ShippingZones && mongoose.models.ShippingZones.schema.path("zone_code")?.options?.enum) {
  mongoose.deleteModel("ShippingZones");
}

const ShippingZoneModel = mongoose.models.ShippingZones || mongoose.model("ShippingZones", shippingZoneSchema);

export default ShippingZoneModel;
