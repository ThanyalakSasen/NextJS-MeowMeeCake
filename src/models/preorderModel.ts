// preorderModel.ts
import mongoose from "mongoose";

const deliveryAddressSchema = new mongoose.Schema(
  {
    recipient_name: { type: String, required: true },
    recipient_phone: { type: String, required: true },
    house_no: { type: String, required: true },
    sub_district: { type: String, required: true },
    district: { type: String, required: true },
    province: { type: String, required: true },
    zip_code: { type: String, required: true },
  },
  { _id: false }
);

const preorderSchema = new mongoose.Schema(
  {
    preorder_no: { type: String, required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    round_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreorderRounds", required: true },
    order_type: { type: String, enum: ["delivery", "takeaway"], required: true },
    order_status: { type: String, enum: ["pending", "confirmed", "preparing", "ready", "completed", "cancelled"], default: "pending" },
    payment_status: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending" },
    delivery_address: { type: deliveryAddressSchema, default: null },
    subtotal: { type: Number, required: true, min: 0 },
    discount_amount: { type: Number, default: 0 },
    delivery_fee: { type: Number, default: 0 },
    total_amount: { type: Number, required: true, min: 0 },
    promotion_id: { type: mongoose.Schema.Types.ObjectId, ref: "Promotions", default: null },
    payment_id: { type: mongoose.Schema.Types.ObjectId, ref: "Payments", default: null },
    delivery_status: { type: String, enum: ["pending", "shipping", "delivered", "failed"], default: "pending" },
    tracking_no: { type: String, default: null },
    shipped_at: { type: Date, default: null },
    delivered_note: { type: String, default: null },
    delivered_at: { type: Date, default: null },
    cancelled_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },
    cancelled_reason: { type: String, default: null },
    cancelled_at: { type: Date, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

preorderSchema.index({ user_id: 1 });
preorderSchema.index({ round_id: 1 });
preorderSchema.index({ order_status: 1 });

const Preorder = mongoose.models.Preorders || mongoose.model("Preorders", preorderSchema);
export default Preorder;