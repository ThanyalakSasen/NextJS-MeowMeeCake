import mongoose from "mongoose";

const ingredientCategorySchema = new mongoose.Schema({
  ingredient_category_name: {
    type: String,
    required: true,
  },
  deleted_at: {
    type: Date,
    default: null,
  },
},
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// ingredient_category_name ห้ามซ้ำ แต่เฉพาะหมวดหมู่ที่ยังไม่ถูกลบ (partial unique) — BACKLOG2 §1:
// เดิมเป็น unique ธรรมดา ลบหมวดหมู่ทิ้งแล้วสร้างชื่อเดิมใหม่ไม่ได้อีกเลย
ingredientCategorySchema.index(
  { ingredient_category_name: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

const IngredientCategory =
  mongoose.models.IngredientCategory || mongoose.model("IngredientCategory", ingredientCategorySchema);

export default IngredientCategory;
