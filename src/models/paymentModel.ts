import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Orders", default: null },
    preorder_id: { type: mongoose.Schema.Types.ObjectId, ref: "Preorders", default: null },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    // BACKLOG §3.11 — สตางค์ (integer) ตั้งแต่ 2026-09-12 ไม่ว่าจะผูกกับ order หรือ preorder
    // (ทั้งสองฝั่งแปลงเป็นสตางค์พร้อมกันในเฟสนี้ เพราะ payment เป็น model กลางที่ใช้ร่วมกัน)
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending" },
    promptpay_ref: { type: String, default: null },
    slip_image_url: { type: String, default: null },
    verified_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },
    verified_at: { type: Date, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

paymentSchema.index({ order_id: 1 });
paymentSchema.index({ preorder_id: 1 });
paymentSchema.index({ user_id: 1 });
paymentSchema.index({ status: 1 });

// 1 order / 1 preorder มี payment ที่ยัง "pending" (ไม่ถูกลบ) ได้ใบเดียว — กันสร้างซ้ำระดับ DB
// ($type: "objectId" เพื่อไม่ index เอกสารที่ order_id/preorder_id เป็น null)
// ต้องรัน `npm run sync-indexes` กับ DB จริง — ถ้ามี pending ซ้ำอยู่ก่อน index จะสร้างไม่ผ่าน ต้องลบซ้ำก่อน
paymentSchema.index(
  { order_id: 1 },
  {
    unique: true,
    name: "uniq_pending_payment_per_order",
    partialFilterExpression: { order_id: { $type: "objectId" }, status: "pending", deleted_at: null },
  }
);
paymentSchema.index(
  { preorder_id: 1 },
  {
    unique: true,
    name: "uniq_pending_payment_per_preorder",
    partialFilterExpression: { preorder_id: { $type: "objectId" }, status: "pending", deleted_at: null },
  }
);

const Payment = mongoose.models.Payments || mongoose.model("Payments", paymentSchema);
export default Payment;