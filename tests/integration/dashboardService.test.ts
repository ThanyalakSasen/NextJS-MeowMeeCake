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
 * กับ expenseTotal (totalInRange() คืนบาทให้อยู่แล้วตั้งแต่เฟส 2) — เป็นจุดเสี่ยงสุดถ้าผสมหน่วยผิด
 * (กำไรเพี้ยน x100 เงียบ ๆ) ตั้งแต่เฟส 4 orderItem.cost_per_unit ก็เป็นสตางค์แล้วเช่นกัน (ก่อนหน้านี้
 * ยังเป็นบาทค้างอยู่ตัวเดียวในระบบ) เทสนี้ยืนยันว่า profit_estimate คำนวณถูกต้องครบทุกองค์ประกอบแล้ว
 */
describe("dashboardService.overview — ผสม revenue (order) + expense ถูกหน่วย", () => {
  it("profit_estimate = revenue - expenses - cogs เป็นบาทถูกต้อง ไม่มีหน่วยปนกัน", async () => {
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
      cost_per_unit: 300, // 300 บาท — cogs = 300 × 1 = 300 บาท
    });

    // ค่าใช้จ่าย 200 บาท (สร้างผ่าน expenseService)
    await expenseService.create({
      date: new Date(),
      description: "ค่าไฟ",
      category: "ค่าสาธารณูปโภค",
      amount: 200,
      payment_method: "โอนเงิน",
    });

    const result = await dashboardService.overview();

    expect(result.revenue).toBe(1000);
    expect(result.expenses).toBe(200);
    expect(result.cogs).toBe(300);
    expect(result.profit_estimate).toBe(1000 - 200 - 300); // 500 — ไม่ใช่ 500*100 หรือ 5.00
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
    expect(r.cogs).toBe(20 + 120); // 2×10 + 3×40
    expect(r.orders.paid).toBe(2);
    expect(r.orders.total).toBe(3); // รวมพรีออเดอร์ที่ยังไม่จ่าย (นับจำนวนตามสถานะ)
    expect(r.avg_order_value).toBe(195);
    expect(r.by_source.orders).toMatchObject({ total: 1, paid: 1, revenue: 90, cogs: 20 });
    expect(r.by_source.preorders).toMatchObject({ total: 2, paid: 1, revenue: 300, cogs: 120 });
  });

  it("topProducts: สินค้าพรีออเดอร์ติดอันดับด้วย เรียงตามจำนวน", async () => {
    const { cake, bread } = await seed();
    const r = await dashboardService.topProducts({ ...range, limit: 10 });
    const ids = r.items.map((i) => i.product_id);
    expect(ids.indexOf(String(bread._id))).toBeLessThan(ids.indexOf(String(cake._id))); // 3 ชิ้น > 2 ชิ้น
    expect(r.items.find((i) => i.product_id === String(bread._id))).toMatchObject({ quantity_sold: 3, revenue: 300 });
  });
});
