import { describe, it, expect } from "vitest";
import recipeModel from "@/models/recipeModel";
import * as productionOrderService from "@/services/productionOrderService";
import { recipeService } from "@/services/recipeService";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/** สูตรที่ยังอยู่ในใบสั่งผลิตที่ยังไม่จบลบไม่ได้ (ผู้ใช้ขอ 2026-10-30) — ใบเสร็จ/ยกเลิกแล้วไม่นับ */
async function orderUsing(recipeId: string, productId: string) {
  const order = (await productionOrderService.createProductionOrder({
    production_date: new Date(),
    items: [{ product_id: productId, recipe_id: recipeId, planned_qty: 2 }],
  })) as { _id: unknown; production_no: string };
  return { id: String(order._id), no: order.production_no };
}
const deletedAt = async (id: unknown) => (await recipeModel.findById(id).lean<{ deleted_at: Date | null }>())?.deleted_at;

describe("ลบสูตร", () => {
  it("อยู่ในใบรอดำเนินการ/กำลังผลิต → 409 บอกเลขใบ · ปิดงานแล้ว → ลบได้", async () => {
    const product = await makeProduct({ product_stock_quantity: 0 });
    const recipe = await makeRecipe(String(product._id));
    const rid = String(recipe._id);
    const order = await orderUsing(rid, String(product._id));

    await expect(recipeService.remove(rid)).rejects.toMatchObject({ status: 409, message: expect.stringContaining(order.no) });
    await productionOrderService.startProduction(order.id);
    await expect(recipeService.remove(rid)).rejects.toMatchObject({ status: 409 });
    expect(await deletedAt(recipe._id)).toBeNull();

    const admin = await makeUser();
    await productionOrderService.completeProduction(order.id, { performed_by: String(admin._id) });
    await recipeService.remove(rid);
    expect(await deletedAt(recipe._id)).not.toBeNull();
  });

  it("ใบถูกยกเลิก / ไม่อยู่ในใบไหน → ลบได้", async () => {
    const product = await makeProduct();
    const recipe = await makeRecipe(String(product._id));
    const order = await orderUsing(String(recipe._id), String(product._id));
    await productionOrderService.cancelProduction(order.id);
    await expect(recipeService.remove(String(recipe._id))).resolves.toBeTruthy();

    const unused = await makeRecipe(String(product._id));
    await expect(recipeService.remove(String(unused._id))).resolves.toBeTruthy();
  });
});
