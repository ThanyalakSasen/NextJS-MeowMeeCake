import { describe, it, expect } from "vitest";
import ingredientModel from "@/models/ingredientModel";
import ingredientTransactionModel from "@/models/ingredientTransactionModel";
import expenseModel from "@/models/expenseModel";
import { createPurchase, linkStockItems, listStockItems, unlinkStockItem } from "@/services/purchaseService";
import { expenseService } from "@/services/expenseService";
import { createTransaction, voidTransaction } from "@/services/ingredientTransactionService";
import { makeIngredient, makeUser, oid } from "./helpers";

const stockOf = async (id: unknown) => (await ingredientModel.findById(id).lean<{ current_stock: number }>())!.current_stock;

const base = { date: new Date("2026-10-30"), category: "วัตถุดิบ" as const, payment_method: "เงินสด" as const };

/** บันทึกการซื้อ = รับเข้าสต็อก + ค่าใช้จ่าย 1 ใบ ผูกถึงกัน (ผู้ใช้ขอ 2026-10-31) */
describe("purchaseService.createPurchase", () => {
  it("รับเข้าสต็อกทุกรายการ + ค่าใช้จ่ายยอด = ผลรวม + ผูก expense_id/line_total", async () => {
    const user = await makeUser();
    const flour = await makeIngredient({ current_stock: 5 });
    const butter = await makeIngredient({ current_stock: 0 });

    const res = await createPurchase(
      { ...base, vendor: "แม็คโคร", po_ref: "INV-001", items: [
        { ingredient_id: String(flour._id), qty: 10, line_total: 350 },
        { ingredient_id: String(butter._id), qty: 2, line_total: 300 },
      ] },
      String(user._id)
    );

    expect(res.expense.amount).toBe(650);
    expect(res.expense.category).toBe("วัตถุดิบ");
    expect(String(res.expense.description)).toContain(String(flour.ingredient_name));
    expect(await stockOf(flour._id)).toBe(15);
    expect(await stockOf(butter._id)).toBe(2);

    const items = await listStockItems(String(res.expense._id));
    expect(items).toHaveLength(2);
    expect(items.map((t: { line_total?: number | null }) => t.line_total).sort()).toEqual([300, 350]);
    expect(items.every((t: { po_ref?: string | null }) => t.po_ref === "INV-001")).toBe(true);

    const listed = await expenseService.list({ pagination: { page: 1, limit: 10, skip: 0 } } as never);
    const row = listed.items.find((e) => String(e._id) === String(res.expense._id)) as { linked_count: number; linked_total: number };
    expect(row).toMatchObject({ linked_count: 2, linked_total: 650 });
  });

  it("วัตถุดิบหน่วยนับเป็นชิ้นกรอกทศนิยม → ไม่มีอะไรถูกเขียนเลย", async () => {
    const user = await makeUser();
    const flour = await makeIngredient({ current_stock: 0 });
    const egg = await makeIngredient({ current_stock: 0 });
    await (await import("@/models/unitModel")).default.updateOne({ _id: egg.unit_id }, { $set: { unit_name: "ฟอง" } });
    const before = await expenseModel.countDocuments();

    await expect(
      createPurchase({ ...base, items: [
        { ingredient_id: String(flour._id), qty: 1, line_total: 50 },
        { ingredient_id: String(egg._id), qty: 1.5, line_total: 10 },
      ] }, String(user._id))
    ).rejects.toThrow(/จำนวนเต็ม/);

    expect(await expenseModel.countDocuments()).toBe(before);
    expect(await stockOf(flour._id)).toBe(0);
  });

  it("ยอดรวม 0 บาท / วัตถุดิบถูกลบ → ปฏิเสธ", async () => {
    const user = await makeUser();
    const flour = await makeIngredient();
    await expect(
      createPurchase({ ...base, items: [{ ingredient_id: String(flour._id), qty: 1, line_total: 0 }] }, String(user._id))
    ).rejects.toThrow(/มากกว่า 0/);
    await expect(
      createPurchase({ ...base, items: [{ ingredient_id: String(oid()), qty: 1, line_total: 10 }] }, String(user._id))
    ).rejects.toThrow(/ไม่พบวัตถุดิบ/);
  });
});

describe("ผูก/ยกเลิกการผูก + กติกาที่กันยอดเงินกับของไม่ตรงกัน", () => {
  async function setup() {
    const user = await makeUser();
    const flour = await makeIngredient({ current_stock: 0 });
    const { expense } = await createPurchase(
      { ...base, items: [{ ingredient_id: String(flour._id), qty: 4, line_total: 200 }] },
      String(user._id)
    );
    const [txn] = await listStockItems(String(expense._id));
    return { user, flour, expense, txn: txn as { _id: unknown } };
  }

  it("ค่าใช้จ่ายที่ผูกอยู่ลบไม่ได้ · รายการรับเข้าที่ผูกอยู่ยกเลิกไม่ได้ · ปลดแล้วทำได้ทั้งคู่", async () => {
    const { expense, txn } = await setup();
    const eid = String(expense._id);
    await expect(expenseService.remove(eid)).rejects.toThrow(/ยกเลิกการผูกก่อน/);
    await expect(voidTransaction(String(txn._id))).rejects.toThrow(/ผูกกับบิลซื้อ/);

    await unlinkStockItem(eid, String(txn._id));
    expect(await listStockItems(eid)).toHaveLength(0);
    await voidTransaction(String(txn._id));
    await expenseService.remove(eid);
  });

  it("แก้ยอดเงินให้น้อยกว่าราคารวมของที่ผูกไว้ไม่ได้", async () => {
    const { expense } = await setup();
    await expect(expenseService.update(String(expense._id), { amount: 150 })).rejects.toThrow(/ไม่น้อยกว่า/);
    const updated = (await expenseService.update(String(expense._id), { amount: 250 })) as { amount: number; linked_total: number };
    expect(updated).toMatchObject({ amount: 250, linked_total: 200 });
  });

  it("ผูกรายการรับเข้าเดิมย้อนหลัง — ไม่เกินยอดค่าใช้จ่าย · ผูกซ้ำ/ผูกรายการเบิกไม่ได้", async () => {
    const user = await makeUser();
    const sugar = await makeIngredient({ current_stock: 0 });
    const expense = (await expenseService.create({ ...base, description: "บิลเก่า", amount: 100 })) as { _id: unknown };
    const eid = String(expense._id);
    const { transaction: rcv } = await createTransaction({ ingredient_id: String(sugar._id), type: "receive", qty: 3, performed_by: String(user._id) });
    const { transaction: use } = await createTransaction({ ingredient_id: String(sugar._id), type: "use", qty: 1, performed_by: String(user._id) });

    await expect(linkStockItems(eid, [{ transaction_id: String(rcv._id), line_total: 150 }])).rejects.toThrow(/เกินยอด/);
    await expect(linkStockItems(eid, [{ transaction_id: String(use._id), line_total: 10 }])).rejects.toThrow(/เฉพาะรายการรับเข้า/);
    expect(await linkStockItems(eid, [{ transaction_id: String(rcv._id), line_total: 90 }])).toEqual({ linked: 1 });
    await expect(linkStockItems(eid, [{ transaction_id: String(rcv._id), line_total: 5 }])).rejects.toThrow(/ผูกกับค่าใช้จ่ายอื่น/);

    const raw = await ingredientTransactionModel.findById(rcv._id).lean<{ expense_id: unknown; line_total: number }>();
    expect(String(raw!.expense_id)).toBe(eid);
    expect(raw!.line_total).toBe(90);
  });
});
