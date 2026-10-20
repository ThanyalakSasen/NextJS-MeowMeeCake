import mongoose from "mongoose";

/**
 * RateLimits — ตัวนับ rate limit ที่แชร์ข้าม instance (src/lib/rateLimit.ts · BACKLOG5 G6)
 *
 * 1 เอกสาร = 1 key (`${ip}:${scope}`) · `hits` = เวลา (ms) ของคำขอที่ผ่านใน window ล่าสุด
 * `expire_at` = เวลาที่ไม่ต้องจำ key นี้แล้ว → TTL index ให้ MongoDB ลบเอง (ไม่ต้อง sweep)
 */
const rateLimitSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    hits: { type: [Number], default: [] },
    allowed: { type: Boolean, default: true },
    expire_at: { type: Date, required: true },
  },
  { versionKey: false }
);

rateLimitSchema.index({ expire_at: 1 }, { expireAfterSeconds: 0 });

const RateLimitModel = mongoose.models.RateLimits || mongoose.model("RateLimits", rateLimitSchema);

export default RateLimitModel;
