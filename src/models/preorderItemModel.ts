// preorderItemModel.ts
import mongoose from "mongoose";

const preorderProductSnapshotSchema = new mongoose.Schema(
  {
    product_name_th: { type: String, required: true },
    product_name_eng: { type: String, required: true },
    variant_name: { type: String, default: null },
  },
  { _id: false }
);

// ตัวเลือกที่เลือกในแต่ละกลุ่ม (snapshot ชื่อ/ราคาตอนสั่ง — docs/customer-backend-merge.md §8)
const selectedVariantSchema = new mongoose.Schema(
  {
    group_name: { type: String, default: "" },
    variant_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariants", default: null },
    variant_name: { type: String, required: true },
    variant_price: { type: Number, default: 0 },
  },
  { _id: false }
);

const preorderSelectedOptionSchema = new mongoose.Schema(
  {
    option_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductOptions", default: null },
    option_name: { type: String, required: true },
    extra_price: { type: Number, default: 0 },
    text_value: { type: String, default: null },
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
    variant_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariants", default: null },
    selected_variants: { type: [selectedVariantSchema], default: [] },
    selected_options: { type: [preorderSelectedOptionSchema], default: [] },
    special_request: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    // unit_price / total_price / cost_per_unit: เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (ทั้ง DB และ API — docs/money-units.md)
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