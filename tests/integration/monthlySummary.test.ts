import { describe, it, expect, vi, afterEach } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import preorderModel from "@/models/preorderModel";
import expenseModel from "@/models/expenseModel";
import notificationModel from "@/models/notificationModel";
import {
  sendMonthlySummary,
  monthRange,
  previousMonth,
  thaiMonthLabel,
} from "@/services/monthlySummaryService";
import { makeUser, makeProduct, oid } from "./helpers";

vi.mock("@/lib/line", () => ({ pushLineMessage: vi.fn(async () => ({ ok: true })) }));
import { pushLineMessage } from "@/lib/line";

/**
 * docs/LINE.md §9.13 — สรุปยอดรายเดือนถึงเจ้าของร้าน · ตัดรอบตามเวลาไทย · ส่งครั้งเดียวต่อเดือน
 * ใช้ปี 2033 กันข้อมูลเทสอื่นปน · เงินเป็นบาท
 */

afterEach(() => vi.mocked(pushLineMessage).mockClear());

const TH = 7 * 3600_000;
/** เวลาไทย → Date (UTC) */
const th = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h) - TH);

async function seed() {
  const user = await makeUser();
  const cake = await makeProduct({ product_name_th: "คัพเค้กสรุปเดือน" });
  const order = async (no: string, total: number, at: Date, paid = true) => {
    const o = await orderModel.create({
      order_no: no, user_id: user._id, order_type: "takeaway", payment_status: paid ? "paid" : "pending",
      order_status: "completed", subtotal: total, total_amount: total, created_at: at,
    });
    await orderItemModel.create({
      order_id: o._id, product_id: cake._id, product_snapshot: { product_name_th: cake.product_name_th, product_name_eng: "c" },
      quantity: total / 35, unit_price: 35, total_price: total, cost_per_unit: 10,
    });
  };
  // กันยายน 2033 (เวลาไทย)
  await order("ORD-20330901-AAAAAA", 350, th(2033, 9, 1, 0)); // 00:00 น. วันที่ 1 — นับเป็นกันยายน
  await order("POS-20330915-BBBBBB", 70, th(2033, 9, 15));
  await order("ORD-20330920-CCCCCC", 999, th(2033, 9, 20), false); // ยังไม่จ่าย — ไม่นับ
  await preorderModel.create({
    preorder_no: "PRE-20330925-DDDDDD", user_id: user._id, round_id: oid(), order_type: "takeaway", payment_status: "paid",
    order_status: "confirmed", subtotal: 640, total_amount: 640, created_at: th(2033, 9, 25),
  });
  await order("ORD-20331001-EEEEEE", 105, th(2033, 10, 1, 0)); // ตุลาคมแล้ว (00:00 น. ไทย) — ไม่นับในกันยายน
  // สิงหาคม 2033 — ไว้เทียบเดือนก่อน
  await order("ORD-20330810-FFFFFF", 700, th(2033, 8, 10));
  await expenseModel.create({ date: th(2033, 9, 5), description: "แป้ง", category: "วัตถุดิบ", amount: 200, payment_method: "โอนเงิน" });
}

describe("monthlySummaryService (LINE.md §9.13)", () => {
  it("ช่วงเดือนตามเวลาไทย + เดือนที่แล้ว + ชื่อเดือนไทย", () => {
    const { from, to } = monthRange("2033-09");
    expect(from.toISOString()).toBe("2033-08-31T17:00:00.000Z");
    expect(to.toISOString()).toBe("2033-09-30T16:59:59.999Z");
    // 1 ต.ค. 2033 03:00 น. ไทย (= 30 ก.ย. 20:00 UTC) → เดือนที่แล้ว = กันยายน
    expect(previousMonth(new Date("2033-09-30T20:00:00Z"))).toBe("2033-09");
    expect(previousMonth(new Date("2034-01-01T02:00:00Z"))).toBe("2033-12");
    expect(thaiMonthLabel("2033-09")).toBe("กันยายน 2576");
  });

  it("ตัวเลข: ยอดขาย/ช่องทาง/เทียบเดือนก่อน/ค่าใช้จ่าย/COGS/กำไร/ขายดี · ไม่นับยังไม่จ่าย/นอกเดือน", async () => {
    await seed();
    const res = await sendMonthlySummary({ month: "2033-09", dryRun: true });
    const s = res.summary;
    expect(res.skipped).toBe("dry_run");
    expect(s.revenue).toBe(1060); // 350 + 70 + 640
    expect(s.by_channel).toEqual({ web: 350, pos: 70, preorder: 640, other: 0 });
    expect(s.paid_orders).toBe(3);
    expect(s.previous_revenue).toBe(700);
    expect(s.change_pct).toBe(51.43); // (1060 − 700) / 700
    expect(s.expenses).toBe(200);
    expect(s.cogs).toBe(120); // (10 + 2) ชิ้น × 10 บาท
    expect(s.profit_estimate).toBe(1060 - 200 - 120);
    expect(s.top_products[0]).toMatchObject({ name: "คัพเค้กสรุปเดือน", quantity: 12 });
    expect(res.message).toContain("ยอดขาย 1,060 บาท (เดือนก่อน 700 · +51.43%)");
    expect(res.message).toContain("เว็บ 350 · หน้าร้าน 70 · พรีออเดอร์ 640");
    expect(await notificationModel.countDocuments({ title: res.title })).toBe(0); // dry-run ไม่บันทึก
    expect(pushLineMessage).not.toHaveBeenCalled();
  });

  it("ส่งจริง: บันทึกแจ้งเตือนการเงิน + LINE ครั้งเดียว · รันซ้ำ = already_sent", async () => {
    await seed();
    const first = await sendMonthlySummary({ month: "2033-09" });
    expect(first.sent).toBe(true);
    expect(first.title).toBe("สรุปยอดเดือนกันยายน 2576");
    const n = await notificationModel.findOne({ title: first.title }).lean<{ module: string; link: string }>();
    expect(n).toMatchObject({ module: "finance", link: "/owner/dashboard" });
    expect(vi.mocked(pushLineMessage).mock.calls[0][0]).toMatch(/^\[การเงิน\] สรุปยอดเดือนกันยายน 2576\nยอดขาย 1,060 บาท/);

    const again = await sendMonthlySummary({ month: "2033-09" });
    expect(again).toMatchObject({ sent: false, skipped: "already_sent" });
    expect(pushLineMessage).toHaveBeenCalledTimes(1);
  });

  it("เดือนที่ไม่มียอดเลย → ยอด 0 · ไม่มีเทียบเดือนก่อน · ไม่พัง", async () => {
    const res = await sendMonthlySummary({ month: "2040-02", dryRun: true });
    expect(res.summary.revenue).toBe(0);
    expect(res.summary.change_pct).toBeNull();
    expect(res.message).toContain("ยอดขาย 0 บาท");
  });
});
