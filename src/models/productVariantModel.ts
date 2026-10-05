import mongoose from "mongoose";

const productVariantSchema = new mongoose.Schema({
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Products",
    required: true,
  },
  // กลุ่มตัวเลือก (ProductVariantGroups) — null = ข้อมูลเก่าก่อนมีกลุ่ม (นับเป็นกลุ่ม "ตัวเลือก" เลือก 1)
  group_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ProductVariantGroups",
    default: null,
  },
  variant_name: {
    //ชื่อตัวเลือกที่มีเยอะ เช่น รสชาติ หรือขนาด
    type: String,
    required: true,
    trim: true,
  },
  // เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (ทั้ง DB และ API — docs/money-units.md)
  variant_price: {
    //ราคาที่เพิ่มขึ้นจากราคาสินค้าหลัก
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  // เลิกใช้แล้ว (docs/customer-backend-merge.md §8) — ตัวเลือกเป็นแค่ราคาเพิ่ม สต็อกอยู่ที่ตัวสินค้า · คงไว้ให้อ่านข้อมูลเก่าได้
  variant_stock: {
    type: Number,
    default: 0,
    min: 0,
  },
  unit_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Units",
    required: false,
  },
  // ลำดับการแสดง (น้อยแสดงก่อน)
  display_order: {
    type: Number,
    default: 0,
  },
  deleted_at: {
      type: Date,
      default: null,
    },
  
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  });

productVariantSchema.index({ product_id: 1 });

const ProductVariantModel =
  mongoose.models.ProductVariants ||
  mongoose.model("ProductVariants", productVariantSchema);

export default ProductVariantModel;
