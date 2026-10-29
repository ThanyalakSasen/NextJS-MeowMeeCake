import { describe, it, expect, vi } from "vitest";
import ingredientModel from "@/models/ingredientModel";
import productModel from "@/models/productModel";
import productionItemModel from "@/models/productionItemModel";
import productionOrderModel from "@/models/productionOrderModel";
import productLotModel from "@/models/productLotModel";
import * as productionOrderService from "@/services/productionOrderService";
import * as productLotService from "@/services/productLotService";
import { makeUser, makeProduct, makeRecipe, makeIngredient } from "./helpers";

/**
 * ปิดงานผลิต = สำเร็จทั้งใบ หรือไม่เปลี่ยนอะไรเลย
 *   - วัตถุดิบไม่พอ "รวมทั้งใบ" → ไม่หักรายการไหนเลย (เดิมหักรายการแรก ๆ ไปแล้วค่อยล้ม)
 *   - actuals ส่งมาพร้อมปิดงาน → ล้มแล้วรายการไม่ถูกยกเลิก/แก้ค้างไว้
 *   - ขั้นสต็อกสินค้า/ล็อตล้ม → ใบยัง in_progress กดซ้ำทำต่อได้ (เดิมใบ done ไปแล้ว)
 */

const stockOf = async (id: unknown) => (await ingredientModel.findById(id).lean<{ current_stock: number }>())!.current_stock;
const productStockOf = async (id: unknown) =>
  (await productModel.findById(id).lean<{ product_stock_quantity: number | null }>())!.product_stock_quantity;

/** ใบสั่งผลิต (in_progress) — แต่ละรายการใช้วัตถุดิบตัวเดียว ชิ้นละ perUnit */
async function orderUsing(lines: Array<{ ingredient: { _id: unknown; unit_id: unknown }; perUnit: number; qty: number }>) {
  const admin = await makeUser();
  const rows = await Promise.all(
    lines.map(async (l) => {
      const product = await makeProduct({ product_stock_quantity: 0 });
      const recipe = await makeRecipe(String(product._id), {
        yield_qty: 1,
        ingredients: [{ ingredient_id: l.ingredient._id, quantity: l.perUnit, unit_id: l.ingredient.unit_id }],
      });
      return { product, recipe, qty: l.qty };
    })
  );
  const order = (await productionOrderService.createProductionOrder({
    production_date: new Date(),
    items: rows.map((r) => ({ product_id: String(r.product._id), recipe_id: String(r.recipe._id), planned_qty: r.qty })),
  })) as { _id: unknown };
  await productionOrderService.startProduction(String(order._id));
  const items = await productionItemModel.find({ production_order_id: order._id }).lean<Item[]>();
  const itemOf = (p: { _id: unknown }) => items.find((i) => String(i.product_id) === String(p._id))!;
  return { order, admin, rows, itemOf };
}

type Item = { _id: unknown; product_id: unknown; item_status: string; actual_qty?: number | null; stock_updated_at?: Date | null };

const statusOf = async (id: unknown) => (await productionOrderModel.findById(id).lean<{ production_status: string }>())!.production_status;

