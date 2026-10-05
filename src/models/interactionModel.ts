// interactionModel.ts
// ═══════════════════════════════════════════════════════════════════════════════
// เก็บ logs พฤติกรรมของผู้ใช้ (User Interaction) สำหรับระบบ Recommendation
//
// ⚠️ หมายเหตุสำคัญ:
//  - ทำหน้าที่เป็น "source of truth" สำหรับ action ใหม่ (view / wishlist / add_to_cart / purchase)
//    (ย้ายมาจาก backend ฝั่งลูกค้า — collection เดียวกัน · รายการโปรด = action_type "wishlist" · customer-backend-merge.md §8.14)
//  - collection เดิม เช่น Orders/OrderItems, Carts/CartItems, Reviews ยังคงเป็นแหล่งข้อมูลเดิม
//    (legacy data) ซึ่ง recommendationEngine จะอ่านรวมกันแล้ว dedupe
// ───────────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";

// รายการ action ที่รองรับทั้งหมด (enum ของ collection นี้)
export const INTERACTION_ACTION_TYPES = [
  "view",
  "add_to_cart",
  "wishlist",
  "purchase",
] as const;

export type InteractionActionType = (typeof INTERACTION_ACTION_TYPES)[number];

// น้ำหนักแต่ละ action ตาม spec ของ Hybrid Recommendation (กลยุทธ์ A)
//   purchase    → 5
//   add_to_cart → 3
//   wishlist    → 4
//   view        → 1
export const INTERACTION_ACTION_WEIGHTS: Record<InteractionActionType, number> = {
  view: 1,
  add_to_cart: 3,
  wishlist: 4,
  purchase: 5,
};

const interactionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
      index: true,
    },
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Products",
      required: true,
      index: true,
    },
    action_type: {
      type: String,
      enum: INTERACTION_ACTION_TYPES,
      required: true,
    },
    // metadata เก็บข้อมูลเสริม เช่น ค่า quantity, session id, อุปกรณ์ ฯลฯ
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// Index สำหรับ query ทั่วไปของ recommendation engine
interactionSchema.index({ user_id: 1, created_at: -1 });
interactionSchema.index({ user_id: 1, product_id: 1 });


const Interaction = mongoose.models.Interactions || mongoose.model("Interactions", interactionSchema);

export default Interaction;