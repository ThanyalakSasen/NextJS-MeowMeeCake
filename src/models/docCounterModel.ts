import mongoose from "mongoose";

/**
 * DocCounters — ตัวนับลำดับเลขเอกสารรายวัน (src/services/docNoService.ts)
 *
 * 1 เอกสาร = 1 prefix ต่อ 1 วัน (`_id` = "ORD-20261024") · ออกเลขใหม่ = `$inc seq` แบบ atomic
 * → เลขในวันเดียวกันไม่ซ้ำกันแน่นอน แม้มีหลาย instance สั่งพร้อมกัน
 */
const docCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false, timestamps: { createdAt: false, updatedAt: "updated_at" } }
);

const DocCounterModel = mongoose.models.DocCounters || mongoose.model("DocCounters", docCounterSchema);

export default DocCounterModel;
