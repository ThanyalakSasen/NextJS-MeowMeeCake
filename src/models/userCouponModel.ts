// userCouponModel.ts
// คูปองส่วนตัวที่ลูกค้าแลกด้วยแต้มสะสม — 1 แถว = คูปอง 1 ใบ ใช้ได้ครั้งเดียว · ย้ายมาจาก backend ฝั่งลูกค้า (collection เดียวกัน · customer-backend-merge.md §8.11)
// เก็บ snapshot เงื่อนไขส่วนลด ณ ตอนแลกไว้ ร้านแก้โปรโมชั่นต้นทางทีหลังก็ไม่กระทบคูปองที่ลูกค้าแลกไปแล้ว
import mongoose from "mongoose";

const userCouponSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    promotion_id: { type: mongoose.Schema.Types.ObjectId, ref: "Promotions", required: true },
    promotion_code: { type: String, required: true },
    promotion_name: { type: String, required: true },
    discount_type: { type: String, enum: ["Percentage", "Amount", "FreeShipping"], required: true },
    discount_value: { type: Number, required: true },
    min_order_amount: { type: Number, default: 0 },
    max_discount_amount: { type: Number, default: null },
    points_spent: { type: Number, required: true, min: 0 },
    // available = ยังไม่ได้ใช้, used = ใช้กับออเดอร์แล้ว (ออเดอร์ถูกยกเลิก → กลับเป็น available)
    status: { type: String, enum: ["available", "used"], default: "available" },
    expires_at: { type: Date, required: true },
    used_ref_type: { type: String, enum: ["order", "preorder", null], default: null },
    used_ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    used_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

userCouponSchema.index({ user_id: 1, status: 1, expires_at: 1 });
userCouponSchema.index({ user_id: 1, promotion_id: 1 });
userCouponSchema.index({ used_ref_type: 1, used_ref_id: 1 });


const UserCoupon = mongoose.models.UserCoupons || mongoose.model("UserCoupons", userCouponSchema);
export default UserCoupon;
