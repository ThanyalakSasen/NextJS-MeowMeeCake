import mongoose from "mongoose";

/**
 * StockRequests — กันคำขอปรับสต็อกสินค้าซ้ำ (หน้าสต็อกสินค้า: รับเข้า/เบิกใช้/ตั้งยอด)
 *
 * 1 เอกสาร = 1 การกดของผู้ใช้ (`_id` = request_key ที่หน้าจอสร้างครั้งเดียวต่อการกด แล้วส่งซ้ำตอนลองใหม่)
 * เดิม "รับเข้า" แล้ว timeout ทั้งที่ backend ทำสำเร็จ → กดใหม่ = บวกสต็อกซ้ำ
 * status: pending = กำลังทำ · done = ทำแล้ว (result = สินค้าหลังปรับ — ส่งกลับซ้ำเมื่อคำขอเดิมมาอีก)
 * `expire_at` → TTL index ให้ MongoDB ลบเอง (1 วัน — ลองใหม่ช้ากว่านั้นไม่ใช่การกดเดิมแล้ว)
 */
const stockRequestSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    product_id: { type: String, required: true },
    status: { type: String, enum: ["pending", "done"], default: "pending" },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    expire_at: { type: Date, required: true },
  },
  { versionKey: false }
);

stockRequestSchema.index({ expire_at: 1 }, { expireAfterSeconds: 0 });

const StockRequestModel = mongoose.models.StockRequests || mongoose.model("StockRequests", stockRequestSchema);

export default StockRequestModel;
