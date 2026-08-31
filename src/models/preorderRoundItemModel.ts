// preorderRoundItemModel.ts
import mongoose from "mongoose";

const preorderRoundItemSchema = new mongoose.Schema(
  {
    round_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreorderRounds", required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    price_override: { type: Number, default: null },
    min_order_qty: { type: Number, default: 1, min: 1 },
    max_qty_total: { type: Number, required: true, min: 1 },
    current_qty: { type: Number, default: 0, min: 0 },
    is_active: { type: Boolean, default: true },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

preorderRoundItemSchema.index({ round_id: 1 });
preorderRoundItemSchema.index({ round_id: 1, product_id: 1 }, { unique: true });

const PreorderRoundItem = mongoose.models.PreorderRoundItems || mongoose.model("PreorderRoundItems", preorderRoundItemSchema);
export default PreorderRoundItem;