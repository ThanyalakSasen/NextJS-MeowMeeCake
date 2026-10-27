// paymentGroupModel.ts — กลุ่มบิลที่สั่งพร้อมกันในการสั่งซื้อรวมครั้งเดียว (collection: paymentgroups)
// ตะกร้ารวม (สินค้าปกติ + พรีออเดอร์หลายรอบ) → POST /api/shop/checkout สร้างหลายบิล (1 ออเดอร์ + 1 พรีออเดอร์ต่อรอบ)
// แล้วผูกไว้เป็นกลุ่มเดียว — ลูกค้าโอนครั้งเดียว (QR ยอดรวม) + แนบสลิปเดียว · แต่ละบิลยังมี Payment ของตัวเอง
// (สลิปเดียวกัน + group_id) ให้หลังร้านตรวจ/คืนเงินรายบิลได้เหมือนเดิม — ยืนยัน/ปฏิเสธใบหนึ่ง = ทั้งกลุ่ม (paymentService)
import mongoose from "mongoose";

const memberSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["order", "preorder"], required: true },
    ref_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    doc_no: { type: String, required: true },
  },
  { _id: false }
);

// บิลที่ไม่เก็บค่าส่งเพราะรวมกับบิลอื่น (checkoutService) — บิลที่เก็บแทนถูกยกเลิกก่อนชำระ = คืนค่าส่งให้บิลนี้
// (paymentGroupService.restoreWaivedShipping) · fee = ค่าส่งของบิลที่เก็บแทน (คิดจากจังหวัด — ที่อยู่เดียวกัน = เท่ากัน)
const shippingWaiverSchema = new mongoose.Schema(
  {
    ref_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    payer_kind: { type: String, enum: ["order", "preorder"], required: true },
    payer_ref_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    fee: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentGroupSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    members: { type: [memberSchema], default: [] },
    shipping_waivers: { type: [shippingWaiverSchema], default: [] },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "paymentgroups" }
);

paymentGroupSchema.index({ user_id: 1, created_at: -1 });
paymentGroupSchema.index({ "members.ref_id": 1 });

const PaymentGroup = mongoose.models.PaymentGroups || mongoose.model("PaymentGroups", paymentGroupSchema);
export default PaymentGroup;
