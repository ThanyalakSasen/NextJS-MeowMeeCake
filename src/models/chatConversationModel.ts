// chatConversationModel.ts — ห้องแชทลูกค้า ↔ ร้าน (collection: chatconversations)
// แทนฟอร์ม "ส่งข้อความหาเรา" — ลูกค้า 1 คน = 1 ห้อง (unique customer_id) · ข้อความอยู่ใน chatmessages
// เก็บสรุปข้อความล่าสุด + จำนวนที่ยังไม่อ่านของแต่ละฝั่งไว้ที่ห้อง — หน้ารายการห้อง/ป้ายตัวเลขไม่ต้องนับจาก chatmessages ทุกครั้ง
import mongoose from "mongoose";

const chatConversationSchema = new mongoose.Schema(
  {
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    last_message_at: { type: Date, default: null },
    /** ข้อความล่าสุดแบบย่อ (ข้อความ หรือ "[แนบคำสั่งซื้อ …]") — แสดงในรายการห้องหลังร้าน */
    last_message_preview: { type: String, default: "", maxlength: 200 },
    last_sender_type: { type: String, enum: ["customer", "staff", null], default: null },
    /** ข้อความจากร้านที่ลูกค้ายังไม่อ่าน */
    customer_unread: { type: Number, default: 0, min: 0 },
    /** ข้อความจากลูกค้าที่ร้านยังไม่อ่าน */
    staff_unread: { type: Number, default: 0, min: 0 },
    /** ร้านกด "ลบแชท" เมื่อไร (null = แสดงในรายการ) — ซ่อนจากรายการหลังร้านเท่านั้น ข้อความ/ประวัติยังอยู่ครบ
     *  ลูกค้าส่งข้อความใหม่ = กลับมาแสดง (เห็นประวัติเก่าด้วย) */
    hidden_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "chatconversations" }
);

chatConversationSchema.index({ customer_id: 1 }, { unique: true });
chatConversationSchema.index({ last_message_at: -1 });
chatConversationSchema.index({ staff_unread: 1, last_message_at: -1 });

// dev server (hot reload) เก็บ model ที่ compile ไว้ก่อนเพิ่ม field ใหม่ — schema เก่าตัด field ใหม่ทิ้งเงียบ ๆ (strict)
// เช่น "hidden_at" ไม่ถูกบันทึก → ลบ model เก่าทิ้งแล้วสร้างใหม่จาก schema ปัจจุบัน
if (mongoose.models.ChatConversations && !mongoose.models.ChatConversations.schema.path("hidden_at")) mongoose.deleteModel("ChatConversations");

const ChatConversation =
  mongoose.models.ChatConversations || mongoose.model("ChatConversations", chatConversationSchema);
export default ChatConversation;
