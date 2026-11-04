// pushSubscriptionModel.ts
// อุปกรณ์ที่ลูกค้าเปิดรับแจ้งเตือนบนเครื่อง (Web Push) — 1 แถว = 1 เบราว์เซอร์/แอปที่เพิ่มลงหน้าจอโฮม
// ส่งทุกครั้งที่บันทึกกระดิ่งของลูกค้า (customerNotifyService.notifyCustomer) · ปลายทางหมดอายุ (404/410) = ลบทิ้งอัตโนมัติ
import mongoose from "mongoose";

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    // URL ของ push service (FCM / Mozilla / Apple) — ไม่ซ้ำกันต่ออุปกรณ์
    endpoint: { type: String, required: true, maxlength: 2000 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 200 },
      auth: { type: String, required: true, maxlength: 100 },
    },
    user_agent: { type: String, default: null, maxlength: 500 },
    last_success_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ user_id: 1 });

const PushSubscription =
  mongoose.models.PushSubscriptions || mongoose.model("PushSubscriptions", pushSubscriptionSchema);
export default PushSubscription;
