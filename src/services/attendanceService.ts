/**
 * attendanceService — บันทึกเวลาเข้า-ออกงานของพนักงาน (Attendances)
 * 1 เอกสาร ต่อ 1 คน ต่อ 1 วันทำงาน (work_date รูปแบบ "YYYY-MM-DD" ตามเวลาไทย)
 *
 * 2 ช่องทาง:
 *  - พนักงานเช็คอิน/เช็คเอาท์เอง  → checkIn(userId) / checkOut(userId)  (เฉพาะ "วันนี้")
 *  - เจ้าของร้าน/แอดมินบันทึกแทน  → recordAttendance() / updateAttendance()  (วันไหนก็ได้)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId, pick } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, type Pagination } from "../lib/queryParams";
import { bangkokDateString, isWorkDateString } from "../lib/datetime";
import attendanceModel from "../models/attendanceModel";
import userModel from "../models/userModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ATTENDANCE_STATUSES = [
  "มาทำงาน",
  "มาสาย",
  "ขาดงาน",
  "ลาป่วย",
  "ลากิจ",
  "วันหยุด",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface ListAttendanceQuery {
  pagination: Pagination;
  user_id?: string;
  work_date?: string;
  date_from?: string;
  date_to?: string;
  status?: AttendanceStatus;
  includeDeleted?: boolean;
}

function assertTimeOrder(inAt?: Date | null, outAt?: Date | null): void {
  if (inAt && outAt && outAt.getTime() < inAt.getTime()) {
    throw badRequest("เวลาออกงานต้องไม่ก่อนเวลาเข้างาน");
  }
}

function assertStatus(status: unknown): void {
  if (status !== undefined && !ATTENDANCE_STATUSES.includes(status as AttendanceStatus)) {
    throw badRequest(`status ต้องเป็นหนึ่งใน: ${ATTENDANCE_STATUSES.join(", ")}`);
  }
}

// ── READ (list) ──────────────────────────────────────────────
export async function listAttendances(query: ListAttendanceQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (query.user_id) {
    assertObjectId(query.user_id, "user_id");
    filter.user_id = query.user_id;
  }
  if (query.status) filter.status = query.status;

  if (query.work_date) {
    if (!isWorkDateString(query.work_date)) throw badRequest('work_date ต้องเป็นรูปแบบ "YYYY-MM-DD"');
    filter.work_date = query.work_date;
  } else if (query.date_from || query.date_to) {
    // work_date เก็บเป็น string "YYYY-MM-DD" เทียบช่วงด้วย $gte/$lte แบบ lexicographic ได้เลย
    filter.work_date = {};
    if (query.date_from) {
      if (!isWorkDateString(query.date_from)) throw badRequest('date_from ต้องเป็นรูปแบบ "YYYY-MM-DD"');
      filter.work_date.$gte = query.date_from;
    }
    if (query.date_to) {
      if (!isWorkDateString(query.date_to)) throw badRequest('date_to ต้องเป็นรูปแบบ "YYYY-MM-DD"');
      filter.work_date.$lte = query.date_to;
    }
  }

  const [items, total] = await Promise.all([
    attendanceModel
      .find(filter)
      .sort({ work_date: -1, check_in_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("user_id", "user_fullname email employment_type")
      .populate("recorded_by", "user_fullname email")
      .lean(),
    attendanceModel.countDocuments(filter),
  ]);

  return { items, meta: buildMeta(total, query.pagination) };
}

export async function getAttendanceById(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await attendanceModel
    .findOne({ _id: id, deleted_at: null })
    .populate("user_id", "user_fullname email employment_type")
    .populate("recorded_by", "user_fullname email")
    .lean();
  if (!doc) throw notFound("ไม่พบบันทึกเวลาที่ระบุ");
  return doc;
}

// ── พนักงานเช็คอินเอง (เฉพาะวันนี้) ──────────────────────────
export async function checkIn(
  userId: string,
  opts: { at?: Date; recordedBy?: string } = {}
) {
  await dbConnect();
  await assertRefExists(userModel, userId, "พนักงาน", "user_id");

  const at = opts.at ?? new Date();
  const work_date = bangkokDateString(at);

  const existing = await attendanceModel.findOne({
    user_id: userId,
    work_date,
    deleted_at: null,
  });

  if (existing?.check_in_at) {
    throw conflict("วันนี้เช็คอินไปแล้ว");
  }

  if (existing) {
    existing.check_in_at = at;
    if (opts.recordedBy) existing.recorded_by = opts.recordedBy as any;
    await existing.save();
    return existing.toObject();
  }

  const doc = await attendanceModel.create({
    user_id: userId,
    work_date,
    check_in_at: at,
    status: "มาทำงาน",
    recorded_by: opts.recordedBy ?? userId,
  });
  return doc.toObject();
}

// ── พนักงานเช็คเอาท์เอง (เฉพาะวันนี้) ────────────────────────
export async function checkOut(userId: string, opts: { at?: Date } = {}) {
  await dbConnect();
  assertObjectId(userId, "user_id");

  const at = opts.at ?? new Date();
  const work_date = bangkokDateString(at);

  const doc = await attendanceModel.findOne({
    user_id: userId,
    work_date,
    deleted_at: null,
  });

  if (!doc || !doc.check_in_at) throw badRequest("ยังไม่ได้เช็คอินของวันนี้");
  if (doc.check_out_at) throw conflict("วันนี้เช็คเอาท์ไปแล้ว");

  assertTimeOrder(doc.check_in_at, at);
  doc.check_out_at = at;
  await doc.save();
  return doc.toObject();
}

// ── แอดมิน/เจ้าของร้านบันทึกแทน (สร้างใหม่หรือทับของเดิมในวันนั้น) ──
export interface RecordAttendanceInput {
  user_id: string;
  work_date: string;
  recorded_by: string;
  status?: AttendanceStatus;
  note?: string;
  check_in_at?: string | Date | null;
  check_out_at?: string | Date | null;
}

export async function recordAttendance(input: RecordAttendanceInput) {
  await dbConnect();

  if (!input.user_id) throw badRequest("กรุณาระบุ user_id");
  if (!isWorkDateString(input.work_date)) throw badRequest('work_date ต้องเป็นรูปแบบ "YYYY-MM-DD"');
  if (!input.recorded_by) throw badRequest("กรุณาระบุ recorded_by");
  assertStatus(input.status);

  await assertRefExists(userModel, input.user_id, "พนักงาน", "user_id");
  await assertRefExists(userModel, input.recorded_by, "ผู้บันทึก", "recorded_by");

  const inAt = input.check_in_at != null ? new Date(input.check_in_at) : undefined;
  const outAt = input.check_out_at != null ? new Date(input.check_out_at) : undefined;
  assertTimeOrder(inAt, outAt);

  const set: Record<string, any> = { recorded_by: input.recorded_by };
  if (input.status !== undefined) set.status = input.status;
  if (input.note !== undefined) set.note = input.note;
  if (input.check_in_at !== undefined) set.check_in_at = inAt ?? null;
  if (input.check_out_at !== undefined) set.check_out_at = outAt ?? null;

  const doc = await attendanceModel
    .findOneAndUpdate(
      { user_id: input.user_id, work_date: input.work_date, deleted_at: null },
      { $set: set, $setOnInsert: { user_id: input.user_id, work_date: input.work_date } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    )
    .lean();
  return doc;
}

// ── แอดมินแก้ไขบันทึกที่มีอยู่ ───────────────────────────────
export async function updateAttendance(id: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(id);
  assertStatus(input.status);

  const existing = await attendanceModel.findOne({ _id: id, deleted_at: null });
  if (!existing) throw notFound("ไม่พบบันทึกเวลาที่ระบุ");

  const payload = pick(input, [
    "status",
    "note",
    "check_in_at",
    "check_out_at",
    "recorded_by",
  ]);

  const nextIn =
    payload.check_in_at !== undefined
      ? payload.check_in_at
        ? new Date(payload.check_in_at as any)
        : null
      : existing.check_in_at;
  const nextOut =
    payload.check_out_at !== undefined
      ? payload.check_out_at
        ? new Date(payload.check_out_at as any)
        : null
      : existing.check_out_at;
  assertTimeOrder(nextIn, nextOut);

  const doc = await attendanceModel
    .findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true })
    .lean();
  return doc;
}

// ── DELETE (soft) ───────────────────────────────────────────
export async function deleteAttendance(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await attendanceModel
    .findOneAndUpdate(
      { _id: id, deleted_at: null },
      { $set: { deleted_at: new Date() } },
      { new: true }
    )
    .lean();
  if (!doc) throw notFound("ไม่พบบันทึกเวลาที่ระบุ หรือถูกลบไปแล้ว");
  return doc;
}
