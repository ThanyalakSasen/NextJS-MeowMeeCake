import mongoose from "mongoose";

/**
 * LineQuotaStates — โควตาข้อความ LINE OA ที่แชร์ข้าม instance (src/lib/lineQuota.ts · BACKLOG5 G6)
 *
 * เอกสารเดียว `_id: "line_quota"` · ตัวเลขจาก LINE (ถามใหม่ทุก 5 นาที) + หักเองทุกครั้งที่ส่งสำเร็จ
 * `limit` / `remaining` = null → แพ็กเกจไม่จำกัด
 */
const lineQuotaStateSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    limit: { type: Number, default: null },
    used: { type: Number, default: 0 },
    remaining: { type: Number, default: null },
    fetched_at: { type: Date, required: true },
  },
  { versionKey: false }
);

const LineQuotaStateModel =
  mongoose.models.LineQuotaStates || mongoose.model("LineQuotaStates", lineQuotaStateSchema);

export default LineQuotaStateModel;
