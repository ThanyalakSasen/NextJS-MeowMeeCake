// storeSettingsModel.ts
// ที่อยู่ร้าน + พิกัดแผนที่ — เอกสารเดียว (single-doc config) · ย้ายมาจาก backend ฝั่งลูกค้า (collection เดียวกัน)
// ใช้แสดงจุดรับสินค้าตอนลูกค้าเลือก "รับเองที่ร้าน" และแสดงในหน้า "ข้อมูลร้านค้า" (owner)
import mongoose from "mongoose";

const storeSettingsSchema = new mongoose.Schema(
  {
    house_no: { type: String, default: "" },
    sub_district: { type: String, default: "" },
    district: { type: String, default: "" },
    province: { type: String, default: "" },
    zip_code: { type: String, default: "" },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

const StoreSettingsModel = mongoose.models.StoreSettings || mongoose.model("StoreSettings", storeSettingsSchema);

export default StoreSettingsModel;
