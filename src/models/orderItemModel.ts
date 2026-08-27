// orderItemModel.ts
import mongoose from "mongoose";

const productSnapshotSchema = new mongoose.Schema(
  {
    product_name_th: { type: String, required: true },
    product_name_eng: { type: String, required: true },
    variant_name: { type: String, default: null },
  },
  { _id: false }
);

const selectedOptionSchema = new mongoose.Schema(
  {
    option_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductOptions", default: null },
    option_name: { type: String, required: true },
    extra_price: { type: Number, default: 0 },
    text_value: { type: String, default: null },
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Orders", required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    variant_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariants", default: null },
    product_snapshot: { type: productSnapshotSchema, required: true },
    selected_options: { type: [selectedOptionSchema], default: [] },
    special_request: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    unit_price: { type: Number, required: true, min: 0 },
    total_price: { type: Number, required: true, min: 0 },
    cost_per_unit: { type: Number, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

orderItemSchema.index({ order_id: 1 });
orderItemSchema.index({ product_id: 1 });

const OrderItem = mongoose.models.OrderItems || mongoose.model("OrderItems", orderItemSchema);
export default OrderItem;