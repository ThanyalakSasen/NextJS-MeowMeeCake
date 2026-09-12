import mongoose from "mongoose";


const promotionUsagesSchema = new mongoose.Schema({
    promotion_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Promotions",
        required: true,
    },
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Users",
        required: true,
    },
    order_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Orders",
        required: false,
    },
    preorder_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Preorders",
        required: false,
    },
    // BACKLOG §3.11 — สตางค์ (integer) ตั้งแต่ 2026-09-12 (promotionModel.discount_value เอง**ยังเป็นบาท**
    // — ไม่ได้แปลงในเฟสนี้ ไม่ใช่ปัญหาเพราะ field นี้เก็บ "ผลลัพธ์สุดท้าย" ที่คิดจาก order/preorder subtotal
    // (สตางค์) ไปแล้ว ไม่เคยถูกอ่านกลับไปเทียบกับ promotionModel.discount_value ตรง ๆ ที่ไหนเลย)
    discount_applied: { //จำนวนเงินส่วนลดที่ถูกใช้จริงในการสั่งซื้อครั้งนี้ (อาจจะไม่เท่ากับ discount_value ใน Promotion ถ้า min_order_amount ไม่ถึง หรือ max_discount_amount ถูกจำกัด)
        type: Number,
        required: true,
    },
    usage_date: { //วันที่และเวลาที่ใช้โปรโมชั่นนี้
        type: Date,
        default: Date.now,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
}
, {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
});

promotionUsagesSchema.index({ promotion_id: 1, user_id: 1 });

const PromotionUsagesModel = 
  mongoose.models.PromotionUsages || mongoose.model("PromotionUsages", promotionUsagesSchema);

export default PromotionUsagesModel;