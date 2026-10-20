import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import { increaseStock, decreaseStock, getStock, restockForOrder } from "@/services/productService";
import { makeProduct } from "./helpers";

/**
 * สินค้าปกติที่ product_stock_quantity เป็น null / ไม่มีฟิลด์ (เขียนนอกแอป) — เดิมรับเข้าสต็อกแล้ว 500
 * "Cannot apply $inc to a value of non-numeric type" · ตอนนี้นับเป็น 0 แล้วบวกต่อ
 */
async function productWithStock(value: null | "missing") {
  const p = await makeProduct({ product_stock_quantity: 5 });
  await productModel.collection.updateOne(
    { _id: p._id },
    value === "missing" ? { $unset: { product_stock_quantity: "" } } : { $set: { product_stock_quantity: null } }
  );
  return String(p._id);
}

describe("สต็อกสินค้าที่เป็น null", () => {
  it("รับเข้าสต็อก: null → 0 + จำนวนที่รับ · ไม่มีฟิลด์ก็เหมือนกัน", async () => {
    const a = await productWithStock(null);
    expect((await increaseStock(a, 20)).product_stock_quantity).toBe(20);
    expect(await getStock(a)).toBe(20);

    const b = await productWithStock("missing");
    expect((await increaseStock(b, 3)).product_stock_quantity).toBe(3);
  });

  it("เบิกใช้จากสต็อก null → สต็อกไม่พอ (409) ไม่ใช่ 500 · คืนสต็อกจากออเดอร์ยกเลิกได้", async () => {
    const a = await productWithStock(null);
    await expect(decreaseStock(a, 1)).rejects.toMatchObject({ status: 409 });
    const res = await restockForOrder([{ product_id: a, quantity: 2 }]);
    expect(res.restocked).toEqual([{ product_id: a, quantity: 2 }]);
    expect(await getStock(a)).toBe(2);
  });
});
