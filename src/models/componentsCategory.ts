import mongoose from "mongoose";

const componentCategorySchema = new mongoose.Schema({
  component_category_name: {
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

// component_category_name ห้ามซ้ำ แต่เฉพาะหมวดหมู่ที่ยังไม่ถูกลบ (partial unique) — BACKLOG2 §1:
// เดิมเป็น unique ธรรมดา ลบหมวดหมู่ทิ้งแล้วสร้างชื่อเดิมใหม่ไม่ได้อีกเลย
componentCategorySchema.index(
  { component_category_name: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

const ComponentCategory =
  mongoose.models.ComponentCategory || mongoose.model("ComponentCategory", componentCategorySchema);

export default ComponentCategory;
