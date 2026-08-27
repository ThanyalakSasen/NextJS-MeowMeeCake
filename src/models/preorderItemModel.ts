// preorderItemModel.ts
import mongoose from "mongoose";

const preorderProductSnapshotSchema = new mongoose.Schema(
  {
    product_name_th: { type: String, required: true },
    product_name_eng: { type: String, required: true },
  },
  { _id: false }
);

const preorderItemSchema = new mongoose.Schema(
  {
    preorder_id: { type: mongoose.Schema.Types.ObjectId, ref: "Preorders", required: true },
    round_item_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreorderRoundItems", required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    product_snapshot: { type: preorderProductSnapshotSchema, required: true },
    pickup_date: { type: Date, required: true },
    special_request: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    unit_price: { type: Number, required: true, min: 0 },
    total_price: { type: Number, required: true, min: 0 },
    cost_per_unit: { type: Number, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

preorderItemSchema.index({ preorder_id: 1 });
preorderItemSchema.index({ product_id: 1 });

const PreorderItem = mongoose.models.PreorderItems || mongoose.model("PreorderItems", preorderItemSchema);
export default PreorderItem;