import mongoose from "mongoose";
import "./productVariantModel";
import "./productOptionModel";

const selectedOptionSchema = new mongoose.Schema(
  {
    option_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductOptions",
      default: null,
    },
    option_name: {
      type: String,
      required: true,
    },
    // เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (ทั้ง DB และ API — docs/money-units.md) — สแนปช็อต extra_price ของ option ตอนหยิบใส่ตะกร้า
    extra_price: {
      type: Number,  // ✅ แก้จาก String → Number
      default: 0,
    },
    text_value: {
      type: String,
      default: null, // null ถ้า option ไม่ใช่ text input
    },
  },
  { _id: false } // ✅ ไม่ต้องสร้าง _id ให้ sub-document
);

const cartItemSchema = new mongoose.Schema(
  {
    cart_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Carts",
      required: true,
    },
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Products",
      required: true,
    },
    variant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductVariants",
      default: null,
    },
    selected_options: {
      type: [selectedOptionSchema], // ✅ แก้ syntax array of objects
      default: [],
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    // เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (ทั้ง DB และ API — docs/money-units.md) — สแนปช็อตราคา (สินค้า + variant + options) ตอนหยิบใส่ตะกร้า
    price_snapshot: {
      type: Number,
      required: true,
    },
    added_at: {
      type: Date,
      default: Date.now, // ✅ ให้ default เป็นเวลาปัจจุบัน
    },
    deleted_at: {
      type: Date,
      default: null, // ✅ เพิ่ม soft delete field แยกต่างหาก
    },
  },
  {
    timestamps: {
      createdAt: "created_at", // ✅ timestamps รองรับแค่สองนี้
      updatedAt: "updated_at",
    },
  }
);

cartItemSchema.index({ cart_id: 1 });
cartItemSchema.index({ cart_id: 1, product_id: 1, variant_id: 1 });

const CartItem =
  mongoose.models.CartItems || mongoose.model("CartItems", cartItemSchema);

export default CartItem;