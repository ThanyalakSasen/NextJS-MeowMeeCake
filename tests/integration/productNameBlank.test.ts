import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import productCategoryModel from "@/models/productCategoryModel";
import unitModel from "@/models/unitModel";
import * as productService from "@/services/productService";
import type { CreateProductInput } from "@/services/productService";
import { makeProduct } from "./helpers";

/** ชื่อสินค้าต้องไม่ว่าง/ช่องว่างล้วน ทั้งตอนสร้างและแก้ไข · ตัดช่องว่างหัวท้ายก่อนบันทึก (route ไม่ผ่าน zod) */
async function baseInput(over: Partial<CreateProductInput> = {}): Promise<CreateProductInput> {
  const cat = await productCategoryModel.create({ product_category_name: `หมวด-${Date.now()}-${Math.random()}` });
  const unit = await unitModel.create({
    unit_name: `หน่วย-${Date.now()}-${Math.random()}`,
    unit_abbr: `u${Math.random().toString(36).slice(2, 8)}`,
    unit_type: "Custom",
    usage_context: ["Product"],
  });
  return {
    product_name_th: "เค้ก",
    product_name_eng: "Cake",
    category_id: String(cat._id),
    product_price: 100,
    unit_id: String(unit._id),
    ...over,
  };
}

describe("product name ต้องไม่ว่าง", () => {
  it("สร้าง: ช่องว่างล้วน → 400 · มีช่องว่างหัวท้าย → ตัดออก", async () => {
    await expect(productService.createProduct(await baseInput({ product_name_th: "   " }))).rejects.toMatchObject({ status: 400 });
    await expect(productService.createProduct(await baseInput({ product_name_eng: " \t " }))).rejects.toMatchObject({ status: 400 });

    const p = (await productService.createProduct(await baseInput({ product_name_th: "  บราวนี่  " }))) as { _id: unknown };
    const saved = await productModel.findById(p._id).lean<{ product_name_th: string }>();
    expect(saved!.product_name_th).toBe("บราวนี่");
  });

  it("แก้ไข: ตั้งชื่อเป็นว่าง/ช่องว่างล้วน → 400 ชื่อเดิมไม่เปลี่ยน", async () => {
    const p = await makeProduct({ product_name_th: "ชีสเค้ก" });
    await expect(productService.updateProduct(String(p._id), { product_name_th: "" })).rejects.toMatchObject({ status: 400 });
    await expect(productService.updateProduct(String(p._id), { product_name_th: "   " })).rejects.toMatchObject({ status: 400 });
    const saved = await productModel.findById(p._id).lean<{ product_name_th: string }>();
    expect(saved!.product_name_th).toBe("ชีสเค้ก");
  });
});
