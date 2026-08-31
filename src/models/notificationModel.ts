import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      // ระดับความสำคัญของการแจ้งเตือน ใช้กำหนดสี/ไอคอนฝั่ง frontend
      type: String,
      enum: ["warning", "info", "success", "error"],
      required: true,
    },
    module: {
      // โมดูลต้นทางของการแจ้งเตือน ใช้กรอง/จัดกลุ่มฝั่ง frontend
      type: String,
      enum: ["order", "ingredient", "production", "employee", "finance", "system"],
      required: true,
    },
    is_read: {
      type: Boolean,
      default: false,
    },
    link: {
      // ลิงก์ที่พาไปหน้าที่เกี่ยวข้อง เช่น /owner/orders/manageOrders
      type: String,
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

notificationSchema.index({ is_read: 1, created_at: -1 });
notificationSchema.index({ module: 1 });
notificationSchema.index({ deleted_at: 1 });

const Notification =
  mongoose.models.Notifications || mongoose.model("Notifications", notificationSchema);

export default Notification;
