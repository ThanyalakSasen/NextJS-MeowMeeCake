import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import productionItemModel from "@/models/productionItemModel";
import * as productionOrderService from "@/services/productionOrderService";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * docs/BACKLOG4.md Y2 (ตัดสินใจ 2026-10-01: เพิ่มอัตโนมัติ) — ปิดงานผลิต (completeProduction) → เพิ่มสต็อกสินค้าสำเร็จรูป
 * เฉพาะสินค้าปกติ · พรีออเดอร์ไม่มีสต็อก · รายการยกเลิกไม่เพิ่ม · use_actual ใช้ actual_qty
 * สูตรจาก makeRecipe ไม่มีวัตถุดิบ → การหักวัตถุดิบไม่มีผล (ไม่ใช่สิ่งที่เทสนี้ตรวจ)
 */

const stockOf = async (id: unknown) =>
  (await productModel.findById(id).lean<{ product_stock_quantity: number | null }>())!.product_stock_quantity;

async function orderWith(items: Array<{ product: { _id: unknown }; qty: number }>) {
  const admin = await makeUser();
  const withRecipes = await Promise.all(
    items.map(async (i) => ({ ...i, recipe: await makeRecipe(String(i.product._id)) }))
  );
  const order = (await productionOrderService.createProductionOrder({
    production_date: new Date(),
    items: withRecipes.map((i) => ({
      product_id: String(i.product._id),
      recipe_id: String(i.recipe._id),
      planned_qty: i.qty,
    })),
  })) as { _id: unknown };
  await productionOrderService.startProduction(String(order._id));
  return { order, admin };
}

describe("ปิดงานผลิต → เพิ่มสต็อกสินค้าสำเร็จรูป (BACKLOG4 Y2)", () => {
  it("สินค้าปกติ +planned_qty · พรีออเดอร์ไม่แตะ · บันทึกจำนวนที่เพิ่มในรายการ", async () => {
    const cake = await makeProduct({ product_stock_quantity: 4 });
    const bread = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    const { order, admin } = await orderWith([
      { product: cake, qty: 12 },
      { product: bread, qty: 5 },
    ]);

    await productionOrderService.completeProduction(String(order._id), { performed_by: String(admin._id) });

    expect(await stockOf(cake._id)).toBe(16);
    expect(await stockOf(bread._id)).toBeNull();
    const items = await productionItemModel
      .find({ production_order_id: order._id })
      .lean<Array<{ product_id: unknown; product_stock_added_qty: number | null; product_stock_added_at: Date | null }>>();
    const cakeItem = items.find((i) => String(i.product_id) === String(cake._id))!;
    const breadItem = items.find((i) => String(i.product_id) === String(bread._id))!;
    expect(cakeItem.product_stock_added_qty).toBe(12);
    expect(breadItem.product_stock_added_at).toBeNull();
  });

  it("use_actual → ใช้ actual_qty ที่กรอก (ผลิตได้จริงน้อยกว่าแผน)", async () => {
    const cake = await makeProduct({ product_stock_quantity: 0 });
    const { order, admin } = await orderWith([{ product: cake, qty: 20 }]);
    await productionItemModel.updateOne({ production_order_id: order._id }, { $set: { actual_qty: 17 } });

    await productionOrderService.completeProduction(String(order._id), { performed_by: String(admin._id), use_actual: true });
    expect(await stockOf(cake._id)).toBe(17);
  });

  it("รายการที่ยกเลิก → ไม่เพิ่มสต็อก", async () => {
    const [a, b] = [await makeProduct({ product_stock_quantity: 1 }), await makeProduct({ product_stock_quantity: 1 })];
    const { order, admin } = await orderWith([
      { product: a, qty: 3 },
      { product: b, qty: 7 },
    ]);
    await productionItemModel.updateOne({ production_order_id: order._id, product_id: b._id }, { $set: { item_status: "cancelled" } });

    await productionOrderService.completeProduction(String(order._id), { performed_by: String(admin._id) });
    expect(await stockOf(a._id)).toBe(4);
    expect(await stockOf(b._id)).toBe(1);
  });
});
