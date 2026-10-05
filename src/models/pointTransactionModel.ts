// pointTransactionModel.ts
// สมุดบัญชีแต้มสะสมของสมาชิก — ทุกการได้/ใช้/หมดอายุแต้มเป็น 1 แถว (ไม่แก้ยอดรวมตรงๆ) · ย้ายมาจาก backend ฝั่งลูกค้า (collection เดียวกัน · customer-backend-merge.md §8.11)
// ยอดคงเหลือ = ผลรวม remaining ของแถว type "earn" ที่ยังไม่หมดอายุ (ดู src/services/pointsService.ts)
import mongoose from "mongoose";

// แต้มจากล็อต earn ไหนถูกหักไปเท่าไหร่ — ใช้คืนแต้มกลับล็อตเดิมเมื่อออเดอร์ถูกยกเลิก
const allocationSchema = new mongoose.Schema(
  {
    lot_id: { type: mongoose.Schema.Types.ObjectId, ref: "PointTransactions", required: true },
    points: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const pointTransactionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    // earn = ได้แต้ม (เป็นล็อตที่มีวันหมดอายุ), redeem = ใช้แต้มเป็นส่วนลด,
    // expire = แต้มหมดอายุ, refund = คืนแต้มที่ใช้ไปเพราะออเดอร์ถูกยกเลิก, revoke = ดึงแต้มที่ได้จากออเดอร์ที่ถูกยกเลิกคืน
    type: { type: String, enum: ["earn", "redeem", "expire", "refund", "revoke"], required: true },
    source: {
      type: String,
      enum: ["purchase", "welcome", "review", "review_photo", "share", "profile", "redeem", "coupon", "expire", "redeem_refund", "purchase_revoke"],
      required: true,
    },
    // บวก = ได้แต้ม, ลบ = เสียแต้ม
    points: { type: Number, required: true },
    // เฉพาะ earn: แต้มในล็อตนี้ที่ยังไม่ถูกใช้/หมดอายุ
    remaining: { type: Number, default: 0, min: 0 },
    expires_at: { type: Date, default: null },
    allocations: { type: [allocationSchema], default: [] },
    ref_type: { type: String, enum: ["order", "preorder", "review", "product", "coupon", null], default: null },
    ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    description: { type: String, default: "" },
    // กันให้แต้มซ้ำ — เช่น "welcome", "purchase:order:<id>", "share:<productId>"
    dedupe_key: { type: String, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

pointTransactionSchema.index({ user_id: 1, created_at: -1 });
pointTransactionSchema.index({ user_id: 1, type: 1, expires_at: 1 });
pointTransactionSchema.index({ ref_type: 1, ref_id: 1 });
pointTransactionSchema.index(
  { user_id: 1, dedupe_key: 1 },
  { unique: true, partialFilterExpression: { dedupe_key: { $type: "string" } } }
);


const PointTransaction =
  mongoose.models.PointTransactions || mongoose.model("PointTransactions", pointTransactionSchema);
export default PointTransaction;
