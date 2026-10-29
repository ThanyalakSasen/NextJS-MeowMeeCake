import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import * as productService from "@/services/productService";
import { makeProduct } from "./helpers";

/** สต็อกสินค้านับเป็นชิ้น — ทุกทางที่แก้ยอดต้องเป็นจำนวนเต็ม (เดิมยิง API ตรงตั้ง 1.5 ชิ้นได้) */
const stockOf = async (id: unknown) =>
  (await productModel.findById(id).lean<{ product_stock_quantity: number | null }>())!.product_stock_quantity;

describe("product stock ต้องเป็นจำนวนเต็ม", () => {
  it("ตั้งยอด / เพิ่ม / ลด / ปรับส่วนต่าง: มีเศษ → 400 ยอดไม่เปลี่ยน", async () => {
    const p = await makeProduct({ product_stock_quantity: 10 });
    const id = String(p._id);

    await expect(productService.setStockDetailed(id, 2.5)).rejects.toMatchObject({ status: 400 });
    await expect(productService.increaseStock(id, 0.5)).rejects.toMatchObject({ status: 400 });
    await expect(productService.decreaseStock(id, 1.5)).rejects.toMatchObject({ status: 400 });
    await expect(productService.adjustStock(id, -0.5)).rejects.toMatchObject({ status: 400 });
    expect(await stockOf(p._id)).toBe(10);

    await productService.adjustStock(id, 3);
    expect(await stockOf(p._id)).toBe(13);
  });
});
