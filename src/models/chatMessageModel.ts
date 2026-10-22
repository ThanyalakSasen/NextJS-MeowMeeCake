// chatMessageModel.ts
// ข้อความในห้องแชทร้าน–ลูกค้า (chatConversationModel) — เรียงตาม created_at · ลูกค้าไม่เห็นว่าพนักงานคนไหนตอบ
// ข้อความ = ข้อความล้วน · การ์ดคำสั่งซื้อ (ref) · หรือทั้งสองอย่าง (ต้องมีอย่างน้อยหนึ่งอย่าง — ตรวจใน chatService)
import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversations", required: true },
    sender: { type: String, enum: ["customer", "shop"], required: true },
    /** ผู้ส่งจริง — ลูกค้าเอง หรือพนักงานที่ตอบ (แสดงเฉพาะหลังร้าน) */
    sender_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    text: { type: String, default: "", trim: true, maxlength: 1000 },
    /** การ์ดคำสั่งซื้อ/พรีออเดอร์ที่แนบ — ต้องเป็นของลูกค้าเจ้าของห้อง · สถานะ/ยอดอ่านสดตอนแสดง (no = สำรองถ้าเอกสารหาย) */
    ref: {
      type: new mongoose.Schema(
        {
          kind: { type: String, enum: ["order", "preorder"], required: true },
          id: { type: mongoose.Schema.Types.ObjectId, required: true },
          no: { type: String, default: "" },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

chatMessageSchema.index({ conversation_id: 1, created_at: -1 });

// dev (hot reload): mongoose cache โมเดลไว้ข้ามการแก้ไฟล์ — ถ้ายังเป็น schema รุ่นก่อนมีการ์ดคำสั่งซื้อ (text บังคับ · ไม่มี ref)
// ข้อความที่มีแต่การ์ดจะไม่ผ่าน validation → ลบโมเดลเก่าทิ้งแล้วสร้างใหม่จาก schema นี้
if (mongoose.models.ChatMessages && !mongoose.models.ChatMessages.schema.path("ref")) {
  mongoose.deleteModel("ChatMessages");
}

const ChatMessage = mongoose.models.ChatMessages || mongoose.model("ChatMessages", chatMessageSchema);
export default ChatMessage;
