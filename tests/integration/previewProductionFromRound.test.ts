import { describe, it, expect } from "vitest";
import preorderModel from "@/models/preorderModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import * as productionOrderService from "@/services/productionOrderService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * productionOrderService.previewProductionFromRound — ฟอร์มสร้างใบสั่งผลิตจากรอบโชว์ล่วงหน้า
 * ต้องได้ตัวเลขเดียวกับ createProductionFromRound (นับเฉพาะ paid) + บอกยอดที่ไม่ถูกนับ + เหตุที่สร้างไม่ได้
 */
describe("productionOrderService.previewProductionFromRound", () => {
  async function setup({ withRecipe = true } = {}) {
    const admin = await makeUser();
    const customer = await makeUser();
    const product = await makeProduct({ is_preorder: true, product_price: 100 });
    if (withRecipe) await makeRecipe(String(product._id));
    const now = Date.now();
    const round = await preorderRoundService.createRound(
      {
        round_name: "รอบ preview",
        open_date: new Date(now - 60_000),
        close_date: new Date(now + 60_000),
        pickup_date: new Date(now + 3 * 24 * 3600 * 1000),
        round_status: "open",
        items: [{ product_id: String(product._id), max_qty_total: 100 }],
      },
      String(admin._id)
    );
    const roundItemId = String(round.items[0]._id);
    const order = (qty: number) =>
      preorderService.createPreorder(String(customer._id), {
        round_id: String(round._id),
        order_type: "takeaway",
        items: [{ round_item_id: roundItemId, quantity: qty }],
      });
    const paidA = await order(3);
    const paidB = await order(2);
    await order(4); // ยังไม่จ่าย — ไม่นับ แต่ต้องแจ้ง
    const cancelled = await order(10);
    await preorderService.updatePreorderStatus(String(cancelled._id), "cancelled");
    await preorderModel.updateMany({ _id: { $in: [paidA._id, paidB._id] } }, { $set: { payment_status: "paid" } });
    return { admin, round, product };
  }
  const close = (roundId: unknown) => preorderRoundModel.updateOne({ _id: roundId }, { $set: { round_status: "closed" } });

  it("นับเฉพาะที่จ่ายแล้ว · แจ้งยอดที่ยังไม่จ่าย · ไม่นับที่ยกเลิก · ไม่มี blocker", async () => {
    const { round, product } = await setup();
    await close(round._id);
    const p = await productionOrderService.previewProductionFromRound(String(round._id));
    expect(p.blockers).toEqual([]);
    expect(p.existing_production).toBeNull();
    expect(p.paid_order_count).toBe(2);
    expect(p.unpaid_order_count).toBe(1);
    expect(p.products).toHaveLength(1);
    expect(p.products[0]).toMatchObject({ product_id: String(product._id), planned_qty: 5, unpaid_qty: 4 });
    expect(p.products[0].recipe).not.toBeNull();
  });

  it("ตัวเลขตรงกับใบที่สร้างจริง · สร้างแล้ว preview บอก already_has_production + เลขใบ", async () => {
    const { round } = await setup();
    await close(round._id);
    const before = await productionOrderService.previewProductionFromRound(String(round._id));
    const order = await productionOrderService.createProductionFromRound({
      round_id: String(round._id),
      production_date: new Date().toISOString(),
    });
    expect(order.items.map((i: { planned_qty: number }) => i.planned_qty)).toEqual(before.products.map((l) => l.planned_qty));
    const after = await productionOrderService.previewProductionFromRound(String(round._id));
    expect(after.blockers).toContain("already_has_production");
    expect(after.existing_production?.production_no).toBe(order.production_no);
  });

  it("รอบยังไม่ปิด + สินค้าไม่มีสูตร → round_not_closed + missing_recipe", async () => {
    const { round } = await setup({ withRecipe: false });
    const p = await productionOrderService.previewProductionFromRound(String(round._id));
    expect(p.blockers).toEqual(expect.arrayContaining(["round_not_closed", "missing_recipe"]));
    expect(p.products[0].recipe).toBeNull();
  });

  it("ไม่มีใครจ่าย → no_paid_orders", async () => {
    const { round } = await setup();
    await preorderModel.updateMany({ round_id: round._id }, { $set: { payment_status: "pending" } });
    await close(round._id);
    const p = await productionOrderService.previewProductionFromRound(String(round._id));
    expect(p.blockers).toContain("no_paid_orders");
    expect(p.products[0].planned_qty).toBe(0);
  });
});
