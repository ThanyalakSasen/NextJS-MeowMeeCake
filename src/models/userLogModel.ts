import mongoose from "mongoose";

const userLogSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
    required: true,
  },
  action: {
    type: String,
    required: true,
  },
  action_type: {
    type: String,
    required: true,
    enum: ["CREATE", "READ", "UPDATE", "DELETE", "OTHER"], //ตัวอย่างประเภทของการกระทำที่บันทึก
  },
  entity: {
    //ระบุประเภทของข้อมูลที่ถูกกระทำ เช่น "User", "Order", "Product" เป็นต้น
    type: String,
    required: false,
  },
  entity_id: {
    //รหัสของ document ที่ถูกกระทำ เพื่อให้สามารถ trace กลับไปดูข้อมูลเดิมได้
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },

  ip_address: {
    //IP address ของผู้ใช้ที่กระทำ สำหรับ security audit
    type: String,
    default: null,
  },

  details: {
    type: mongoose.Schema.Types.Mixed, //สามารถเก็บข้อมูลเพิ่มเติมเกี่ยวกับการกระทำ เช่น IP address, device info, หรือข้อมูลอื่นๆ ที่เกี่ยวข้อง
    required: false,
  },
  before:{
    type: mongoose.Schema.Types.Mixed, //เก็บข้อมูลก่อนการกระทำ (ถ้ามี) เช่น ข้อมูลเดิมของ document ก่อนถูกแก้ไข
    required: false,
  },
  after:{
    type: mongoose.Schema.Types.Mixed, //เก็บข้อมูลหลังการกระทำ (ถ้ามี) เช่น ข้อมูลใหม่ของ document หลังถูกแก้ไข
    required: false,
  },
},
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  });

userLogSchema.index({ user_id: 1 });
userLogSchema.index({ entity: 1, entity_id: 1 });
userLogSchema.index({ action_type: 1 });
userLogSchema.index({ created_at: -1 });

const UserLogModel = mongoose.models.UserLogs || mongoose.model("UserLogs", userLogSchema);

export default UserLogModel;
