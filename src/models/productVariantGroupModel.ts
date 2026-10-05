// productVariantGroupModel.ts
// กลุ่มตัวเลือกของสินค้า (เช่น เค้กวันเกิด: "ขนาด" เลือก 1, "รสชาติ" เลือกได้สูงสุด 2) — ย้ายมาจาก backend ฝั่งลูกค้า
// ตัวเลือกแต่ละอันอยู่ที่ ProductVariants (group_id ชี้มาที่นี่) · ตัวเลือกเป็นแค่ราคาบวกเพิ่ม ไม่มีสต็อกแยก
// min_select = ต้องเลือกอย่างน้อยกี่อย่าง (0 = ไม่บังคับ) · max_select = เลือกได้มากสุดกี่อย่าง (1 = เลือกได้อย่างเดียว)
import mongoose from "mongoose";

const productVariantGroupSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    group_name: { type: String, required: true, trim: true, maxlength: 100 },
    min_select: { type: Number, default: 1, min: 0 },
    max_select: { type: Number, default: 1, min: 1 },
    display_order: { type: Number, default: 0 },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

productVariantGroupSchema.index({ product_id: 1 });

const ProductVariantGroupModel =
  mongoose.models.ProductVariantGroups ||
  mongoose.model("ProductVariantGroups", productVariantGroupSchema);

export default ProductVariantGroupModel;
