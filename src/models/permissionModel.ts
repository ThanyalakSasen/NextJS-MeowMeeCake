import mongoose from "mongoose";

const permissionSchema = new mongoose.Schema({
  role_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Roles",
    // ✅ ลบ required: true ออก เพราะ permission อาจ assign ให้ user โดยตรงโดยไม่มี role
    default: null,
  },

  menu_key: {
    type: String,
    required: true,
    enum: [
      "orders",
      "payments",
      "products",
      "ingredients",
      "stock",
      "recipes", 
      "production",
      "employees",
      "dashboard",
      "promotions",
      "reports",
    ],
  },
  // + เพิ่ม expires_at สำหรับสิทธิ์ชั่วคราว
  expires_at: {
    type: Date,
    default: null,
  },
  can_view: {
    type: Boolean,
    default: false,
  },
  can_create: {
    type: Boolean,
    default: false,
  },
  can_update: {
    type: Boolean,
    default: false,
  },
  can_delete: {
    type: Boolean,
    default: false,
  },
  can_approve: {
    type: Boolean,
    default: false,
  },
  granted_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
    required: true,
  },
  // soft delete — null = ยังใช้งานอยู่, มีค่า = ถูกลบเมื่อวันเวลานั้น
  deleted_at: {
    type: Date,
    default: null,
  },
}
,
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// Compound Index: role_id + menu_key ต้องไม่ซ้ำกัน — แต่บังคับ unique เฉพาะรายการที่ยังไม่ถูกลบ
// (partial index) เพื่อให้ soft delete แล้วสร้างสิทธิ์คู่เดิมใหม่ได้
// หมายเหตุ: DB เคยมี index เก่าชื่อ user_id_1_menu_key_1 และ role_id_1_menu_key_1 (แบบ sparse)
// ถ้าเคยรันสคีมาเวอร์ชันก่อนหน้า ต้อง drop index เก่าออกก่อน index ใหม่นี้จึงจะถูกสร้าง
permissionSchema.index(
  { role_id: 1, menu_key: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);

// pre-save hook: ตรวจสอบ role_id และอัปเดต updated_at
permissionSchema.pre("save", function () {
  if (!this.role_id) {
    throw new Error("Permission ต้องมี role_id อย่างน้อยหนึ่งอัน");
  }
  if (!this.isNew) {
    this.updated_at = new Date();
  }
});

const PermissionModel = mongoose.models.Permissions || mongoose.model("Permissions", permissionSchema);

export default PermissionModel;
