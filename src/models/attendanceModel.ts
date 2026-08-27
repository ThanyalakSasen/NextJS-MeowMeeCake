import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// src/models/attendanceModel.ts
// บันทึกเวลาเข้า-ออกงานของพนักงานในแต่ละวัน — 1 เอกสาร ต่อ 1 คน ต่อ 1 วันทำงาน (work_date)
// สร้างได้ 2 ทาง: พนักงานเช็คอิน/เช็คเอาท์เองผ่าน /api/attendances/check-in|check-out (เฉพาะ "วันนี้"
// ของตัวเอง) หรือเจ้าของร้าน/แอดมินบันทึก/แก้ไขย้อนหลังแทนผ่านหน้า /owner/employees/attendance
// (ดู src/controllers/attendanceController.ts)
// ─────────────────────────────────────────────────────────────

const attendanceSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },
    // วันทำงานตามเวลาไทย รูปแบบ "YYYY-MM-DD" — เก็บเป็น string (ไม่ใช่ Date) เพื่อเลี่ยงปัญหา
    // timezone ตอนเทียบ/ค้นหา "วันนี้" และใช้เป็นคีย์คู่กับ user_id ระบุว่าเป็นวันเดียวกันหรือไม่
    work_date: {
      type: String,
      required: true,
    },
    check_in_at: {
      type: Date,
      default: null,
    },
    check_out_at: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["มาทำงาน", "มาสาย", "ขาดงาน", "ลาป่วย", "ลากิจ", "วันหยุด"],
      default: "มาทำงาน",
    },
    note: {
      type: String,
      default: "",
    },
    // ใครเป็นคนบันทึกรายการนี้ — เจ้าของตัวเอง (เช็คอินเอง) หรือเจ้าของร้าน/แอดมิน (บันทึกแทน)
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

attendanceSchema.index({ user_id: 1, work_date: 1 });
attendanceSchema.index({ work_date: -1 });
attendanceSchema.index({ deleted_at: 1 });

const Attendance =
  mongoose.models.Attendances || mongoose.model("Attendances", attendanceSchema);

export default Attendance;
