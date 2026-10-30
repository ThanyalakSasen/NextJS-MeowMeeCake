import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import stockRequestModel from "@/models/stockRequestModel";
import * as productService from "@/services/productService";
import { parseRequestKey, stockRequestOnce } from "@/lib/stockRequestOnce";
import { makeProduct } from "./helpers";

/** ข้อ 13: รับเข้าแล้ว timeout → กดซ้ำบวกซ้ำ · ตั้งยอดทับยอดที่ POS ขายแทรก */
const stockOf = async (id: unknown) =>
  (await productModel.findById(id).lean<{ product_stock_quantity: number | null }>())!.product_stock_quantity;

describe("stockRequestOnce — request_key กันปรับสต็อกซ้ำ", () => {
  it("key เดิมทำเสร็จแล้ว = คืนผลเดิม ไม่บวกซ้ำ", async () => {
    const p = await makeProduct({ product_stock_quantity: 10 });
    const id = String(p._id);
    const run = () => productService.adjustStock(id, 5);

    const first = await stockRequestOnce("recv-key-0001", id, run);
    const again = await stockRequestOnce("recv-key-0001", id, run);
    expect(first.replay).toBe(false);
    expect(again.replay).toBe(true);
    expect((again.result as { product_stock_quantity: number }).product_stock_quantity).toBe(15);
    expect(await stockOf(p._id)).toBe(15);
  });

  it("ทำไม่สำเร็จ = ลบ key ลองใหม่ด้วย key เดิมได้", async () => {
    const p = await makeProduct({ product_stock_quantity: 2 });
    const id = String(p._id);

    await expect(stockRequestOnce("use-key-0001", id, () => productService.adjustStock(id, -5))).rejects.toMatchObject({
      status: 409,
    });
    expect(await stockRequestModel.findById("use-key-0001")).toBeNull();
    const ok = await stockRequestOnce("use-key-0001", id, () => productService.adjustStock(id, -1));
    expect(ok.replay).toBe(false);
    expect(await stockOf(p._id)).toBe(1);
  });

  it("key ค้าง pending = 409 STOCK_REQUEST_PENDING ไม่ทำซ้ำ", async () => {
    const p = await makeProduct({ product_stock_quantity: 3 });
    const id = String(p._id);
    await stockRequestModel.create({ _id: "pend-key-0001", product_id: id, expire_at: new Date(Date.now() + 60_000) });

    await expect(stockRequestOnce("pend-key-0001", id, () => productService.adjustStock(id, 1))).rejects.toMatchObject({
      status: 409,
      details: { reason: "STOCK_REQUEST_PENDING" },
    });
    expect(await stockOf(p._id)).toBe(3);
  });

  it("key เดียวกันกับสินค้าอื่น = 400", async () => {
    const a = await makeProduct({ product_stock_quantity: 1 });
    const b = await makeProduct({ product_stock_quantity: 1 });
    await stockRequestOnce("same-key-0001", String(a._id), () => productService.adjustStock(String(a._id), 1));
    await expect(
      stockRequestOnce("same-key-0001", String(b._id), () => productService.adjustStock(String(b._id), 1))
    ).rejects.toMatchObject({ status: 400 });
    expect(await stockOf(b._id)).toBe(1);
  });

  it("parseRequestKey: ว่าง = ไม่ใช้ · รูปแบบผิด = 400", () => {
    expect(parseRequestKey(undefined)).toBeUndefined();
    expect(parseRequestKey("")).toBeUndefined();
    expect(parseRequestKey("abc-DEF_12345")).toBe("abc-DEF_12345");
    expect(() => parseRequestKey("short")).toThrow();
    expect(() => parseRequestKey("has space 1234")).toThrow();
    expect(() => parseRequestKey(123)).toThrow();
  });
});

describe("setStockDetailed expected — ไม่ทับยอดที่เปลี่ยนไประหว่างเปิดฟอร์ม", () => {
  it("ยอดยังเท่า expected = ตั้งได้", async () => {
    const p = await makeProduct({ product_stock_quantity: 10 });
    await productService.setStockDetailed(String(p._id), 7, {}, { expected: 10 });
    expect(await stockOf(p._id)).toBe(7);
  });

  it("ยอดเปลี่ยนแล้ว (ขายแทรก) = 409 STOCK_CHANGED + current · ยอดไม่ถูกทับ", async () => {
    const p = await makeProduct({ product_stock_quantity: 10 });
    const id = String(p._id);
    await productService.adjustStock(id, -3); // POS ขายระหว่างเปิดฟอร์ม
    await expect(productService.setStockDetailed(id, 12, {}, { expected: 10 })).rejects.toMatchObject({
      status: 409,
      details: { reason: "STOCK_CHANGED", current: 7 },
    });
    expect(await stockOf(p._id)).toBe(7);
  });

  it("expected 0 ตรงกับสินค้าที่ยอดยังเป็น null", async () => {
    const p = await makeProduct({ product_stock_quantity: null });
    await productService.setStockDetailed(String(p._id), 4, {}, { expected: 0 });
    expect(await stockOf(p._id)).toBe(4);
  });

  it("ไม่ส่ง expected = ตั้งทับเหมือนเดิม", async () => {
    const p = await makeProduct({ product_stock_quantity: 10 });
    await productService.setStockDetailed(String(p._id), 1);
    expect(await stockOf(p._id)).toBe(1);
  });
});
