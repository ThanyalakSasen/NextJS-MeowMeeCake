import mongoose from "mongoose";

const productCategorySchema = new mongoose.Schema({
  product_category_name: {
    type: String,
    required: true,
  },
  deleted_at: {
    type: Date,
    default: null,
  },},
  {
    timestamps: {  createdAt: "created_at", updatedAt: "updated_at" },
  });

// product_category_name ห้ามซ้ำ แต่เฉพาะหมวดหมู่ที่ยังไม่ถูกลบ (partial unique) — BACKLOG2 §1:
// เดิมเป็น unique ธรรมดา ลบหมวดหมู่ทิ้งแล้วสร้างชื่อเดิมใหม่ไม่ได้อีกเลย
productCategorySchema.index(
  { product_category_name: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

const ProductCategoryModel =
  mongoose.models.ProductCategories ||
  mongoose.model("ProductCategories", productCategorySchema);


export default ProductCategoryModel;
