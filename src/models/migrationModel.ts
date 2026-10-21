import mongoose from "mongoose";

/**
 * Migrations — บันทึกว่างานย้ายข้อมูลที่รันเองตอนใช้งาน (ไม่ใช่สคริปต์ที่ต้องสั่งมือ) ทำไปแล้ว
 * 1 เอกสาร = 1 งาน (`_id` = ชื่องาน เช่น "submenu-permissions-v1") — มีเอกสาร = ไม่ต้องรันซ้ำ
 * ใช้กับงานที่รันซ้ำแล้วผิด เช่นคัดลอกสิทธิ์ให้หน้าย่อย (รันซ้ำหลังเจ้าของร้านลบสิทธิ์หน้าย่อยออก = สิทธิ์กลับมาเอง)
 */
const migrationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    done_at: { type: Date, default: () => new Date() },
    detail: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { versionKey: false }
);

const MigrationModel = mongoose.models.Migrations || mongoose.model("Migrations", migrationSchema);

export default MigrationModel;
