// preorderRoundItemModel.ts
import mongoose from "mongoose";

const preorderRoundItemSchema = new mongoose.Schema(
  {
    round_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreorderRounds", required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    // BACKLOG §3.11 เฟส 5b — เก็บเป็น "สตางค์" (integer) ตั้งแต่ 2026-09-12 (ดู src/lib/money.ts)
    // API (preorderRoundService) ยังรับ-ส่งเป็นบาททศนิยมเหมือนเดิม — ผูก fallback chain เดียวกับ
    // productModel.product_price/sale_price ใน getOrderableRoundItem()/getRoundDetail() จึงต้องแปลง
    // พร้อมกันเสมอ (เหตุผลเดียวกับ productModel.purchase_cost ในเฟส 4)
    price_override: { type: Number, default: null },
    min_order_qty: { type: Number, default: 1, min: 1 },
    max_qty_total: { type: Number, required: true, min: 1 },
    current_qty: { type: Number, default: 0, min: 0 },
    is_active: { type: Boolean, default: true },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

preorderRoundItemSchema.index({ round_id: 1 });
// { round_id, product_id } ห้ามซ้ำ แต่เฉพาะรายการที่ยังไม่ถูกลบ (partial unique) — BACKLOG2 §1:
// เดิมเป็น unique ธรรมดา เอาสินค้าออกจากรอบ (soft delete) แล้วเพิ่มสินค้าตัวเดิมกลับเข้ารอบเดิม
// ไม่ได้อีกเลย
preorderRoundItemSchema.index(
  { round_id: 1, product_id: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

const PreorderRoundItem = mongoose.models.PreorderRoundItems || mongoose.model("PreorderRoundItems", preorderRoundItemSchema);
export default PreorderRoundItem;