describe("completeProduction — ทั้งใบหรือไม่เลย", () => {
  it("วัตถุดิบพอทีละรายการแต่รวมกันไม่พอ → ไม่หักอะไรเลย ใบยัง in_progress", async () => {
    const butter = await makeIngredient({ ingredient_name: "เนย", current_stock: 15 });
    const { order, admin } = await orderUsing([
      { ingredient: butter, perUnit: 1, qty: 10 },
      { ingredient: butter, perUnit: 1, qty: 10 },
    ]);

    await expect(
      productionOrderService.completeProduction(String(order._id), { performed_by: String(admin._id) })
    ).rejects.toThrow(/สต็อกวัตถุดิบไม่พอ: เนย/);
    expect(await stockOf(butter._id)).toBe(15);
    expect(await statusOf(order._id)).toBe("in_progress");
    const items = await productionItemModel.find({ production_order_id: order._id }).lean<Item[]>();
    expect(items.every((i) => i.stock_updated_at == null)).toBe(true);
  });

  it("actuals: บันทึกพร้อมปิดงาน · 0 = ยกเลิกรายการ ไม่หัก/ไม่เพิ่มสต็อก · use_actual หักตามจริง", async () => {
    const flour = await makeIngredient({ current_stock: 100 });
    const { order, admin, rows, itemOf } = await orderUsing([
      { ingredient: flour, perUnit: 2, qty: 10 },
      { ingredient: flour, perUnit: 3, qty: 5 },
    ]);
    const [a, b] = rows;

    await productionOrderService.completeProduction(String(order._id), {
      performed_by: String(admin._id),
      use_actual: true,
      actuals: [
        { item_id: String(itemOf(a.product)._id), actual_qty: 8 },
        { item_id: String(itemOf(b.product)._id), actual_qty: 0 },
      ],
    });

    expect(await stockOf(flour._id)).toBe(100 - 16);
    expect(await productStockOf(a.product._id)).toBe(8);
    expect(await productStockOf(b.product._id)).toBe(0);
    const bItem = await productionItemModel.findById(itemOf(b.product)._id).lean<Item>();
    expect(bItem!.item_status).toBe("cancelled");
    expect(await statusOf(order._id)).toBe("done");
  });

  it("ปิดงานล้ม (วัตถุดิบไม่พอ) → actuals ที่ส่งมาไม่ถูกบันทึก รายการไม่ถูกยกเลิกค้าง", async () => {
    const sugar = await makeIngredient({ current_stock: 5 });
    const { order, admin, rows, itemOf } = await orderUsing([
      { ingredient: sugar, perUnit: 1, qty: 3 },
      { ingredient: sugar, perUnit: 1, qty: 10 },
    ]);
    const [a, b] = rows;

    await expect(
      productionOrderService.completeProduction(String(order._id), {
        performed_by: String(admin._id),
        actuals: [{ item_id: String(itemOf(a.product)._id), actual_qty: 0 }],
      })
    ).rejects.toThrow(/สต็อกวัตถุดิบไม่พอ/);

    const aItem = await productionItemModel.findById(itemOf(a.product)._id).lean<Item>();
    expect(aItem!.item_status).not.toBe("cancelled");
    expect(aItem!.actual_qty ?? null).toBeNull();
    expect(await stockOf(sugar._id)).toBe(5);
    void b;
  });

  it("actuals ผิด (รายการไม่อยู่ในใบ / ติดลบ) → 400 ก่อนแตะข้อมูล", async () => {
    const egg = await makeIngredient({ current_stock: 50 });
    const { order, admin, rows, itemOf } = await orderUsing([{ ingredient: egg, perUnit: 1, qty: 2 }]);
    const id = String(order._id);
    const by = String(admin._id);

    await expect(
      productionOrderService.completeProduction(id, { performed_by: by, actuals: [{ item_id: String(order._id), actual_qty: 1 }] })
    ).rejects.toThrow(/ไม่พบรายการผลิต/);
    await expect(
      productionOrderService.completeProduction(id, {
        performed_by: by,
        actuals: [{ item_id: String(itemOf(rows[0].product)._id), actual_qty: -1 }],
      })
    ).rejects.toThrow(/ไม่ติดลบ/);
    expect(await stockOf(egg._id)).toBe(50);
  });

  it("สร้างล็อตล้มหลังหักวัตถุดิบ → ใบยัง in_progress · กดซ้ำทำต่อโดยไม่หัก/เพิ่มสต็อกซ้ำ", async () => {
    const milk = await makeIngredient({ current_stock: 30 });
    const { order, admin, rows } = await orderUsing([{ ingredient: milk, perUnit: 2, qty: 5 }]);
    const id = String(order._id);
    const by = String(admin._id);

    const spy = vi.spyOn(productLotService, "createLotsForProduction").mockRejectedValueOnce(new Error("lot db down"));
    await expect(productionOrderService.completeProduction(id, { performed_by: by })).rejects.toThrow("lot db down");
    expect(await statusOf(order._id)).toBe("in_progress");
    expect(await stockOf(milk._id)).toBe(20);
    expect(await productStockOf(rows[0].product._id)).toBe(5);
    spy.mockRestore();

    await productionOrderService.completeProduction(id, { performed_by: by });
    expect(await statusOf(order._id)).toBe("done");
    expect(await stockOf(milk._id)).toBe(20);
    expect(await productStockOf(rows[0].product._id)).toBe(5);
  });

  it("ปิดงานค้างครึ่งทาง (เพิ่มสต็อกสินค้า/สร้างล็อตแล้ว) แล้วยกเลิก → คืนวัตถุดิบ ตัดสต็อกสินค้าคืน ลบล็อต", async () => {
    const cream = await makeIngredient({ current_stock: 30 });
    const { order, admin, rows } = await orderUsing([{ ingredient: cream, perUnit: 2, qty: 5 }]);
    const id = String(order._id);
    const by = String(admin._id);

    // ล็อตสร้างแล้วจริง แต่ปิดใบไม่สำเร็จ (ล้มหลังขั้นล็อต)
    const real = productLotService.createLotsForProduction;
    const spy = vi.spyOn(productLotService, "createLotsForProduction").mockImplementationOnce(async (...args) => {
      await real(...args);
      throw new Error("save failed");
    });
    await expect(productionOrderService.completeProduction(id, { performed_by: by })).rejects.toThrow("save failed");
    spy.mockRestore();
    expect(await statusOf(order._id)).toBe("in_progress");
    expect(await productStockOf(rows[0].product._id)).toBe(5);
    expect(await productLotModel.countDocuments({ production_order_id: order._id })).toBe(1);

    await productionOrderService.cancelProduction(id, { performed_by: by });
    expect(await statusOf(order._id)).toBe("cancelled");
    expect(await stockOf(cream._id)).toBe(30);
    expect(await productStockOf(rows[0].product._id)).toBe(0);
    expect(await productLotModel.countDocuments({ production_order_id: order._id })).toBe(0);
  });
});
