/**
 * expenseService — ค่าใช้จ่ายของร้าน (Expenses)
 * CRUD ผ่าน crudService + สรุปยอดตามหมวด
 */
import dbConnect from "../lib/dbConnect";
import { rangeDate } from "../lib/datetime";
import { badRequest } from "../lib/httpError";
import { createCrudService } from "../lib/crudService";
import expenseModel from "../models/expenseModel";
import { toSatang, toBaht, toBahtFields, round2 } from "../lib/money";
import { UPLOAD_DIRS } from "../lib/upload";
import { isPrivateFileUrl } from "../lib/privateFiles";

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

/** หมวดที่นับเป็นต้นทุนขาย (COGS) ใน dashboard — ตรงกับหน้าสรุปการเงินฝั่ง frontend (Final-Backlog Q1 แบบ ข.) */
export const COGS_EXPENSE_CATEGORIES: readonly string[] = ["วัตถุดิบ", "บรรจุภัณฑ์"];

// amount — เงินเก็บเป็นบาท ทศนิยม 2 ตำแหน่ง (docs/money-units.md) · presenter แค่ปัดก่อนคืน
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
// override เพราะต้องปัด amount (บาท 2 ตำแหน่ง) ก่อนเขียน (present() ทำแค่ตอน "คืนค่า" ไม่ใช่ตอนรับ input)
/**
 * receipt_url ต้องเป็นไฟล์ส่วนตัวที่อัปโหลดผ่าน POST /api/admin/expenses/receipts (`/api/files/receipts/<ไฟล์>` — docs/uploads.md §6)
 * เดิมเป็นช่องพิมพ์ข้อความ → DB มีแต่ชื่อไฟล์ลอย ๆ ที่ไม่มีไฟล์จริง
 * ค่าเดิมรุ่นเก่า (ชื่อไฟล์ลอย ๆ / `/uploads/receipts/…` ก่อนย้ายเป็นไฟล์ส่วนตัว) ยังส่งกลับมาซ้ำตอนแก้ฟิลด์อื่นได้
 * (`existing`) — แต่ตั้งค่าใหม่ต้องเป็นไฟล์ส่วนตัวของระบบ · ย้ายของเดิม: npm run migrate:upload-files
 */
function assertReceiptUrl(url: unknown, existing?: unknown): void {
  if (url === undefined || url === null || url === "") return;
  if (url === existing) return;
  if (!isPrivateFileUrl(url, UPLOAD_DIRS.receipts)) {
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
  const from = rangeDate(opts.date_from, "date_from");
  const to = rangeDate(opts.date_to, "date_to");
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = from;
    if (to) match.date.$lte = to;
  }

  // $sum ได้ผลรวมเป็นบาท — ปัด 2 ตำแหน่งก่อนคืน (กัน float สะสม)
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

/**
 * ยอดรวมค่าใช้จ่ายในช่วง เป็น**บาท** (ใช้จาก dashboardService — คืนบาทตรงนี้เลยกันต้องแปลงซ้ำที่ผู้เรียก)
 * total = ทุกหมวด · cogs = เฉพาะ COGS_EXPENSE_CATEGORIES (รวมอยู่ใน total แล้ว)
 */
export async function totalsInRange(dateFrom?: Date, dateTo?: Date): Promise<{ total: number; cogs: number }> {
  await dbConnect();
  const match: Record<string, any> = { deleted_at: null };
  if (dateFrom || dateTo) {
    match.date = {};
    if (dateFrom) match.date.$gte = dateFrom;
    if (dateTo) match.date.$lte = dateTo;
  }
  const rows = await expenseModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
        cogs: { $sum: { $cond: [{ $in: ["$category", COGS_EXPENSE_CATEGORIES] }, "$amount", 0] } },
      },
    },
  ]);
  return { total: toBaht(rows[0]?.total ?? 0), cogs: toBaht(rows[0]?.cogs ?? 0) };
}

export function assertCategory(cat: unknown): void {
  if (cat !== undefined && !EXPENSE_CATEGORIES.includes(cat as any)) {
    throw badRequest(`category ต้องเป็นหนึ่งใน: ${EXPENSE_CATEGORIES.join(", ")}`);
  }
}
