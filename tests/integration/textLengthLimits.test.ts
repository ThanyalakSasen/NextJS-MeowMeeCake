import { describe, it, expect } from "vitest";
import * as productService from "@/services/productService";
import * as productionOrderService from "@/services/productionOrderService";
import { makeProduct } from "./helpers";

/** เพดานความยาวข้อความที่เดิมไม่จำกัด — ชื่อ/คำอธิบายสินค้า · หมายเหตุใบสั่งผลิต */

const long = (n: number) => "ก".repeat(n);

describe("สินค้า", () => {
  it("ชื่อเกิน 200 / คำอธิบายเกิน 2000 → 400 · พอดีเพดานผ่าน", async () => {
    const p = await makeProduct();
    const id = String(p._id);
    await expect(productService.updateProduct(id, { product_name_th: long(201) })).rejects.toMatchObject({ status: 400 });
    await expect(productService.updateProduct(id, { product_name_eng: "a".repeat(201) })).rejects.toMatchObject({ status: 400 });
    await expect(productService.updateProduct(id, { product_description: long(2001) })).rejects.toMatchObject({ status: 400 });
    await productService.updateProduct(id, { product_name_th: long(200), product_description: long(2000) });
  });
});

describe("ใบสั่งผลิต", () => {
  it("หมายเหตุเกิน 1000 → 400 ทั้งสร้างและแก้", async () => {
    await expect(
      productionOrderService.createProductionOrder({ production_date: new Date(), production_note: long(1001) } as never)
    ).rejects.toMatchObject({ status: 400 });
    const order = (await productionOrderService.createProductionOrder({ production_date: new Date(), production_note: long(1000) } as never)) as {
      _id: unknown;
    };
    await expect(
      productionOrderService.updateProductionOrder(String(order._id), { production_note: long(1001) })
    ).rejects.toMatchObject({ status: 400 });
  });
});
