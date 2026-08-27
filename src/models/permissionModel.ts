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
}
,
  {
    timestamps: { deletedAt: "deleted_at", createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// Compound Index: role_id + menu_key ต้องไม่ซ้ำกัน (แทน unique บน role_id เพียงฟิลด์เดียว)
// หมายเหตุ: DB เคยมี index เก่าชื่อ user_id_1_menu_key_1 หลงเหลือจากตอนที่ schema นี้ยังผูกกับ
// user_id แทน role_id — index นั้นทำให้สร้าง permission ซ้ำ menu_key ข้ามกัน role ไม่ได้เลย (ลบไปแล้ว)
permissionSchema.index(
  { role_id: 1, menu_key: 1 },
  { unique: true, sparse: true },
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
