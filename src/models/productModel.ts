import mongoose from "mongoose";

const preorderConfigSchema = new mongoose.Schema(
  {
    min_order_qty: {
      type: Number,
      required: true,
      min: 1,
    },
    max_order_qty: {
      type: Number,
      required: true,
      min: 1,
    },
    lead_time_days: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    product_name_th: {
      type: String,
      required: true,
      trim: true,
    },
    product_name_eng: {
      type: String,
      required: true,
      trim: true,
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductCategories",
      required: true,
    },
    product_price: {
      type: Number,
      required: true,
      min: 0,
    },
    sale_price: {
      // ราคาโปรโมชัน — null = ไม่มีการลดราคา ใช้ product_price ตามปกติ
      type: Number,
      default: null,
      min: 0,
    },
    is_visible: {
      // ควบคุมว่าจะแสดงสินค้านี้ในหน้าร้านหรือไม่ (ซ่อนได้โดยไม่ต้องลบ)
      type: Boolean,
      default: true,
    },
    product_img: {
      type: [String],
      default: [],
    },
    product_description: {
      type: String,
      default: null,
    },
    preparation_heating: {
      type: String,
      default: null,
    },
    yield_per_batch: {
      type: Number,
      default: null,
      min: 0,
    },
    unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Units",
      required: true,
    },
    product_type: {
      type: String,
      enum: ["ready", "preorder"],
      required: true,
    },
    product_stock_quantity: {
      // มีค่าเฉพาะ product_type = "ready"
      // product_type = "preorder" → null
      type: Number,
      min: 0,
      default: null,
    },
    avg_rating: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0,
      max: 5,
      default: null,
    },
    review_count: {
      type: Number,
      min: 0,
      default: 0,
    },
    preorder_config: {
      // null ถ้า product_type = "ready"
      type: preorderConfigSchema,
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);



// ── Indexes ─────────────────────────────────────────────────
productSchema.index({ category_id: 1 });
productSchema.index({ product_type: 1 });
productSchema.index({ product_type: 1, deleted_at: 1 });
productSchema.index({ avg_rating: -1 });
productSchema.index({ deleted_at: 1 });

const Product =
  mongoose.models.Products || mongoose.model("Products", productSchema);

export default Product;