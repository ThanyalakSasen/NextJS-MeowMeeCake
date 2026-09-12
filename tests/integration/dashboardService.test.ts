import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import * as dashboardService from "@/services/dashboardService";
import { expenseService } from "@/services/expenseService";
import { makeUser, makeProduct } from "./helpers";

/**
 * BACKLOG §3.11 — dashboardService.overview() รวม revenue (satang, จาก orderModel) กับ
 * cogs/expenseTotal (บาท, ยังไม่แปลงในเฟส 1-2 ยกเว้น expense ที่แปลงแล้วในเฟส 2 แต่
 * totalInRange() คืนบาทให้อยู่แล้ว) — เป็นจุดเสี่ยงสุดถ้าผสมหน่วยผิด (กำไรเพี้ยน x100 เงียบ ๆ)
 * เทสนี้ยืนยันว่า profit_estimate คำนวณถูกต้องหลัง expense ย้ายไปเป็นสตางค์ด้วย (เฟส 2)
 */
describe("dashboardService.overview — ผสม revenue (order) + expense ถูกหน่วย", () => {
  it("profit_estimate = revenue - expenses - cogs เป็นบาทถูกต้อง ไม่มีหน่วยปนกัน", async () => {
    const user = await makeUser();
    const product = await makeProduct();

    // สร้างออเดอร์ paid ตรง ๆ ผ่าน model (subtotal/total_amount เป็นสตางค์ — BACKLOG §3.11 เฟส 1)
    const order = await orderModel.create({
      order_no: `OP-DASH-${Date.now()}`,
      user_id: user._id,
      order_type: "takeaway",
      payment_status: "paid",
      subtotal: 100000, // 1000 บาท
      discount_amount: 0,
      delivery_fee: 0,
      total_amount: 100000,
    });
    await orderItemModel.create({
      order_id: order._id,
      product_id: product._id,
      product_snapshot: { product_name_th: "x", product_name_eng: "x" },
      quantity: 1,
      unit_price: 100000,
      total_price: 100000,
      cost_per_unit: 300, // ยังเป็นบาท (ไม่แปลงจนกว่าจะถึงเฟส 4) — cogs = 300*1 = 300 บาท
    });

    // ค่าใช้จ่าย 200 บาท (เก็บเป็นสตางค์ในเฟส 2 — totalInRange() คืนบาทให้)
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
