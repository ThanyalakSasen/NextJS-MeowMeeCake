import { describe, it, expect } from "vitest";
import * as recipeService from "@/services/recipeService";
import { makeProduct, makeRecipe } from "./helpers";

/**
 * BACKLOG §3.16 — purchase_cost fallback
 * getUnitCostByProduct() ลำดับความสำคัญ: สูตร (ล่าสุด, yield_qty > 0) → product.purchase_cost → null
 *
 * BACKLOG §3.11 เฟส 4 — ตั้งแต่เฟสนี้ทั้ง recipeModel.estimated_cost_per_batch และ
 * productModel.purchase_cost เก็บเป็นสตางค์ทั้งคู่ แต่เทสนี้สร้างข้อมูลตรงผ่าน model (ข้าม
 * service ที่แปลงให้) จึงยังใช้ตัวเลขเดิมได้ตรง ๆ — ฟังก์ชันนี้แค่หาร/เทียบค่าที่ query มา ไม่เคย
 * แปลงหน่วยเอง (ดู comment ที่ recipeService.getUnitCostByProduct) ผลลัพธ์จึงยังตรงกับก่อนแก้เฟส 4
 * ทุกตัวเลข — สิ่งที่เปลี่ยนคือแค่ "ความหมาย" ของหน่วย (เดิมนัยเป็นบาท ตอนนี้นัยเป็นสตางค์)
 */
describe("recipeService.getUnitCostByProduct — purchase_cost fallback (BACKLOG §3.16)", () => {
  it("มีสูตรที่ yield_qty > 0 → ใช้ต้นทุนจากสูตร ไม่สนใจ purchase_cost", async () => {
    const p = await makeProduct({ purchase_cost: 999 });
    await makeRecipe(String(p._id), { estimated_cost_per_batch: 100, yield_qty: 10 });

    const out = await recipeService.getUnitCostByProduct([String(p._id)]);
    expect(out.get(String(p._id))).toBe(10); // 100/10 จากสูตร ไม่ใช่ 999
  });

  it("ไม่มีสูตรเลย แต่มี purchase_cost → fallback ใช้ purchase_cost", async () => {
    const p = await makeProduct({ purchase_cost: 45 });

    const out = await recipeService.getUnitCostByProduct([String(p._id)]);
    expect(out.get(String(p._id))).toBe(45);
  });

  it("มีสูตรแต่ yield_qty = 0 (คำนวณไม่ได้) + มี purchase_cost → fallback ใช้ purchase_cost", async () => {
    const p = await makeProduct({ purchase_cost: 30 });
    await makeRecipe(String(p._id), { estimated_cost_per_batch: 100, yield_qty: 0 });

    const out = await recipeService.getUnitCostByProduct([String(p._id)]);
    expect(out.get(String(p._id))).toBe(30);
  });

  it("ไม่มีทั้งสูตรและ purchase_cost → null (เหมือนเดิมก่อนแก้)", async () => {
    const p = await makeProduct({ purchase_cost: null });

    const out = await recipeService.getUnitCostByProduct([String(p._id)]);
    expect(out.get(String(p._id))).toBeNull();
  });
});
