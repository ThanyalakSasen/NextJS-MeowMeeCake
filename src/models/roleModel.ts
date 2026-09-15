import mongoose from "mongoose";

const roleSchema = new mongoose.Schema({
  role_name: {
    type: String,
    required: true,
  },
  role_type: {
    type: String,
    required: true,
    enum: ["owner", "staff", "customer"],
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  deleted_at: {
      type: Date,
      default: null,
    },
},
  {
    timestamps: {  createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// role_name ห้ามซ้ำ แต่เฉพาะ role ที่ยังไม่ถูกลบ (partial unique) — BACKLOG2 §1: เดิมเป็น unique
// ธรรมดา ลบ role ทิ้งแล้วสร้างชื่อเดิมใหม่ไม่ได้อีกเลย (เหมือนบั๊กที่แก้ไปแล้วใน unitModel)
roleSchema.index(
  { role_name: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

const RoleModel = mongoose.models.Roles || mongoose.model("Roles", roleSchema);

export default RoleModel;
