import { describe, it, expect } from "vitest";
import * as preorderRoundService from "@/services/preorderRoundService";
import { makeUser, makeProduct } from "./helpers";

/** ขั้นต่ำต่อออเดอร์ (min_order_qty) ต้องไม่เกินโควตารวม (max_qty_total) — เกิน = ไม่มีใครสั่งได้ */

const DAY = 24 * 60 * 60 * 1000;

const preorderProduct = () =>
  makeProduct({
    is_preorder: true,
    product_stock_quantity: null,
    product_price: 100,
    preorder_config: { min_order_qty: 1, max_order_qty: 10, lead_time_days: 1 },
  });

async function roundWith(items: Array<{ product_id: string; min_order_qty?: number; max_qty_total: number }>) {
  const admin = await makeUser();
  const close = Date.now() + DAY;
  return (await preorderRoundService.createRound(
    {
      round_name: `รอบ-${Math.random()}`,
      open_date: new Date(Date.now() - 1000),
      close_date: new Date(close),
      pickup_date: new Date(close + 2 * DAY),
      items,
    },
    String(admin._id)
  )) as { _id: unknown; items: Array<{ _id: unknown }> };
}

describe("min_order_qty ≤ max_qty_total", () => {
  it("สร้างรอบ: ขั้นต่ำเกินโควตา → 400 · เท่ากันผ่าน", async () => {
    const p = await preorderProduct();
    await expect(roundWith([{ product_id: String(p._id), min_order_qty: 6, max_qty_total: 5 }])).rejects.toMatchObject({ status: 400 });
    await expect(roundWith([{ product_id: String(p._id), min_order_qty: 5, max_qty_total: 5 }])).resolves.toBeTruthy();
  });

  it("เพิ่มสินค้าในรอบ: ขั้นต่ำเกินโควตา → 400", async () => {
    const [a, b] = [await preorderProduct(), await preorderProduct()];
    const round = await roundWith([{ product_id: String(a._id), max_qty_total: 5 }]);
    await expect(
      preorderRoundService.addRoundItem(String(round._id), { product_id: String(b._id), min_order_qty: 4, max_qty_total: 3 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("แก้รายการ: เทียบกับค่าเดิมของอีกฟิลด์", async () => {
    const p = await preorderProduct();
    const round = await roundWith([{ product_id: String(p._id), min_order_qty: 2, max_qty_total: 5 }]);
    const itemId = String(round.items[0]._id);
    await expect(preorderRoundService.updateRoundItem(itemId, { min_order_qty: 6 })).rejects.toMatchObject({ status: 400 });
    await expect(preorderRoundService.updateRoundItem(itemId, { max_qty_total: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(preorderRoundService.updateRoundItem(itemId, { min_order_qty: 3, max_qty_total: 3 })).resolves.toBeTruthy();
  });
});
