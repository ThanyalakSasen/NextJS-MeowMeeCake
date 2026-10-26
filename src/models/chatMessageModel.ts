// chatMessageModel.ts — ข้อความในห้องแชท (collection: chatmessages)
// 1 ข้อความ = ข้อความตัวอักษร และ/หรือ แนบคำสั่งซื้อ/พรีออเดอร์ 1 รายการ (attachment)
// attachment เก็บ "ภาพ ณ ตอนส่ง" (เลขที่ · ยอด · จำนวนชิ้น · ชื่อสินค้าแรก) — ห้องแชทแสดงได้เลยไม่ต้อง join
// สถานะล่าสุดให้กดลิงก์ไปดูหน้าคำสั่งซื้อ (ref_id)
import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["order", "preorder"], required: true },
    ref_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    doc_no: { type: String, required: true },
    order_status: { type: String, default: null },
    payment_status: { type: String, default: null },
    order_type: { type: String, default: null },
    total_amount: { type: Number, default: 0 },
    item_count: { type: Number, default: 0 },
    first_item_name: { type: String, default: "" },
    ordered_at: { type: Date, default: null },
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversations", required: true },
    sender_type: { type: String, enum: ["customer", "staff"], required: true },
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    body: { type: String, default: "", maxlength: 1000 },
    attachment: { type: attachmentSchema, default: null },
    /** อีกฝั่งเปิดอ่านแล้วเมื่อไร (null = ยังไม่อ่าน) */
    read_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "chatmessages" }
);

chatMessageSchema.index({ conversation_id: 1, created_at: -1 });
chatMessageSchema.index({ conversation_id: 1, sender_type: 1, read_at: 1 });

const ChatMessage = mongoose.models.ChatMessages || mongoose.model("ChatMessages", chatMessageSchema);
export default ChatMessage;
