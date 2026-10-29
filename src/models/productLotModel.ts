// productLotModel.ts
import mongoose from "mongoose";

/**
 * ProductLots — ล็อตสินค้าที่ผลิตเสร็จ 1 ล็อต = 1 รายการผลิต (ProductionItems) ของใบสั่งผลิตที่ปิดงานแล้ว
 * (productLotService.createLotsForProduction) · lot_no พิมพ์เป็นบาร์โค้ดบนฉลาก (เครื่องยิงบาร์โค้ดหน้าร้าน)
 *
 * วันที่เก็บเป็น "YYYY-MM-DD" ตามเวลาไทย (ไม่ใช่ Date) — เป็นวันบนฉลาก ไม่มีเวลา/เขตเวลาให้คลาด
 * qty_remaining = คงเหลือของล็อต (สินค้าปกติ) · พรีออเดอร์ = null (ไม่มีสต็อก ส่งตรงให้ลูกค้าที่สั่ง)
 */
const productLotSchema = new mongoose.Schema(
  {
    lot_no: { type: String, required: true, unique: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    production_order_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductionOrders", required: true },
    production_item_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductionItems", required: true },
    // รอบพรีออเดอร์ที่ผลิตให้ (ใบสั่งผลิต source_type "preorder") · ผลิตเอง = null
    round_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreorderRounds", default: null },
    produced_date: { type: String, required: true },
    // null = สินค้าไม่ได้ตั้งอายุและไม่ได้กรอกตอนปิดงาน
    expiry_date: { type: String, default: null },
    qty_produced: { type: Number, required: true, min: 0 },
    qty_remaining: { type: Number, default: null, min: 0 },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// 1 รายการผลิต = 1 ล็อต — กันสร้างซ้ำเมื่อปิดงานซ้ำ/คำขอซ้อน
productLotSchema.index({ production_item_id: 1 }, { unique: true });
productLotSchema.index({ product_id: 1, expiry_date: 1 });
productLotSchema.index({ production_order_id: 1 });

const ProductLot = mongoose.models.ProductLots || mongoose.model("ProductLots", productLotSchema);
export default ProductLot;
