// shippingZoneModel.ts
// โซนค่าจัดส่งตามจังหวัด — คงที่ 4 โซน (A-D) ไม่มี deleted_at เพราะเป็นข้อมูลอ้างอิง ไม่ลบจริง · ย้ายมาจาก backend ฝั่งลูกค้า (collection เดียวกัน)
import mongoose from "mongoose";

const shippingZoneSchema = new mongoose.Schema(
  {
    zone_code: { type: String, enum: ["A", "B", "C", "D"], required: true, unique: true },
    zone_label: { type: String, required: true },
    provinces: { type: [String], default: [] },
    fee: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);


const ShippingZoneModel = mongoose.models.ShippingZones || mongoose.model("ShippingZones", shippingZoneSchema);

export default ShippingZoneModel;
