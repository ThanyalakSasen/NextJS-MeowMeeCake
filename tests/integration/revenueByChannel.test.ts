import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import preorderModel from "@/models/preorderModel";
import orderItemModel from "@/models/orderItemModel";
import preorderItemModel from "@/models/preorderItemModel";
import { orderChannelOf, revenueByChannel } from "@/services/dashboardService";
import { makeUser, oid } from "./helpers";

/**
 * dashboardService.revenueByChannel — docs/BACKLOG2.md §14 (2026-09-30): รายรับแยกตามช่องทางออเดอร์
 * web = ORD- · pos = POS- · preorder = พรีออเดอร์ (collection แยก) · other = เลขรุ่นเก่า
 * เงินเป็นบาททั้งข้อมูลและผลลัพธ์ (docs/money-units.md)
 */
describe("revenueByChannel", () => {
  // ช่วงวันที่แคบของแต่ละเทส กันข้อมูลเทสอื่นปน (DB ใช้ร่วมทั้งไฟล์)
  const day = (d: number) => new Date(Date.UTC(2031, 0, d, 5, 0, 0));
  const range = (d: number) => ({
    date_from: day(d).toISOString(),
    date_to: new Date(day(d).getTime() + 3_600_000).toISOString(),
  });

  async function order(d: number, prefix: string, total: number, over: Record<string, unknown> = {}) {
    const user = await makeUser();
    return orderModel.create({
      order_no: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: user._id,
      order_type: "takeaway",
      payment_status: "paid",
      subtotal: total,
      total_amount: total,
      created_at: day(d),
      ...over,
    });
  }
  async function preorder(d: number, total: number, over: Record<string, unknown> = {}) {
    const user = await makeUser();
    return preorderModel.create({
      preorder_no: `PRE-RC-${Date.now()}-${Math.random()}`,
      user_id: user._id,
      round_id: oid(),
      order_type: "takeaway",
      payment_status: "paid",
      subtotal: total,
      total_amount: total,
      created_at: day(d),
      ...over,
    });
  }

  it("แยกยอดตามช่องทาง: ORD- / POS- / พรีออเดอร์ / เลขรุ่นเก่า + จำนวน", async () => {
    await order(1, "ORD", 100);
    await order(1, "ORD", 25.5);
    await order(1, "POS", 70);
    await order(1, "OP", 10); // เลขรุ่นเก่า
    await preorder(1, 400);

    const r = await revenueByChannel(range(1));
    expect(r).toMatchObject({ web: 125.5, pos: 70, preorder: 400, other: 10, total: 605.5, orders: 5 });
    expect(r.counts).toEqual({ web: 2, pos: 1, preorder: 1, other: 1 });
  });

  it("ไม่นับที่ยังไม่จ่าย / ถูกลบ / นอกช่วงวันที่", async () => {
    await order(2, "ORD", 50);
    await order(2, "ORD", 99.99, { payment_status: "pending" });
    await order(2, "POS", 99.99, { deleted_at: new Date() });
    await preorder(2, 99.99, { payment_status: "pending" });
    await order(3, "ORD", 99.99); // วันอื่น

    const r = await revenueByChannel(range(2));
    expect(r).toMatchObject({ web: 50, pos: 0, preorder: 0, other: 0, total: 50, orders: 1 });
  });

  it("recipe_cogs = Σ cost_per_unit × จำนวน ของออเดอร์ + พรีออเดอร์ที่ชำระแล้ว", async () => {
    const paid = await order(4, "POS", 200);
    const unpaid = await order(4, "ORD", 200, { payment_status: "pending" });
    const pre = await preorder(4, 300);
    await orderItemModel.create([
      { order_id: paid._id, product_id: oid(), product_snapshot: { product_name_th: "a", product_name_eng: "a" }, quantity: 2, unit_price: 100, total_price: 200, cost_per_unit: 30 },
      { order_id: unpaid._id, product_id: oid(), product_snapshot: { product_name_th: "b", product_name_eng: "b" }, quantity: 1, unit_price: 200, total_price: 200, cost_per_unit: 99 },
    ]);
    await preorderItemModel.create({
      preorder_id: pre._id, round_item_id: oid(), pickup_date: day(5), product_id: oid(), product_snapshot: { product_name_th: "c", product_name_eng: "c" }, quantity: 3, unit_price: 100, total_price: 300, cost_per_unit: 25.5,
    });

    const r = await revenueByChannel(range(4));
    expect(r.recipe_cogs).toBe(2 * 30 + 3 * 25.5); // 136.5 — ไม่นับออเดอร์ที่ยังไม่จ่าย
  });

  it("orderChannelOf", () => {
    expect(orderChannelOf("ORD-20260930-ABC123")).toBe("web");
    expect(orderChannelOf("POS-20260930-ABC123")).toBe("pos");
    expect(orderChannelOf("PRE-20260930-ABC123")).toBe("preorder");
    expect(orderChannelOf("OP-123")).toBe("other");
    expect(orderChannelOf(undefined)).toBe("other");
  });
});
