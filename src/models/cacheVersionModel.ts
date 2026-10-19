import mongoose from "mongoose";

/**
 * CacheVersions — เลขเวอร์ชันของ cache ในหน่วยความจำ ใช้ล้าง cache ข้าม instance (src/lib/sharedCache.ts · BACKLOG5 G6)
 *
 * 1 เอกสาร = 1 cache (`_id` = ชื่อ cache เช่น "permissions") · แก้ข้อมูลที่ cache ไว้ → `$inc v`
 * instance อื่นเห็นเลขเปลี่ยน → ทิ้ง cache ของตัวเอง
 */
const cacheVersionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    v: { type: Number, default: 0 },
  },
  { versionKey: false, timestamps: { createdAt: false, updatedAt: "updated_at" } }
);

const CacheVersionModel = mongoose.models.CacheVersions || mongoose.model("CacheVersions", cacheVersionSchema);

export default CacheVersionModel;
