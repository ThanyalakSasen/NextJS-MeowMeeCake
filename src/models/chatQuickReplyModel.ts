// chatQuickReplyModel.ts
// ข้อความตอบเร็วสำเร็จรูปของหน้าแชทหลังร้าน (ใช้ร่วมกันทั้งร้าน) — กดแล้วเติมลงช่องตอบ แก้ก่อนส่งได้
import mongoose from "mongoose";

const chatQuickReplySchema = new mongoose.Schema(
  {
    /** ชื่อสั้น ๆ ที่แสดงในรายการ เช่น "ทักทาย" · ว่าง = ใช้ต้นข้อความแทน */
    title: { type: String, default: "", trim: true, maxlength: 50 },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    sort_order: { type: Number, default: 0 },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

chatQuickReplySchema.index({ sort_order: 1, created_at: 1 });

const ChatQuickReply = mongoose.models.ChatQuickReplies || mongoose.model("ChatQuickReplies", chatQuickReplySchema);
export default ChatQuickReply;
