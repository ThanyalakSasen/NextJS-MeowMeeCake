import mongoose from "mongoose";

const ingredientSchema = new mongoose.Schema({
  ingredient_name: {
    type: String,
    required: true,
  },
  ingredient_category_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "IngredientCategory",
    required: true,
  },
  unit_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Units",
    required: true,
  },
  // เพิ่ม field นี้เพื่อไม่ต้อง aggregate StockMovement ทุกครั้ง
  current_stock: {
    type: Number,
    default: 0,
  },
  // BACKLOG §3.11 เฟส 4 — เก็บเป็น "สตางค์" (integer) ตั้งแต่ 2026-09-12 (ดู src/lib/money.ts)
  // API (ingredientService) ยังรับ-ส่งเป็นบาททศนิยมเหมือนเดิม
  cost_per_unit: {
    type: Number,
    required: true,
  },
  reorder_point: {
    // ปริมาณขั้นต่ำที่จะแสดงสถานะสำหรับสั่งซื้อวัตถุดิบใหม่
    type: Number,
    required: true,
  },
  max_stock: {
    // ปริมาณสูงสุดที่เก็บได้ตามปกติ ใช้คำนวณ % แถบสต็อกในหน้า UI
    type: Number,
    default: null,
  },
  supplier: {
    type: String,
    default: "",
  },
  deleted_at: { type: Date, default: null },
},
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

ingredientSchema.index({ ingredient_category_id: 1 });
ingredientSchema.index({ current_stock: 1 });
ingredientSchema.index({ deleted_at: 1 });
// ingredient_name ห้ามซ้ำ แต่เฉพาะวัตถุดิบที่ยังไม่ถูกลบ (partial unique) — BACKLOG2 §1: เดิมเป็น
// unique ธรรมดา ลบวัตถุดิบทิ้งแล้วสร้างชื่อเดิมใหม่ไม่ได้อีกเลย
ingredientSchema.index(
  { ingredient_name: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

const IngredientModel =
  mongoose.models.Ingredients ||           // ✅ เช็คก่อนว่ามีแล้วหรือยัง
  mongoose.model("Ingredients", ingredientSchema);
export default IngredientModel;
