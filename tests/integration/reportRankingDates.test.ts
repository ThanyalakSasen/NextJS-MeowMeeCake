import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import * as dashboardService from "@/services/dashboardService";
import * as expenseService from "@/services/expenseService";
import { makeUser, makeProduct } from "./helpers";

/** top-products จัดอันดับตามยอดเงินได้ (sort=revenue) · วันที่ช่วงรายงานผิดรูปแบบ → 400 แทน 500 */

describe("topProducts sort", () => {
  // ช่วงวันที่ของตัวเอง (ปี 2033) กันข้อมูลเทสอื่นปน
  const at = new Date(Date.UTC(2033, 4, 10, 5, 0, 0));
  const range = { date_from: new Date(Date.UTC(2033, 4, 10)).toISOString(), date_to: new Date(Date.UTC(2033, 4, 11)).toISOString() };

  it("qty: ชิ้นเยอะขึ้นก่อน · revenue: ยอดเงินเยอะขึ้นก่อน (ตัด limit หลังเรียง)", async () => {
    const user = await makeUser();
    const cookie = await makeProduct({ product_name_th: `คุกกี้-${Date.now()}` });
    const wholeCake = await makeProduct({ product_name_th: `เค้กปอนด์-${Date.now()}` });
    const o = await orderModel.create({
      order_no: `ORD-RK-${Date.now()}`, user_id: user._id, order_type: "takeaway", payment_status: "paid",
      order_status: "completed", subtotal: 1700, discount_amount: 0, total_amount: 1700, created_at: at,
    });
    await orderItemModel.create([
      { order_id: o._id, product_id: cookie._id, product_snapshot: { product_name_th: cookie.product_name_th, product_name_eng: "c" },
        quantity: 20, unit_price: 10, total_price: 200, cost_per_unit: 2 },
      { order_id: o._id, product_id: wholeCake._id, product_snapshot: { product_name_th: wholeCake.product_name_th, product_name_eng: "w" },
        quantity: 2, unit_price: 750, total_price: 1500, cost_per_unit: 200 },
    ]);

    const byQty = await dashboardService.topProducts({ ...range, limit: 1 });
    expect(byQty.items[0].product_id).toBe(String(cookie._id));
    const byRevenue = await dashboardService.topProducts({ ...range, limit: 1, sort: "revenue" });
    expect(byRevenue.items[0]).toMatchObject({ product_id: String(wholeCake._id), revenue: 1500 });
  });
});

describe("วันที่ช่วงรายงาน", () => {
  it("แปลงไม่ได้ → 400", async () => {
    await expect(dashboardService.revenueByChannel({ date_from: "abc" })).rejects.toMatchObject({ status: 400 });
    await expect(dashboardService.overview({ date_to: "2033-13-45" })).rejects.toMatchObject({ status: 400 });
    await expect(dashboardService.topProducts({ date_from: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(expenseService.summary({ date_from: "nope" })).rejects.toMatchObject({ status: 400 });
  });
});
