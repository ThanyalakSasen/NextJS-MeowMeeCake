import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import preorderModel from "@/models/preorderModel";
import preorderItemModel from "@/models/preorderItemModel";
import * as dashboardService from "@/services/dashboardService";
import { expenseService } from "@/services/expenseService";
import { makeUser, makeProduct, oid } from "./helpers";

/**
 * BACKLOG §3.11 — dashboardService.overview() รวม revenue/cogs (satang, จาก orderModel/orderItemModel)
 * กับ expenseTotal (totalsInRange() คืนบาทให้อยู่แล้วตั้งแต่เฟส 2) — เป็นจุดเสี่ยงสุดถ้าผสมหน่วยผิด
 * (กำไรเพี้ยน x100 เงียบ ๆ) ตั้งแต่เฟส 4 orderItem.cost_per_unit ก็เป็นสตางค์แล้วเช่นกัน (ก่อนหน้านี้
 * ยังเป็นบาทค้างอยู่ตัวเดียวในระบบ) เทสนี้ยืนยันว่า profit_estimate คำนวณถูกต้องครบทุกองค์ประกอบแล้ว
 */
describe("dashboardService.overview — ผสม revenue (order) + expense ถูกหน่วย", () => {
  it("profit_estimate = revenue - expenses (cogs = หมวดวัตถุดิบ/บรรจุภัณฑ์ ไม่หักซ้ำ) เป็นบาทถูกต้อง", async () => {
    const user = await makeUser();
    const product = await makeProduct();

    // สร้างออเดอร์ paid ตรง ๆ ผ่าน model (เงินเป็นบาท — docs/money-units.md)
    const order = await orderModel.create({
      order_no: `OP-DASH-${Date.now()}`,
      user_id: user._id,
      order_type: "takeaway",
      payment_status: "paid",
      subtotal: 1000, // 1000 บาท
      discount_amount: 0,
      delivery_fee: 0,
      total_amount: 1000,
    });
    await orderItemModel.create({
      order_id: order._id,
      product_id: product._id,
      product_snapshot: { product_name_th: "x", product_name_eng: "x" },
      quantity: 1,
      unit_price: 1000,
      total_price: 1000,
      cost_per_unit: 300, // 300 บาท — recipe_cogs = 300 × 1 = 300 บาท (อ้างอิง ไม่หักจากกำไร)
    });

    // ค่าใช้จ่าย 200 + 150 บาท (สร้างผ่าน expenseService) — 150 เป็นหมวดวัตถุดิบ = COGS
    await expenseService.create({
      date: new Date(),
      description: "ค่าไฟ",
      category: "ค่าสาธารณูปโภค",
      amount: 200,
      payment_method: "โอนเงิน",
    });
    await expenseService.create({
      date: new Date(),
      description: "แป้ง",
      category: "วัตถุดิบ",
      amount: 150,
      payment_method: "โอนเงิน",
    });

    const result = await dashboardService.overview();

    expect(result.revenue).toBe(1000);
    expect(result.expenses).toBe(350);
    expect(result.cogs).toBe(150); // เฉพาะหมวดวัตถุดิบ — อยู่ใน expenses แล้ว
    expect(result.recipe_cogs).toBe(300);
    expect(result.profit_estimate).toBe(1000 - 350); // 650 — ไม่หัก recipe_cogs / วัตถุดิบซ้ำ (Final-Backlog Q1)
  });
});

/**
 * docs/BACKLOG4.md R5 — overview/salesByDay/topProducts รวมพรีออเดอร์ด้วย (เดิมอ่านแค่ orders)
 * เงินเป็นบาททั้งข้อมูลและผลลัพธ์ (docs/money-units.md) · ใช้ช่วงวันที่ของตัวเอง (ปี 2032) กันข้อมูลเทสอื่นปน
 */
