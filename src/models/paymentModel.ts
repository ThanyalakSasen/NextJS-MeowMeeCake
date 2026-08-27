import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Orders", default: null },
    preorder_id: { type: mongoose.Schema.Types.ObjectId, ref: "Preorders", default: null },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
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

const Payment = mongoose.models.Payments || mongoose.model("Payments", paymentSchema);
export default Payment;