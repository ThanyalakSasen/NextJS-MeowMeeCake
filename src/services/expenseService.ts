/**
 * expenseService — ค่าใช้จ่ายของร้าน (Expenses)
 * CRUD ผ่าน crudService + สรุปยอดตามหมวด
 */
import dbConnect from "../lib/dbConnect";
import { badRequest } from "../lib/httpError";
import { createCrudService } from "../lib/crudService";
import expenseModel from "../models/expenseModel";
import { toSatang, toBaht, toBahtFields, round2 } from "../lib/money";
import { isUploadedUrl, UPLOAD_DIRS } from "../lib/upload";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const EXPENSE_CATEGORIES = [
  "วัตถุดิบ",
  "บรรจุภัณฑ์",
  "ค่าจ้างแรงงาน",
  "ค่าสาธารณูปโภค",
  "ค่าเช่า",
  "ค่าการตลาด",
  "ค่าซ่อมบำรุง",
  "อื่นๆ",
] as const;

// BACKLOG §3.11 เฟส 2 — amount เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
function presentExpense<T extends Record<string, unknown>>(doc: T): T {
  return toBahtFields(doc, ["amount"] as const);
}

const base = createCrudService(expenseModel as any, {
  label: "ค่าใช้จ่าย",
  searchFields: ["description", "vendor", "note"],
  createFields: [
    "date",
    "description",
    "category",
    "amount",
    "payment_method",
    "vendor",
    "note",
    "receipt_url",
    "is_recurring",
  ],
  present: presentExpense, // BACKLOG3 §8 — ครอบ list/getById/create/update/remove/restore ให้เองในตัว
});

// BACKLOG3 §8 — list/getById/remove/restore ไม่ต้อง override เองแล้ว เหลือแค่ create/update ที่ยังต้อง
// override เพราะต้องแปลง amount บาท→สตางค์ก่อนเขียน (present() แปลงแค่ตอน "คืนค่า" ไม่ใช่ตอนรับ input)
/**
 * receipt_url ต้องเป็นไฟล์ที่อัปโหลดผ่าน POST /api/admin/expenses/receipts (public/uploads/receipts — docs/uploads.md)
 * เดิมเป็นช่องพิมพ์ข้อความ → DB มีแต่ชื่อไฟล์ลอย ๆ ที่ไม่มีไฟล์จริง
 * ค่าเดิมรุ่นเก่า (ชื่อไฟล์ลอย ๆ) ยังส่งกลับมาซ้ำตอนแก้ฟิลด์อื่นได้ (`existing`) — แต่ตั้งค่าใหม่ต้องเป็นไฟล์ของระบบ
 */
function assertReceiptUrl(url: unknown, existing?: unknown): void {
  if (url === undefined || url === null || url === "") return;
  if (url === existing) return;
  if (!isUploadedUrl(url, UPLOAD_DIRS.receipts)) {
    throw badRequest("receipt_url ต้องเป็นไฟล์ที่อัปโหลดผ่าน POST /api/admin/expenses/receipts (multipart)");
  }
}

export const expenseService = {
  ...base,

  async create(input: Record<string, unknown>) {
    assertReceiptUrl(input.receipt_url);
    const payload =
      input.amount != null ? { ...input, amount: toSatang(Number(input.amount)) } : input;
    return base.create(payload);
  },

  async update(id: string, input: Record<string, unknown>) {
    if (input.receipt_url !== undefined) {
      const current = (await base.getById(id)) as { receipt_url?: unknown };
      assertReceiptUrl(input.receipt_url, current.receipt_url);
    }
    const payload =
      input.amount != null ? { ...input, amount: toSatang(Number(input.amount)) } : input;
    return base.update(id, payload);
  },
};

/** สรุปยอดค่าใช้จ่ายตามหมวด ในช่วงวันที่ */
export async function summary(opts: { date_from?: string; date_to?: string } = {}) {
  await dbConnect();
  const match: Record<string, any> = { deleted_at: null };
  if (opts.date_from || opts.date_to) {
    match.date = {};
    if (opts.date_from) match.date.$gte = new Date(opts.date_from);
    if (opts.date_to) match.date.$lte = new Date(opts.date_to);
  }

  // $sum ได้ผลรวมเป็นสตางค์ (amount เก็บเป็นสตางค์แล้ว) — แปลงเป็นบาทก่อนคืน (API ยังบาทเหมือนเดิม)
  const rows = await expenseModel.aggregate([
    { $match: match },
    { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  const totalBaht = rows.reduce((s, r) => s + toBaht(r.total), 0);
  return {
    total: round2(totalBaht),
    count: rows.reduce((s, r) => s + r.count, 0),
    by_category: rows.map((r) => ({
      category: r._id,
      total: round2(toBaht(r.total)),
      count: r.count,
    })),
  };
}

/** ยอดรวมค่าใช้จ่ายในช่วง เป็น**บาท** (ใช้จาก dashboardService — คืนบาทตรงนี้เลยกันต้องแปลงซ้ำที่ผู้เรียก) */
export async function totalInRange(dateFrom?: Date, dateTo?: Date): Promise<number> {
  await dbConnect();
  const match: Record<string, any> = { deleted_at: null };
  if (dateFrom || dateTo) {
    match.date = {};
    if (dateFrom) match.date.$gte = dateFrom;
    if (dateTo) match.date.$lte = dateTo;
  }
  const rows = await expenseModel.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return toBaht(rows[0]?.total ?? 0);
}

export function assertCategory(cat: unknown): void {
  if (cat !== undefined && !EXPENSE_CATEGORIES.includes(cat as any)) {
    throw badRequest(`category ต้องเป็นหนึ่งใน: ${EXPENSE_CATEGORIES.join(", ")}`);
  }
}
