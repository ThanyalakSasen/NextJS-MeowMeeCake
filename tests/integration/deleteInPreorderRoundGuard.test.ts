import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderModel from "@/models/preorderModel";
import * as productService from "@/services/productService";
import * as productionOrderService from "@/services/productionOrderService";
import { makeUser, makeProduct, makePreorder, makeRecipe } from "./helpers";

/** สินค้าที่ยังอยู่ในรอบพรีออเดอร์/การผลิตที่ยังไม่จบลบไม่ได้ (ผู้ใช้ขอ 2026-10-30) — ลบได้เมื่อปิดรอบและผลิตเสร็จแล้ว */
const deletedAt = async (id: unknown) => (await productModel.findById(id).lean<{ deleted_at: Date | null }>())?.deleted_at;

async function roundWith(productId: unknown, round_status: string) {
  const admin = await makeUser();
  const now = Date.now();
  const round = await preorderRoundModel.create({
    created_by: admin._id,
    round_name: `รอบทดสอบ ${round_status}`,
    open_date: new Date(now - 86_400_000),
    close_date: new Date(now + 86_400_000),
    pickup_date: new Date(now + 2 * 86_400_000),
    round_status,
  });
  const item = await preorderRoundItemModel.create({ round_id: round._id, product_id: productId, max_qty_total: 10 });
  return { round, item };
}

async function preorderIn(round: { _id: unknown }, item: { _id: unknown }, product: { _id: unknown }, order_status: string) {
  const user = await makeUser();
  const po = await makePreorder(String(user._id), { round_id: round._id, order_status });
  await preorderItemModel.create({
    preorder_id: po._id,
    round_item_id: item._id,
    product_id: product._id,
    product_snapshot: { product_name_th: "เค้ก", product_name_eng: "Cake" },
    pickup_date: new Date(),
    quantity: 1,
    unit_price: 100,
    total_price: 100,
  });
  return po;
}

describe("ลบสินค้าพรีออเดอร์ที่อยู่ในรอบ", () => {
  it("รอบตั้งเวลาไว้/เปิดรับอยู่ → 409 บอกชื่อรอบ", async () => {
    for (const status of ["scheduled", "open"]) {
      const p = await makeProduct({ is_preorder: true, product_stock_quantity: null });
      const { round } = await roundWith(p._id, status);
      await expect(productService.deleteProduct(String(p._id))).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining(round.round_name),
      });
      await expect(productService.hardDeleteProduct(String(p._id))).rejects.toMatchObject({ status: 409 });
      expect(await deletedAt(p._id)).toBeNull();
    }
  });

  it("รอบปิดแล้วแต่ยังมีพรีออเดอร์ที่ยังไม่ผลิต → 409 · ผลิตเสร็จ (พร้อมรับ) แล้ว → ลบได้", async () => {
    const p = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    const { round, item } = await roundWith(p._id, "closed");
    const po = await preorderIn(round, item, p, "confirmed");
    await expect(productService.deleteProduct(String(p._id))).rejects.toMatchObject({ status: 409 });

    await preorderModel.updateOne({ _id: po._id }, { $set: { order_status: "ready" } });
    await productService.deleteProduct(String(p._id));
    expect(await deletedAt(p._id)).not.toBeNull();
  });

  it("รอบยกเลิก / รอบปิดที่ไม่มีพรีออเดอร์ค้าง → ลบได้", async () => {
    const a = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    await roundWith(a._id, "cancelled");
    await expect(productService.deleteProduct(String(a._id))).resolves.toBeTruthy();

    const b = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    const { round, item } = await roundWith(b._id, "closed");
    await preorderIn(round, item, b, "cancelled");
    await expect(productService.deleteProduct(String(b._id))).resolves.toBeTruthy();
  });

  it("อยู่ในใบสั่งผลิตที่ยังไม่เสร็จ → 409 · ปิดงานแล้ว → ลบได้", async () => {
    const p = await makeProduct({ product_stock_quantity: 0 });
    const recipe = await makeRecipe(String(p._id));
    const order = (await productionOrderService.createProductionOrder({
      production_date: new Date(),
      items: [{ product_id: String(p._id), recipe_id: String(recipe._id), planned_qty: 2 }],
    })) as { _id: unknown; production_no: string };
    await expect(productService.deleteProduct(String(p._id))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(order.production_no),
    });

    await productionOrderService.cancelProduction(String(order._id));
    await expect(productService.deleteProduct(String(p._id))).resolves.toBeTruthy();
  });
});
