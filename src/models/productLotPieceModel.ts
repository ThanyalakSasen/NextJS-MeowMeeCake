// productLotPieceModel.ts
import mongoose from "mongoose";

/**
 * ProductLotPieces — สินค้ารายชิ้นของล็อต (1 เอกสารต่อ 1 ชิ้น) · piece_code พิมพ์เป็นบาร์โค้ดบนฉลากแต่ละดวง
 * piece_code = "<เลขล็อต>-<ลำดับชิ้น>" เช่น L2610290001-001 (productLotService.pieceCode) — ไม่ซ้ำกันทั้งระบบ
 * สร้างพร้อมล็อตตอนปิดงานผลิต · ล็อตที่สร้างก่อนมีตารางนี้ = สร้างให้ตอนขอรายการชิ้นครั้งแรก (productLotService.ensurePieces)
 * สแกนฉลาก → ค้นจาก piece_code → ล็อต (วันผลิต/วันหมดอายุ/ใบสั่งผลิต)
 */
const productLotPieceSchema = new mongoose.Schema(
  {
    piece_code: { type: String, required: true, unique: true },
    lot_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductLots", required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
    piece_no: { type: Number, required: true, min: 1 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

// 1 ลำดับต่อล็อต — กันสร้างซ้ำเมื่อ ensurePieces ถูกเรียกซ้อน
productLotPieceSchema.index({ lot_id: 1, piece_no: 1 }, { unique: true });

const ProductLotPiece = mongoose.models.ProductLotPieces || mongoose.model("ProductLotPieces", productLotPieceSchema);
export default ProductLotPiece;
