// productionItemModel.ts
import mongoose from "mongoose";

const stockImpactSchema = new mongoose.Schema(
  {
    ingredient_id: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredients", required: true },
    qty_consumed: { type: Number, required: true, min: 0 },
    unit_id: { type: mongoose.Schema.Types.ObjectId, ref: "Units", required: true },
  },
  { _id: false }
);

const productionItemSchema = new mongoose.Schema(
  {
    production_order_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductionOrders", required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    recipe_id: { type: mongoose.Schema.Types.ObjectId, ref: "Recipes", required: true },
    round_item_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreorderRoundItems", default: null },
    planned_qty: { type: Number, required: true, min: 0 },
    actual_qty: { type: Number, default: null },
    item_status: { type: String, enum: ["pending", "in_progress", "done", "cancelled"], default: "pending" },
    stock_impact: { type: [stockImpactSchema], default: [] },
    stock_updated_at: { type: Date, default: null },
    notes: { type: String, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

productionItemSchema.index({ production_order_id: 1 });
productionItemSchema.index({ product_id: 1 });

const ProductionItem = mongoose.models.ProductionItems || mongoose.model("ProductionItems", productionItemSchema);
export default ProductionItem;