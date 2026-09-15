import { describe, it, expect } from "vitest";
import ingredientModel from "@/models/ingredientModel";
import ingredientTransactionModel from "@/models/ingredientTransactionModel";
import productionOrderModel from "@/models/productionOrderModel";
import productionItemModel from "@/models/productionItemModel";
import * as ingredientTransactionService from "@/services/ingredientTransactionService";
import * as productionItemService from "@/services/productionItemService";
import { makeUser, makeIngredient, makeProduct, makeRecipe } from "./helpers";

async function currentStock(ingredientId: unknown): Promise<number> {
  const doc = await ingredientModel
    .findById(ingredientId)
    .lean<{ current_stock: number } | null>();
  return doc!.current_stock;
}

async function makeProductionSetup() {
  const user = await makeUser();
  const ingredient = await makeIngredient({ current_stock: 100 });
  const product = await makeProduct();
  const recipe = await makeRecipe(String(product._id), {
    yield_qty: 10,
    ingredients: [{ ingredient_id: ingredient._id, quantity: 5, unit_id: ingredient.unit_id }],
  });
  const order = await productionOrderModel.create({
    production_no: `PO-TEST-${Date.now()}-${Math.random()}`,
    production_date: new Date(),
    source_type: "manual",
  });
  const item = await productionItemModel.create({
    production_order_id: order._id,
    product_id: product._id,
    recipe_id: recipe._id,
    planned_qty: 10, // scale = planned_qty/yield_qty = 1 -> qty_consumed = 5
  });
  return { user, ingredient, item };
}

/**
 * BACKLOG §2c.3 — voidTransaction ไม่มี back-reference กลับไปที่ production item ทำให้เครดิตสต็อกซ้ำได้:
 * 1) consumeStock() หักสต็อก + สร้าง ingredientTransaction type "use"
 * 2) แอดมินไป void ธุรกรรมนั้นตรง ๆ ผ่าน /api/admin/ingredient-transactions/[id] (คืนสต็อกกลับ)
 * 3) แอดมิน (คนละคน/ไม่รู้ว่า void ไปแล้ว) กด reverse-stock ที่หน้ารายการผลิตอีกที เพราะ
 *    productionItem.stock_updated_at ยังไม่ถูกเคลียร์ (voidTransaction ไม่รู้จัก productionItem)
 *    → สต็อกถูกเครดิตกลับสองครั้งจากการเบิกครั้งเดียว
 * แก้โดยผูก production_item_id ไว้กับธุรกรรมที่มาจาก consumeStock/reverseStock แล้วปฏิเสธ
 * voidTransaction() บนธุรกรรมที่มี back-ref นี้ — บังคับให้ยกเลิกผ่าน reverse-stock เท่านั้น
 */
describe("ingredientTransactionService x productionItemService — กัน double-credit (BACKLOG §2c.3)", () => {
  it("consumeStock สร้างธุรกรรมพร้อมผูก production_item_id", async () => {
    const { ingredient, item } = await makeProductionSetup();

    await productionItemService.consumeStock(String(item._id), {
      performed_by: String((await makeUser())._id),
    });

    expect(await currentStock(ingredient._id)).toBe(95);

    const txn = await ingredientTransactionModel
      .findOne({ ingredient_id: ingredient._id, type: "use", deleted_at: null })
      .lean<{ production_item_id: unknown } | null>();
    expect(String(txn?.production_item_id)).toBe(String(item._id));
  });

  it("void ธุรกรรมที่ผูกกับการผลิตโดยตรง → conflict, สต็อกไม่เปลี่ยน (กันเครดิตซ้ำ)", async () => {
    const { user, ingredient, item } = await makeProductionSetup();
    await productionItemService.consumeStock(String(item._id), { performed_by: String(user._id) });
    expect(await currentStock(ingredient._id)).toBe(95);

    const txn = await ingredientTransactionModel.findOne({
      ingredient_id: ingredient._id,
      type: "use",
      deleted_at: null,
    });

    await expect(
      ingredientTransactionService.voidTransaction(String(txn!._id))
    ).rejects.toThrow(/การผลิต/);

    // สต็อกไม่เปลี่ยน — ยังไม่ได้เครดิตกลับ (ต้องไปทำผ่าน reverse-stock)
    expect(await currentStock(ingredient._id)).toBe(95);
  });

  it("reverse-stock ที่หน้ารายการผลิต (ทางที่ถูก) ยังทำงานปกติ — เครดิตกลับครั้งเดียว", async () => {
    const { user, ingredient, item } = await makeProductionSetup();
    await productionItemService.consumeStock(String(item._id), { performed_by: String(user._id) });
    expect(await currentStock(ingredient._id)).toBe(95);

    await productionItemService.reverseStock(String(item._id), { performed_by: String(user._id) });
    expect(await currentStock(ingredient._id)).toBe(100);

    // reverse-stock เองก็ผูก production_item_id ให้ธุรกรรม "receive" ที่มันสร้างด้วย
    const receiveTxn = await ingredientTransactionModel
      .findOne({ ingredient_id: ingredient._id, type: "receive", deleted_at: null })
      .lean<{ production_item_id: unknown } | null>();
    expect(String(receiveTxn?.production_item_id)).toBe(String(item._id));
  });

  it("createTransaction ที่ production_item_id ไม่มีอยู่จริง → notFound", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient();

    await expect(
      ingredientTransactionService.createTransaction({
        ingredient_id: String(ingredient._id),
        type: "receive",
        qty: 1,
        performed_by: String(user._id),
        production_item_id: String(ingredient._id), // id ที่มีอยู่จริงแต่ไม่ใช่ production item
      })
    ).rejects.toThrow(/ไม่พบรายการผลิต/);
  });

  it("ธุรกรรมที่บันทึกมือปกติ (ไม่มี production_item_id) ยัง void ได้ตามเดิม", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 10 });

    const result = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "receive",
      qty: 20,
      performed_by: String(user._id),
    });
    expect(await currentStock(ingredient._id)).toBe(30);

    await ingredientTransactionService.voidTransaction(String(result.transaction._id));
    expect(await currentStock(ingredient._id)).toBe(10);
  });
});
