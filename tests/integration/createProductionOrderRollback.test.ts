import { describe, it, expect } from "vitest";
import productionOrderModel from "@/models/productionOrderModel";
import productionItemModel from "@/models/productionItemModel";
import * as productionOrderService from "@/services/productionOrderService";
import { makeProduct, makeRecipe } from "./helpers";

/**
 * BACKLOG2 §10 — ไล่เทียบ productionOrderService กับ orderService.persistOrder()/
 * preorderService.createPreorder() (ทั้งคู่ห่อ "สร้าง header แล้วค่อยสร้าง child items" ด้วย Saga)
 * พบว่า createProductionOrder() ไม่มี — สร้างใบสั่งผลิต (header) ก่อน แล้วค่อยเรียก
 * productionItemService.addItems() ซึ่ง validate recipe_id ↔ product_id ตอน*หลัง*สร้าง header ไปแล้ว
 * (ต่างจาก preorderRoundService.createRound() ที่ validate items ให้ครบก่อนสร้าง header) —
 * ถ้า addItems() throw จะเหลือใบสั่งผลิต "planned" ที่ไม่มีรายการค้างอยู่ตลอดไป แก้ด้วย Saga
 * rollback header เมื่อ addItems() ล้มเหลว
 */
describe("productionOrderService.createProductionOrder — rollback header เมื่อ items ผิด (BACKLOG2 §10)", () => {
  it("recipe_id ไม่ตรงกับ product_id ของรายการ → throw + ไม่เหลือใบสั่งผลิตค้างใน DB", async () => {
    const productA = await makeProduct();
    const productB = await makeProduct();
    const recipeOfA = await makeRecipe(String(productA._id));

    const countBefore = await productionOrderModel.countDocuments({});

    await expect(
      productionOrderService.createProductionOrder({
        production_date: new Date(),
        items: [
          {
            product_id: String(productB._id),
            recipe_id: String(recipeOfA._id), // สูตรของ productA แต่ระบุ productB — ต้องพัง
            planned_qty: 5,
          },
        ],
      })
    ).rejects.toThrow(/สูตรที่เลือกไม่ตรงกับสินค้า/);

    const countAfter = await productionOrderModel.countDocuments({});
    expect(countAfter).toBe(countBefore); // ไม่เหลือ header ค้าง

    const orphanItems = await productionItemModel.countDocuments({});
    expect(orphanItems).toBe(0);
  });

  it("items ถูกต้องทั้งหมด → สร้างสำเร็จปกติ ไม่ rollback", async () => {
    const product = await makeProduct();
    const recipe = await makeRecipe(String(product._id));

    const result = await productionOrderService.createProductionOrder({
      production_date: new Date(),
      items: [{ product_id: String(product._id), recipe_id: String(recipe._id), planned_qty: 5 }],
    });

    expect(result.items).toHaveLength(1);
    const found = await productionOrderModel.findById(result._id).lean();
    expect(found).not.toBeNull();
  });

  it("รายการที่ 2 ใน items ผิด (รายการที่ 1 ถูก) → ทั้งชุดถูก rollback ไม่มีรายการค้างเหลือแม้แต่รายการเดียว", async () => {
    const productA = await makeProduct();
    const productB = await makeProduct();
    const recipeOfA = await makeRecipe(String(productA._id));

    const countBefore = await productionOrderModel.countDocuments({});

    await expect(
      productionOrderService.createProductionOrder({
        production_date: new Date(),
        items: [
          { product_id: String(productA._id), recipe_id: String(recipeOfA._id), planned_qty: 2 },
          { product_id: String(productB._id), recipe_id: String(recipeOfA._id), planned_qty: 3 }, // ผิด
        ],
      })
    ).rejects.toThrow(/สูตรที่เลือกไม่ตรงกับสินค้า/);

    expect(await productionOrderModel.countDocuments({})).toBe(countBefore);
    expect(await productionItemModel.countDocuments({})).toBe(0);
  });
});