describe("dashboardService — รวมพรีออเดอร์ (BACKLOG4 R5)", () => {
  const at = new Date(Date.UTC(2032, 2, 10, 5, 0, 0));
  const range = { date_from: new Date(Date.UTC(2032, 2, 10)).toISOString(), date_to: new Date(Date.UTC(2032, 2, 11)).toISOString() };

  async function seed() {
    const user = await makeUser();
    const cake = await makeProduct({ product_name_th: `เค้กR5-${Date.now()}` });
    const bread = await makeProduct({ product_name_th: `ซาวโดว์R5-${Date.now()}`, is_preorder: true, product_stock_quantity: null });

    const o = await orderModel.create({
      order_no: `ORD-R5-${Date.now()}`, user_id: user._id, order_type: "takeaway", payment_status: "paid",
      order_status: "completed", subtotal: 100, discount_amount: 10, total_amount: 90, created_at: at,
    });
    await orderItemModel.create({
      order_id: o._id, product_id: cake._id, product_snapshot: { product_name_th: cake.product_name_th, product_name_eng: "c" },
      quantity: 2, unit_price: 50, total_price: 100, cost_per_unit: 10,
    });

    const p = await preorderModel.create({
      preorder_no: `PRE-R5-${Date.now()}`, user_id: user._id, round_id: oid(), order_type: "takeaway", payment_status: "paid",
      order_status: "confirmed", subtotal: 300, discount_amount: 0, total_amount: 300, created_at: at,
    });
    await preorderItemModel.create({
      preorder_id: p._id, round_item_id: oid(), product_id: bread._id, pickup_date: at,
      product_snapshot: { product_name_th: bread.product_name_th, product_name_eng: "b" },
      quantity: 3, unit_price: 100, total_price: 300, cost_per_unit: 40,
    });
    // ยกเลิกหลังชำระ รอโอนคืน (payment_status ยัง paid) — ต้องไม่นับ
    const c = await orderModel.create({
      order_no: `ORD-R5-C-${Date.now()}`, user_id: user._id, order_type: "takeaway", payment_status: "paid",
      order_status: "cancelled", subtotal: 59, discount_amount: 0, total_amount: 59, created_at: at,
    });
    await orderItemModel.create({
      order_id: c._id, product_id: cake._id, product_snapshot: { product_name_th: cake.product_name_th, product_name_eng: "c" },
      quantity: 1, unit_price: 59, total_price: 59, cost_per_unit: 10,
    });
    // ยังไม่จ่าย — ต้องไม่นับ
    await preorderModel.create({
      preorder_no: `PRE-R5-U-${Date.now()}`, user_id: user._id, round_id: oid(), order_type: "takeaway", payment_status: "pending",
      subtotal: 999, total_amount: 999, created_at: at,
    });
    return { cake, bread };
  }

  it("overview: รายได้/ส่วนลด/COGS/จำนวน รวมทั้งสองแหล่ง + by_source แยกให้", async () => {
    await seed();
    const r = await dashboardService.overview(range);
    expect(r.revenue).toBe(390); // 90 (ออเดอร์) + 300 (พรีออเดอร์)
    expect(r.discount_given).toBe(10);
    expect(r.recipe_cogs).toBe(20 + 120); // 2×10 + 3×40
    expect(r.orders.paid).toBe(2);
    expect(r.orders.total).toBe(4); // รวมพรีออเดอร์ที่ยังไม่จ่าย + ออเดอร์ที่ยกเลิก (นับจำนวนตามสถานะ)
    expect(r.avg_order_value).toBe(195);
    expect(r.by_source.orders).toMatchObject({ total: 2, paid: 1, revenue: 90, recipe_cogs: 20 });
    expect(r.by_source.preorders).toMatchObject({ total: 2, paid: 1, revenue: 300, recipe_cogs: 120 });
  });

  it("topProducts: สินค้าพรีออเดอร์ติดอันดับด้วย เรียงตามจำนวน", async () => {
    const { cake, bread } = await seed();
    const r = await dashboardService.topProducts({ ...range, limit: 10 });
    const ids = r.items.map((i) => i.product_id);
    expect(ids.indexOf(String(bread._id))).toBeLessThan(ids.indexOf(String(cake._id))); // 3 ชิ้น > 2 ชิ้น
    expect(r.items.find((i) => i.product_id === String(bread._id))).toMatchObject({ quantity_sold: 3, revenue: 300 });
    expect(r.items.find((i) => i.product_id === String(cake._id))).toMatchObject({ quantity_sold: 2, revenue: 100 }); // ไม่รวมออเดอร์ที่ยกเลิก
  });

  it("revenueByChannel: ไม่นับออเดอร์ที่ยกเลิกแล้วแต่ยังรอโอนคืน", async () => {
    await seed();
    const r = await dashboardService.revenueByChannel(range);
    expect(r.web).toBe(90);
    expect(r.preorder).toBe(300);
    expect(r.recipe_cogs).toBe(20 + 120);
  });
});

