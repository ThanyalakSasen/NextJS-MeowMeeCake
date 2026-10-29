// productStockTransactionModel.ts
import mongoose from "mongoose";

/**
 * ProductStockTransactions — ประวัติการเคลื่อนไหวสต็อกสินค้าปกติ (product_stock_quantity) ทุกช่องทาง
 * บันทึกโดย productService ทุกครั้งที่สต็อกเปลี่ยน (productStockHistoryService) — ไม่ใช่ที่ปรับสต็อกเอง
 *
 * type:
 *   receive     = รับเข้า (หน้าสต็อกสินค้า)            use        = เบิกใช้/ตัดของเสีย (หน้าสต็อกสินค้า)
 *   adjust      = ปรับยอดตามที่นับได้                  production = ปิดงานผลิต → เพิ่มสินค้าสำเร็จรูป
 *   sale        = ขาย (สร้างออเดอร์ / เปิดออเดอร์กลับ)   sale_return = คืนสต็อก (ยกเลิกออเดอร์ / สร้างออเดอร์ไม่สำเร็จ)
 * delta = ส่วนต่างแบบมีเครื่องหมาย (+ เพิ่ม / − ลด) · qty_before → qty_after = ยอดก่อน/หลังจากผล update แบบ atomic
 * ref_type + ref_id = เอกสารต้นทาง (ออเดอร์ / ใบสั่งผลิต) — เลขเอกสารอ่านตอนแสดงผล (เลขออเดอร์อาจเปลี่ยนตอนสร้างซ้ำ)
 * performed_by = ผู้ทำรายการ · null = ระบบ / ลูกค้าสั่งเอง
 */
export const PRODUCT_STOCK_TXN_TYPES = ["receive", "use", "adjust", "production", "sale", "sale_return"] as const;
export const PRODUCT_STOCK_REF_TYPES = ["order", "production_order"] as const;

const productStockTransactionSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    type: { type: String, enum: PRODUCT_STOCK_TXN_TYPES, required: true },
    delta: { type: Number, required: true },
    qty_before: { type: Number, required: true },
    qty_after: { type: Number, required: true },
    note: { type: String, default: "" },
    ref_type: { type: String, enum: [...PRODUCT_STOCK_REF_TYPES, null], default: null },
    ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    performed_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

productStockTransactionSchema.index({ product_id: 1, created_at: -1 });
productStockTransactionSchema.index({ type: 1, created_at: -1 });
productStockTransactionSchema.index({ created_at: -1 });
productStockTransactionSchema.index({ ref_type: 1, ref_id: 1 });

const ProductStockTransaction =
  mongoose.models.ProductStockTransactions ||
  mongoose.model("ProductStockTransactions", productStockTransactionSchema);
export default ProductStockTransaction;
