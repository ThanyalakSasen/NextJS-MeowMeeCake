import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import preorderModel from "@/models/preorderModel";
import * as dashboardService from "@/services/dashboardService";
import { bangkokDateString } from "@/lib/datetime";
import { makeUser, oid } from "./helpers";

/** salesByDay แยกยอดรายวันตามช่องทาง (กราฟแท่งซ้อนสีในแดชบอร์ด) — กติกาเดียวกับ revenueByChannel · เงินเป็นบาท */
describe("dashboardService.salesByDay — channels รายวัน", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const twoDaysAgo = new Date(Date.now() - 2 * DAY);
  const yesterday = new Date(Date.now() - DAY);

  async function order(orderNo: string, total: number, at: Date, paid = true) {
    const user = await makeUser();
    return orderModel.create({
      order_no: orderNo, user_id: user._id, order_type: "takeaway", payment_status: paid ? "paid" : "pending",
      order_status: paid ? "completed" : "pending", subtotal: total, discount_amount: 0, total_amount: total, created_at: at,
    });
  }

  it("ORD- = web · POS- = pos · เลขรุ่นเก่า = other · พรีออเดอร์ = preorder · ยังไม่จ่ายไม่นับ · ผลรวมช่องทาง = revenue/orders ของวัน", async () => {
    const tag = Date.now();
    await order(`ORD-${tag}-1`, 100, twoDaysAgo);
    await order(`ORD-${tag}-2`, 40, twoDaysAgo);
    await order(`POS-${tag}-1`, 50, twoDaysAgo);
    await order(`OP-${tag}-1`, 20, twoDaysAgo);
    await order(`ORD-${tag}-9`, 999, twoDaysAgo, false);
    await order(`POS-${tag}-2`, 75, yesterday);
    const user = await makeUser();
    await preorderModel.create({
      preorder_no: `PRE-${tag}-1`, user_id: user._id, round_id: oid(), order_type: "takeaway", payment_status: "paid",
      order_status: "confirmed", subtotal: 300, discount_amount: 0, total_amount: 300, created_at: twoDaysAgo,
    });

    const { series } = await dashboardService.salesByDay({ days: 7 });
    const day = series.find((d) => d.date === bangkokDateString(twoDaysAgo));
    expect(day).toEqual({
      date: bangkokDateString(twoDaysAgo),
      revenue: 510,
      orders: 5,
      channels: {
        web: { revenue: 140, orders: 2 },
        pos: { revenue: 50, orders: 1 },
        preorder: { revenue: 300, orders: 1 },
        other: { revenue: 20, orders: 1 },
      },
    });

    const next = series.find((d) => d.date === bangkokDateString(yesterday));
    expect(next?.channels).toEqual({
      web: { revenue: 0, orders: 0 },
      pos: { revenue: 75, orders: 1 },
      preorder: { revenue: 0, orders: 0 },
      other: { revenue: 0, orders: 0 },
    });
  });

  it("ไม่มีเลขออเดอร์ (order_no ว่าง) → other ไม่ error", async () => {
    const user = await makeUser();
    await orderModel.collection.insertOne({
      user_id: user._id, order_type: "takeaway", payment_status: "paid", order_status: "completed",
      subtotal: 10, discount_amount: 0, total_amount: 10, created_at: twoDaysAgo, deleted_at: null,
    });
    const { series } = await dashboardService.salesByDay({ days: 7 });
    const day = series.find((d) => d.date === bangkokDateString(twoDaysAgo));
    expect(day?.channels.other).toEqual({ revenue: 10, orders: 1 });
  });
});
