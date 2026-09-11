/**
 * expenseService — ค่าใช้จ่ายของร้าน (Expenses)
 * CRUD ผ่าน crudService + สรุปยอดตามหมวด
 */
import dbConnect from "../lib/dbConnect";
import { badRequest } from "../lib/httpError";
import { createCrudService } from "../lib/crudService";
import expenseModel from "../models/expenseModel";

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

export const expenseService = createCrudService(expenseModel as any, {
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
});

/** สรุปยอดค่าใช้จ่ายตามหมวด ในช่วงวันที่ */
export async function summary(opts: { date_from?: string; date_to?: string } = {}) {
  await dbConnect();
  const match: Record<string, any> = { deleted_at: null };
  if (opts.date_from || opts.date_to) {
    match.date = {};
    if (opts.date_from) match.date.$gte = new Date(opts.date_from);
    if (opts.date_to) match.date.$lte = new Date(opts.date_to);
  }

  const rows = await expenseModel.aggregate([
    { $match: match },
    { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  const total = rows.reduce((s, r) => s + r.total, 0);
  return {
    total: Math.round(total * 100) / 100,
    count: rows.reduce((s, r) => s + r.count, 0),
    by_category: rows.map((r) => ({ category: r._id, total: r.total, count: r.count })),
  };
}

/** ยอดรวมค่าใช้จ่ายในช่วง (ใช้จาก dashboard) */
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
  return rows[0]?.total ?? 0;
}

export function assertCategory(cat: unknown): void {
  if (cat !== undefined && !EXPENSE_CATEGORIES.includes(cat as any)) {
    throw badRequest(`category ต้องเป็นหนึ่งใน: ${EXPENSE_CATEGORIES.join(", ")}`);
  }
}
