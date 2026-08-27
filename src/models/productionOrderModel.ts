// productionOrderModel.ts
import mongoose from "mongoose";

const productionOrderSchema = new mongoose.Schema(
  {
    production_no: { type: String, required: true, unique: true },
    production_date: { type: Date, required: true },
    source_type: { type: String, enum: ["manual", "preorder"], required: true },
    round_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreorderRounds", default: null },
    production_status: { type: String, enum: ["planned", "in_progress", "done", "cancelled"], default: "planned" },
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },
    production_note: { type: String, default: null },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

productionOrderSchema.index({ production_status: 1 });
productionOrderSchema.index({ production_date: 1 });
productionOrderSchema.index({ source_type: 1 });

const ProductionOrder = mongoose.models.ProductionOrders || mongoose.model("ProductionOrders", productionOrderSchema);
export default ProductionOrder;