/** หน้าสรุปกำไร-ขาดทุน — ตารางเปรียบเทียบรายวันในคำขอเดียว (เดิมช่วงละ 2 คำขอ) · ปี 2033 กันข้อมูลเทสอื่นปน */
describe("dashboardService.financeTrend", () => {
  const day = (d: number) => {
    const from = new Date(Date.UTC(2033, 0, d));
    return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000 - 1).toISOString() };
  };

  it("รายรับ/รายจ่ายแยกตามช่วง — ชุดเดียวกับ revenueByChannel / expenses summary", async () => {
    const user = await makeUser();
    const base = { user_id: user._id, order_type: "takeaway", discount_amount: 0 };
    await orderModel.create({ ...base, order_no: `ORD-FT1-${Date.now()}`, payment_status: "paid", order_status: "completed",
      subtotal: 100, total_amount: 100, created_at: new Date(Date.UTC(2033, 0, 1, 23, 59)) });
    await orderModel.create({ ...base, order_no: `ORD-FT2-${Date.now()}`, payment_status: "paid", order_status: "cancelled",
      subtotal: 70, total_amount: 70, created_at: new Date(Date.UTC(2033, 0, 2, 3)) }); // ยกเลิก — ไม่นับ
    await preorderModel.create({ ...base, preorder_no: `PRE-FT-${Date.now()}`, round_id: oid(), payment_status: "paid",
      order_status: "confirmed", subtotal: 250, total_amount: 250, created_at: new Date(Date.UTC(2033, 0, 3, 0, 0)) });
    await expenseService.create({ date: new Date(Date.UTC(2033, 0, 2, 12)), description: "ไข่", category: "ค่าสาธารณูปโภค", amount: 40, payment_method: "โอนเงิน" });

    const ranges = [day(1), day(2), day(3)];
    const r = await dashboardService.financeTrend(ranges);
    expect(r.buckets.map((b) => [b.income, b.expense])).toEqual([[100, 0], [0, 40], [250, 0]]);
    expect(r.buckets[0]).toMatchObject(ranges[0]);
    const byChannel = await dashboardService.revenueByChannel({ date_from: ranges[2].from, date_to: ranges[2].to });
    expect(r.buckets[2].income).toBe(byChannel.total);
  });

  it("ช่วงไม่ต่อเนื่อง / เกินจำนวน / ว่าง → 400", async () => {
    await expect(dashboardService.financeTrend([day(1), day(3)])).rejects.toMatchObject({ status: 400 });
    await expect(dashboardService.financeTrend([day(2), day(1)])).rejects.toMatchObject({ status: 400 });
    await expect(dashboardService.financeTrend([])).rejects.toMatchObject({ status: 400 });
    const many = Array.from({ length: dashboardService.FINANCE_TREND_MAX_RANGES + 1 }, (_, i) => day(i + 1));
    await expect(dashboardService.financeTrend(many)).rejects.toMatchObject({ status: 400 });
  });
});
