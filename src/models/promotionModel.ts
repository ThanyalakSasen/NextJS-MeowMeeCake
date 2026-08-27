import mongoose from "mongoose";

const promotionSchema = new mongoose.Schema({
    promotion_code: { //รหัสโปรโมชั่น
        type: String,
        required: true,
        unique: true,
    },
    promotion_name: { //ชื่อโปรโมชั่น
        type: String,
        required: true,
    },
    promotion_desc: { //รายละเอียดโปรโมชั่น
        type: String,
        required: false,
    },
    discount_type: { //ประเภทส่วนลด เช่น เปอร์เซ็นต์, จำนวนเงิน, ส่งฟรี เป็นต้น
        type: String,
        required: true,
        enum: ["Percentage", "Amount", "FreeShipping"],
    },
    is_active: { //เปิด/ปิดการใช้งานคูปองด้วยตนเอง แยกจากช่วงวันที่เริ่ม-สิ้นสุด
        type: Boolean,
        default: true,
    },
    applicable_channels: { //ช่องทางที่ใช้โปรโมชั่นนี้ได้ — แยกหน้าร้าน (instore) กับออนไลน์ (online)
        type: [String],
        enum: ["online", "instore"],
        default: ["online", "instore"],
    },
    discount_value: { //ค่าของส่วนลด
        type: Number,
        required: true,
    },
    min_order_amount: { //จำนวนเงินขั้นต่ำในการใช้โปรโมชั่นนี้ — ถ้ากำหนด applicable_products ไว้ด้วย
        // จะเช็คเฉพาะยอดรวมของ "สินค้าที่ร่วมรายการ" เท่านั้น ไม่ใช่ยอดทั้งบิล (เช่น "คละสินค้า A/B ครบ 200 ลด 50")
        type: Number,
        required: false,
    },
    applicable_products: { //สินค้าที่ใช้โปรโมชั่นนี้ได้ — ว่าง [] = ใช้ได้กับสินค้าทุกชิ้น (ไม่จำกัด)
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Products" }],
        default: [],
    },
    applicable_categories: { //หมวดหมู่สินค้าที่ใช้โปรโมชั่นนี้ได้ — ว่าง [] = ไม่จำกัดหมวดหมู่
        // ใช้แทน applicable_products เวลาต้องการให้ครอบคลุมทั้งหมวด (เช่น "ขนมปังทุกชนิด") แทนที่จะไล่เลือก
        // ทีละชิ้น — ปกติเลือกใช้แค่ทางใดทางหนึ่ง (products หรือ categories) ไม่ใช้พร้อมกัน
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "ProductCategories" }],
        default: [],
    },
    min_quantity: { //จำนวนชิ้นขั้นต่ำรวมของ "สินค้าที่ร่วมรายการ" (applicable_products/applicable_categories)
        // ที่ต้องมีในตะกร้า เช่น "ซื้อครบ 3 ชิ้น ลด 10 บาท" — null = ไม่กำหนด (เช็คแค่ min_order_amount แทน ถ้ามี)
        type: Number,
        required: false,
    },
    max_discount_amount: { //จำนวนเงินสูงสุดที่สามารถใช้ส่วนลดนี้ได้ (ถ้า discount_type เป็น Percentage)
        type: Number,
        required: false,
    },
    usage_limit: { //จำนวนครั้งที่สามารถใช้โปรโมชั่นนี้ได้ (ถ้าไม่จำกัดให้เป็น null)
        type: Number,
        required: false,
    },
    used_count: { //จำนวนครั้งที่โปรโมชั่นนี้ถูกใช้ไปแล้ว
        type: Number,
        default: 0,
    },
    max_user_per_user: { //จำนวนครั้งที่ผู้ใช้แต่ละคนสามารถใช้โปรโมชั่นนี้ได้ (ถ้าไม่จำกัดให้เป็น null)
        type: Number,
        required: false,
    },
    start_date: { //วันที่เริ่มต้นโปรโมชั่น
        type: Date,
        required: true,
    },
    end_date: { //วันที่สิ้นสุดโปรโมชั่น
        type: Date,
        required: true,
    },
    created_by: { //ผู้ที่สร้างโปรโมชั่นนี้
        type: mongoose.Schema.Types.ObjectId,
        ref: "Users",
        required: true,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
},
{
    timestamps: {  createdAt: "created_at", updatedAt: "updated_at" },
});

promotionSchema.index({ promo_code: 1 });
promotionSchema.index({ start_date: 1, end_date: 1 });

const PromotionModel = 
  mongoose.models.Promotions || mongoose.model("Promotions", promotionSchema);

export default PromotionModel;