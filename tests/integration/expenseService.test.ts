import { describe, it, expect } from "vitest";
import expenseModel from "@/models/expenseModel";
import { expenseService, summary, totalInRange } from "@/services/expenseService";

/**
 * BACKLOG §3.11 เฟส 2 — expenseModel.amount เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาทเหมือนเดิม
 * (รูปแบบเดียวกับเฟส 1 — ดู docs/hardening-5-money-phase1.md)
 */
describe("expenseService — create/update/list/getById คืนบาท เก็บสตางค์", () => {
  it("create: รับ amount เป็นบาท เก็บลง DB เป็นสตางค์ คืนกลับเป็นบาท", async () => {
    const doc = await expenseService.create({
      date: new Date("2026-01-10"),
      description: "ซื้อแป้ง",
      category: "วัตถุดิบ",
      amount: 199.5,
      payment_method: "เงินสด",
    });

    expect(doc.amount).toBe(199.5); // ค่าที่ presentExpense แปลงกลับให้

    const raw = await expenseModel.findById((doc as { _id: unknown })._id).lean<{ amount: number }>();
    expect(raw!.amount).toBe(19950); // เก็บจริงเป็นสตางค์
  });

  it("update: amount ใหม่แปลงเป็นสตางค์ถูกต้อง, ไม่แตะฟิลด์อื่นที่ไม่ได้ส่งมา", async () => {
    const doc = await expenseService.create({
      date: new Date("2026-01-10"),
      description: "ค่าเช่า",
      category: "ค่าเช่า",
      amount: 5000,
      payment_method: "โอนเงิน",
    });

    const updated = await expenseService.update((doc as { _id: unknown })._id as string, {
      amount: 5500,
    });
    expect(updated.amount).toBe(5500);

    const raw = await expenseModel
      .findById((doc as { _id: unknown })._id)
      .lean<{ amount: number; description: string }>();
    expect(raw!.amount).toBe(550000);
    expect(raw!.description).toBe("ค่าเช่า"); // ไม่ถูกแตะ
  });

  it("list/getById คืนค่าเป็นบาทเสมอ", async () => {
    const created = await expenseService.create({
      date: new Date("2026-01-10"),
      description: "ค่าไฟ",
      category: "ค่าสาธารณูปโภค",
      amount: 1234.56,
      payment_method: "QR Code",
    });

    const byId = await expenseService.getById((created as { _id: unknown })._id as string);
    expect(byId.amount).toBe(1234.56);

    const list = await expenseService.list({ pagination: { page: 1, limit: 10, skip: 0 } });
    const found = list.items.find(
      (it) => String((it as { _id: unknown })._id) === String((created as { _id: unknown })._id)
    );
    expect((found as { amount: number } | undefined)?.amount).toBe(1234.56);
  });
});

describe("expenseService.summary / totalInRange — คืนบาท (BACKLOG §3.11 เฟส 2)", () => {
  it("summary(): รวมยอดตามหมวดเป็นบาทถูกต้อง ไม่ใช่สตางค์ดิบ", async () => {
    await expenseService.create({
      date: new Date("2026-02-01"),
      description: "แป้ง",
      category: "วัตถุดิบ",
      amount: 100,
      payment_method: "เงินสด",
    });
    await expenseService.create({
      date: new Date("2026-02-02"),
      description: "น้ำตาล",
      category: "วัตถุดิบ",
      amount: 50.5,
      payment_method: "เงินสด",
    });
    await expenseService.create({
      date: new Date("2026-02-03"),
      description: "ค่าไฟ",
      category: "ค่าสาธารณูปโภค",
      amount: 300,
      payment_method: "โอนเงิน",
    });

    const result = await summary({ date_from: "2026-02-01", date_to: "2026-02-28" });
    expect(result.total).toBe(450.5);
    expect(result.count).toBe(3);

    const rawMat = result.by_category.find((c) => c.category === "วัตถุดิบ");
    expect(rawMat?.total).toBe(150.5);
  });

  it("totalInRange(): คืนบาทตรง ๆ ให้ dashboardService ใช้ผสมกับค่าอื่นได้เลยไม่ต้องแปลงซ้ำ", async () => {
    await expenseService.create({
      date: new Date("2026-03-01"),
      description: "ค่าจ้าง",
      category: "ค่าจ้างแรงงาน",
      amount: 15000,
      payment_method: "โอนเงิน",
    });

    const total = await totalInRange(new Date("2026-03-01"), new Date("2026-03-31"));
    expect(total).toBe(15000);
  });
});
