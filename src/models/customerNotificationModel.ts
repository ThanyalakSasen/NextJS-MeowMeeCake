// customerNotificationModel.ts
// การแจ้งเตือนในเว็บของลูกค้า (กระดิ่งบน Navbar + หน้า /customer/account/notifications)
// แยกจาก Notifications (ของร้าน/พนักงาน) — ลูกค้าแต่ละคนเห็นเฉพาะของตัวเอง (user_id)
// สร้างพร้อมการแจ้งลูกค้าทาง LINE (customerNotifyService) — ลูกค้าที่ไม่ได้ผูก LINE ก็ยังเห็น · ย้ายมาจาก backend ฝั่งลูกค้า (§8.12)
import mongoose from "mongoose";

const customerNotificationSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 2000 },
    // ใช้เลือกไอคอน/สีฝั่งหน้าเว็บ
    type: { type: String, enum: ["info", "success", "warning", "error"], default: "info" },
    // ลิงก์ภายในเว็บ (path) เช่น /customer/account/purchases/<id>
    link: { type: String, default: null },
    // อ้างอิงคำสั่งซื้อที่เกี่ยวข้อง (ไว้ตรวจสอบย้อนหลัง)
    ref_type: { type: String, enum: ["order", "preorder", "coupon", "bundle", "preorder_round", null], default: null },
    ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    // เวลาที่เริ่มแสดงให้ลูกค้าเห็น — ปกติ = ตอนสร้าง · รอบพรีออเดอร์ที่ยังไม่เปิดรับ = วันเวลาเปิดรับ (บันทึกล่วงหน้า)
    // เอกสารเก่าที่ไม่มี field นี้ถือว่าแสดงตั้งแต่ created_at
    visible_at: { type: Date, default: () => new Date() },
    read_at: { type: Date, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

customerNotificationSchema.index({ user_id: 1, created_at: -1 });
customerNotificationSchema.index({ user_id: 1, read_at: 1 });
customerNotificationSchema.index({ user_id: 1, visible_at: -1 });
customerNotificationSchema.index({ ref_type: 1, ref_id: 1 });


const CustomerNotification =
  mongoose.models.CustomerNotifications ||
  mongoose.model("CustomerNotifications", customerNotificationSchema);
export default CustomerNotification;
