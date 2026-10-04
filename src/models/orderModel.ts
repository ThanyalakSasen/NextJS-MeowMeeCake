// orderModel.ts
import mongoose from "mongoose";

const deliveryAddressSchema = new mongoose.Schema(
  {
    recipient_name: { type: String, required: true },
    recipient_phone: { type: String, required: true },
    house_no: { type: String, required: true },
    sub_district: { type: String, required: true },
    district: { type: String, required: true },
    province: { type: String, required: true },
    zip_code: { type: String, required: true },
  },
  { _id: false }
);

// สำเนาจุดรับ (หน้าร้านประจำสัปดาห์ StoreProfile.weekly_markets) ณ เวลาสั่ง — โครงเดียวกับฝั่งลูกค้า
// (docs/customer-backend-merge.md §8.7 · src/services/shippingService.ts)
const pickupPointSnapshotSchema = new mongoose.Schema(
  {
    point_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    point_name: { type: String, required: true },
    address: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    order_no: { type: String, required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    order_type: { type: String, enum: ["delivery", "takeaway"], required: true },
    order_status: { type: String, enum: ["pending", "confirmed", "preparing", "ready", "completed", "cancelled"], default: "pending" },
    payment_status: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending" },
    delivery_address: { type: deliveryAddressSchema, default: null },
    // รับเอง (takeaway) จากหน้าเว็บ — วันรับ (เที่ยงคืนเวลาไทย) + จุดรับ · ไม่ส่งมา = รับที่ร้านแบบเดิม (null)
    pickup_date: { type: Date, default: null },
    pickup_point: { type: pickupPointSnapshotSchema, default: null },
    // subtotal / discount_amount / delivery_fee / total_amount: เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (ทั้ง DB และ API — docs/money-units.md)
    subtotal: { type: Number, required: true, min: 0 },
    discount_amount: { type: Number, default: 0 },
    delivery_fee: { type: Number, default: 0 },
    total_amount: { type: Number, required: true, min: 0 },
    promotion_id: { type: mongoose.Schema.Types.ObjectId, ref: "Promotions", default: null },
    payment_id: { type: mongoose.Schema.Types.ObjectId, ref: "Payments", default: null },
    // กำหนดชำระของออเดอร์จากหน้าเว็บ (สร้าง + 30 นาที) — เลยแล้วยังไม่ส่งสลิป → ยกเลิกอัตโนมัติ (orderExpiryService)
    // null = ไม่มีกำหนด (POS / แอดมินสร้าง / ออเดอร์เก่า)
    payment_due_at: { type: Date, default: null },
    // ลิงก์หน้าชำระเงินแบบใช้ครั้งเดียว — เก็บ SHA-256 ของ token (src/services/paymentLinkService.ts) · select: false กันหลุดไปกับ API อื่น
    payment_link_token: { type: String, default: null, select: false },
    payment_link_expires_at: { type: Date, default: null, select: false },
    delivery_status: { type: String, enum: ["pending", "shipping", "delivered", "failed"], default: "pending" },
    tracking_no: { type: String, default: null },
    shipped_at: { type: Date, default: null },
    delivered_note: { type: String, default: null },
    delivered_at: { type: Date, default: null },
    cancelled_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },
    cancelled_reason: { type: String, default: null },
    cancelled_at: { type: Date, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

orderSchema.index({ user_id: 1 });
orderSchema.index({ order_status: 1 });
orderSchema.index({ created_at: -1 });
orderSchema.index({ payment_due_at: 1 }, { partialFilterExpression: { payment_due_at: { $type: "date" } } });
orderSchema.index({ payment_link_token: 1 }, { sparse: true });

const Order = mongoose.models.Orders || mongoose.model("Orders", orderSchema);
export default Order;