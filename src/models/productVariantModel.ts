import mongoose from "mongoose";

const productVariantSchema = new mongoose.Schema({
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Products",
    required: true,
  },
  variant_name: {
    //ชื่อตัวเลือกที่มีเยอะ เช่น รสชาติ หรือขนาด
    type: String,
    required: true,
    trim: true,
  },
  variant_price: {
    //ราคาที่เพิ่มขึ้นจากราคาสินค้าหลัก
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  variant_stock: {
    //จำนวนสินค้าตัวเลือกนี้
    type: Number,
    default: 0,
    min: 0,
  },
  unit_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Units",
    required: false,
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
