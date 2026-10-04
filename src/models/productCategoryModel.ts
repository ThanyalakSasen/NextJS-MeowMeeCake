import mongoose from "mongoose";

const productCategorySchema = new mongoose.Schema({
  product_category_name: {
    type: String,
    required: true,
  },
  // ส่งได้ทั่วประเทศไหม (ออเดอร์เว็บ — src/lib/shipping.ts) · ปิด = ส่งได้เฉพาะในจังหวัดร้าน (StoreSettings.province)
  // ไม่ใส่ default โดยตั้งใจ: หมวดที่ยังไม่เคยตั้งค่า fallback ไปดูชื่อหมวด (ซาวโดว์ = ทั่วประเทศ) ใน categoryShipsNationwide
  ships_nationwide: {
    type: Boolean,
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
