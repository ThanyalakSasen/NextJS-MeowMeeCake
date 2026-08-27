import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    user_fullname: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, default: null },
    googleId: { type: String, default: null },
    auth_provider: { type: String, enum: ["local", "google"], required: true },
    role_id: { type: mongoose.Schema.Types.ObjectId, ref: "Roles", required: true },
    user_birthdate: { type: Date, default: null },
    user_phone: { type: String, default: null },
    user_img: { type: String, default: null },
    user_allergies: { type: [String], default: [] },
    email_verify_token: { type: String, default: null },
    is_email_verified: { type: Boolean, default: false },
    verification_token_expiry: { type: Date, default: null },
    start_working_date: { type: Date, default: null },
    last_working_date: { type: Date, default: null },
    employment_type: { type: String, enum: ["full_time", "part_time"], default: null },
    emp_salary: { type: Number, default: null },
    part_time_hours: { type: Number, default: null },
    emp_status: { type: Boolean, default: null },
    failed_login_attempts: { type: Number, default: 0 },
    lockout_until: { type: Date, default: null },
    is_active: { type: Boolean, default: true },
    reset_password_token: { type: String, default: null },
    reset_password_token_expiry: { type: Date, default: null },
    last_login_at: { type: Date, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

userSchema.index({ email: 1 });
userSchema.index({ role_id: 1 });
userSchema.index({ deleted_at: 1 });

// เข้ารหัส password อัตโนมัติทุกครั้งที่ set ค่าใหม่ (สร้าง user ใหม่ หรือเปลี่ยนรหัสผ่าน) — ผู้ใช้เก่าที่ยัง
// เก็บเป็น plaintext (ก่อนมี hook นี้) จะถูกอัปเกรดเป็น hash อัตโนมัติตอน login ครั้งแรกที่ผ่าน (ดู auth/login route)
// หมายเหตุ: Mongoose เวอร์ชันนี้ใช้ hook แบบ async/Promise ล้วน ไม่มี callback `next` แล้ว
// (คืนค่า/resolve ปกติ = ผ่าน, throw = ยกเลิก) ต่างจาก Mongoose รุ่นเก่าที่คุ้นเคย
// อีกอย่าง: การใส่ custom `timestamps.createdAt/updatedAt` (ด้านล่าง) ทำให้ mongoose auto-infer
// ประเภท field ผิดเพี้ยนไป (this.password ดันถูกอนุมานเป็น Date) จึงต้อง cast ตรงๆ กันไว้
userSchema.pre("save", async function () {
  const pw = this.password as unknown as string | null;
  if (!this.isModified("password") || !pw) return;
  if (/^\$2[aby]\$/.test(pw)) return; // เป็น bcrypt hash อยู่แล้ว ไม่ต้อง hash ซ้ำ
  this.password = (await bcrypt.hash(pw, 10)) as unknown as typeof this.password;
});

// createCrudController.update() ใช้ findByIdAndUpdate ซึ่งไม่ผ่าน pre("save") ข้างบน — ต้องมี hook
// แยกสำหรับ query-style update ด้วย (เช่นตอนแก้ไขพนักงานแล้วตั้งรหัสผ่านใหม่จากหน้า editEmployee)
userSchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate() as Record<string, unknown> | null;
  if (!update) return;
  const target = "$set" in update ? (update.$set as Record<string, unknown>) : update;
  const pw = target?.password;
  if (typeof pw !== "string" || !pw || /^\$2[aby]\$/.test(pw)) return;
  target.password = await bcrypt.hash(pw, 10);
});

const User = mongoose.models.Users || mongoose.model("Users", userSchema);
export default User;