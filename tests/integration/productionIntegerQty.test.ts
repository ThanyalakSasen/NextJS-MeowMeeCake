import { describe, it, expect } from "vitest";
import productionItemModel from "@/models/productionItemModel";
import * as productionOrderService from "@/services/productionOrderService";
import * as productionItemService from "@/services/productionItemService";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * จำนวนผลิต = จำนวนชิ้น ต้องเป็นจำนวนเต็ม (หน้าเว็บล็อก precision 0 แล้ว — backend กันซ้ำกันยิง API ตรง)
 * เดิมรับ 1.5 ได้ → ปิดงานแล้วสต็อกสินค้าเป็นเศษชิ้น
 */
async function line() {
  const product = await makeProduct({ product_stock_quantity: 0 });
  const recipe = await makeRecipe(String(product._id));
  return { product_id: String(product._id), recipe_id: String(recipe._id) };
}

describe("production qty ต้องเป็นจำนวนเต็ม", () => {
  it("สร้างใบ / เพิ่มรายการ: planned_qty มีเศษ → 400", async () => {
    await expect(
      productionOrderService.createProductionOrder({ production_date: new Date(), items: [{ ...(await line()), planned_qty: 1.5 }] })
    ).rejects.toThrow(/จำนวนเต็ม/);

    const order = (await productionOrderService.createProductionOrder({
      production_date: new Date(),
      items: [{ ...(await line()), planned_qty: 2 }],
    })) as { _id: unknown };
    await expect(productionItemService.addItem(String(order._id), { ...(await line()), planned_qty: 0.5 })).rejects.toThrow(
      /จำนวนเต็ม/
    );
  });

  it("แก้รายการ / ปิดงาน: planned_qty, actual_qty มีเศษ → 400", async () => {
    const admin = await makeUser();
    const order = (await productionOrderService.createProductionOrder({
      production_date: new Date(),
      items: [{ ...(await line()), planned_qty: 3 }],
    })) as { _id: unknown };
    const item = (await productionItemModel.findOne({ production_order_id: order._id }).lean<{ _id: unknown }>())!;

    await expect(productionItemService.updateItem(String(item._id), { planned_qty: 2.5 })).rejects.toThrow(/จำนวนเต็ม/);
    await expect(productionItemService.updateItem(String(item._id), { actual_qty: 1.2 })).rejects.toThrow(/จำนวนเต็ม/);
    await expect(productionItemService.updateItem(String(item._id), { planned_qty: 4 })).resolves.toMatchObject({ planned_qty: 4 });

    await productionOrderService.startProduction(String(order._id));
    await expect(
      productionOrderService.completeProduction(String(order._id), {
        performed_by: String(admin._id),
        actuals: [{ item_id: String(item._id), actual_qty: 3.5 }],
      })
    ).rejects.toThrow(/จำนวนเต็ม/);
  });
});
