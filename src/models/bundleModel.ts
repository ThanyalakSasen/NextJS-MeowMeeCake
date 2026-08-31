import mongoose from "mongoose";

const bundleItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Products",
      required: true,
    },
    // ก๊อปปี้ชื่อ/ราคาสินค้า ณ ตอนสร้างแพ็กเกจไว้ตรงนี้ (denormalized)
    // กันราคาแพ็กเกจเปลี่ยนไปเองถ้าราคาสินค้าจริงถูกแก้ทีหลัง
    name: { type: String, required: true },
    emoji: { type: String, default: "🎂" },
    unit_price: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const bundleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    tagline: {
      type: String,
      default: "",
    },
    items: {
      type: [bundleItemSchema],
      default: [],
    },
    original_price: {
      type: Number,
      required: true,
      min: 0,
    },
    bundle_price: {
      type: Number,
      required: true,
      min: 0,
    },
    end_date: {
      // null = ไม่มีวันหมดเขต
      type: Date,
      default: null,
    },
    sold_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    // สถานะ "หมดเขต" คำนวณจาก end_date ฝั่ง frontend ได้เลย ไม่ต้องเก็บซ้ำ
    is_active: {
      type: Boolean,
      default: true,
    },
    gradient_from: { type: String, default: "#f9a8d4" },
    gradient_to: { type: String, default: "#c084fc" },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

bundleSchema.index({ is_active: 1 });
bundleSchema.index({ deleted_at: 1 });

const Bundle =
  mongoose.models.Bundles || mongoose.model("Bundles", bundleSchema);

export default Bundle;
