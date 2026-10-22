// chatConversationModel.ts
// ห้องแชทระหว่างร้านกับลูกค้า — ลูกค้า 1 คน = 1 ห้อง (แทนฟอร์ม "ส่งข้อความหาเรา" เดิม)
// เก็บสรุปข้อความล่าสุด + จำนวนที่ยังไม่อ่านของแต่ละฝั่ง ไว้ทำรายการห้องหลังร้าน/จุดแดงฝั่งลูกค้า โดยไม่ต้องนับจากข้อความทุกครั้ง
import mongoose from "mongoose";

const chatConversationSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    last_message_at: { type: Date, default: null },
    /** ข้อความล่าสุดแบบย่อ (แสดงในรายการห้อง) */
    last_message_text: { type: String, default: "", maxlength: 200 },
    /** ใครส่งข้อความล่าสุด — "customer" = ยังรอร้านตอบ */
    last_sender: { type: String, enum: ["customer", "shop", null], default: null },
    /** ข้อความจากลูกค้าที่ร้านยังไม่เปิดอ่าน */
    unread_shop: { type: Number, default: 0, min: 0 },
    /** ข้อความจากร้านที่ลูกค้ายังไม่เปิดอ่าน */
    unread_customer: { type: Number, default: 0, min: 0 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

chatConversationSchema.index({ user_id: 1 }, { unique: true });
chatConversationSchema.index({ last_message_at: -1 });
chatConversationSchema.index({ last_sender: 1, last_message_at: -1 });

const ChatConversation =
  mongoose.models.ChatConversations || mongoose.model("ChatConversations", chatConversationSchema);
export default ChatConversation;
