/**
 * expenseService — ค่าใช้จ่ายของร้าน (Expenses)
 * CRUD ผ่าน crudService + สรุปยอดตามหมวด
 */
import dbConnect from "../lib/dbConnect";
import { badRequest } from "../lib/httpError";
import { createCrudService } from "../lib/crudService";
import expenseModel from "../models/expenseModel";
import { toSatang, toBaht, toBahtFields } from "../lib/money";

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
});

// BACKLOG §3.11 เฟส 2 — amount เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
function presentExpense<T extends Record<string, unknown>>(doc: T): T {
  return toBahtFields(doc, ["amount"] as const);
}

export const expenseService = {
  ...base,

  async list(args: Parameters<typeof base.list>[0]) {
    const result = await base.list(args);
    return { ...result, items: result.items.map(presentExpense) };
  },

  async getById(id: string, includeDeleted?: boolean) {
    return presentExpense(await base.getById(id, includeDeleted));
  },

  async create(input: Record<string, unknown>) {
    const payload =
      input.amount != null ? { ...input, amount: toSatang(Number(input.amount)) } : input;
    return presentExpense(await base.create(payload));
  },

  async update(id: string, input: Record<string, unknown>) {
    const payload =
      input.amount != null ? { ...input, amount: toSatang(Number(input.amount)) } : input;
    return presentExpense(await base.update(id, payload));
  },

  async remove(id: string) {
    return presentExpense(await base.remove(id));
  },

  async restore(id: string) {
    return presentExpense(await base.restore(id));
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
    total: Math.round(totalBaht * 100) / 100,
    count: rows.reduce((s, r) => s + r.count, 0),
    by_category: rows.map((r) => ({
      category: r._id,
      total: Math.round(toBaht(r.total) * 100) / 100,
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
