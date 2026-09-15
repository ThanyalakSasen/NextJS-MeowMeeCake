/**
 * schemas/attendance — validation ของ /api/admin/attendances
 * status ใช้ค่าภาษาไทยตรง ๆ (ตรงกับ attendanceService.ATTENDANCE_STATUSES) ไม่ใช่ enum อังกฤษ
 */
import { z } from "zod";
import { objectId } from "./common";

const attendanceStatus = z.enum(["มาทำงาน", "มาสาย", "ขาดงาน", "ลาป่วย", "ลากิจ", "วันหยุด"]);

/** POST /api/admin/attendances — บันทึกแทน (recorded_by inject จาก session ที่ route เสมอ ไม่อยู่ใน schema นี้) */
export const recordAttendanceBody = z.object({
  user_id: objectId,
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'work_date ต้องเป็นรูปแบบ "YYYY-MM-DD"'),
  status: attendanceStatus.optional(),
  // .optional() ไม่ใช่ .nullish() — recordAttendance() รับ note?: string (ไม่รับ null)
  note: z.string().max(1000).optional(),
  check_in_at: z.coerce.date().nullish(),
  check_out_at: z.coerce.date().nullish(),
});
export type RecordAttendanceBody = z.infer<typeof recordAttendanceBody>;

/** PATCH /api/admin/attendances/[id] — แก้ field ที่มีอยู่บางส่วน · recorded_by แก้ได้ตรง ๆ
 *  ที่นี่ (ต่างจาก POST) เพราะแอดมินอาจต้องแก้ว่า "ใครเป็นคนบันทึกรายการนี้" ย้อนหลัง (พฤติกรรมเดิม) */
export const updateAttendanceBody = z.object({
  status: attendanceStatus.optional(),
  note: z.string().max(1000).nullish(),
  check_in_at: z.coerce.date().nullish(),
  check_out_at: z.coerce.date().nullish(),
  recorded_by: objectId.optional(),
});
export type UpdateAttendanceBody = z.infer<typeof updateAttendanceBody>;

/** POST /api/admin/attendances/check-in | check-out — เช็คอิน/เอาท์ให้ตัวเอง (ไม่ส่ง user_id)
 *  หรือแทนคนอื่นถ้ามีสิทธิ์ employees.create (route เช็คสิทธิ์เอง ไม่ใช่หน้าที่ schema นี้) */
export const checkInOutBody = z.object({
  user_id: objectId.optional(),
});
export type CheckInOutBody = z.infer<typeof checkInOutBody>;
