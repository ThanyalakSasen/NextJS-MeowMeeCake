import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    user_fullname: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
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

// email ห้ามซ้ำ แต่เฉพาะบัญชีที่ยังไม่ถูกลบ (partial unique) — BACKLOG2 §1: เดิมเป็น unique ธรรมดา
// ลบ user ทิ้ง (soft, เช่น ไล่พนักงานออก/ลบบัญชีลูกค้า) แล้วอีเมลนั้นสมัคร/สร้างใหม่ไม่ได้อีกเลย
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);

const User = mongoose.models.Users || mongoose.model("Users", userSchema);
export default User;