import mongoose from "mongoose";

const deliveryZoneSchema = new mongoose.Schema(
  {
    zone_name: {
      type: String,
      required: true,
      trim: true,
    },
    // รายชื่อจังหวัด (ตรงตาม deliveryService.normalizeProvince) ที่นับเป็นโซนนี้ — ไม่ใช้กับโซน catch-all
    provinces: {
      type: [String],
      default: [],
    },
    // true = โซนที่รับจังหวัดอื่นทั้งหมดที่ไม่ตรงกับโซนไหนเลย (ควร active พร้อมกันได้แค่ 1 โซน —
    // deliveryZoneService บังคับให้ตั้ง true ที่โซนใหม่แล้วปลดโซนอื่นให้อัตโนมัติ เหมือน addressService.is_default)
    is_catch_all: {
      type: Boolean,
      default: false,
    },
    // BACKLOG §3.11 เฟส 3 — สตางค์ (integer) ตั้งแต่ 2026-09-12 (API ยังรับ-ส่งบาทเหมือนเดิม, ดู src/lib/money.ts)
    fee: {
      type: Number,
      required: true,
      min: 0,
    },
    // โซนที่ sort_order น้อยกว่าเช็คก่อน (กันจังหวัดซ้ำระหว่างโซน — โซนแรกที่ match ชนะ)
    sort_order: {
      type: Number,
      default: 0,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

deliveryZoneSchema.index({ deleted_at: 1, is_active: 1, sort_order: 1 });

const DeliveryZone =
  mongoose.models.DeliveryZones || mongoose.model("DeliveryZones", deliveryZoneSchema);

export default DeliveryZone;
