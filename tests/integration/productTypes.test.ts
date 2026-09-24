import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import productModel from "@/models/productModel";
import productCategoryModel from "@/models/productCategoryModel";
import unitModel from "@/models/unitModel";
import * as productService from "@/services/productService";
import type { CreateProductInput } from "@/services/productService";
import { runMigration } from "../../scripts/migrate-product-types";
import { makeProduct } from "./helpers";

/**
 * docs/BACKLOG2.md §14 — product_type (string) → product_types (array)
 *   - inStore+online เลือกพร้อมกันได้, preorder ต้องอยู่เดี่ยว ๆ
 *   - updateProduct สร้าง product_id ใหม่เมื่อ prefix (pos-/pre-) ไม่ตรงกับประเภทใหม่
 *   - scripts/migrate-product-types.ts แปลงข้อมูลเก่า
 */

const PREORDER_CONFIG = { min_order_qty: 1, max_order_qty: 5, lead_time_days: 3 };

async function baseInput(over: Partial<CreateProductInput> = {}): Promise<CreateProductInput> {
  const cat = await productCategoryModel.create({ product_category_name: `หมวด-${Date.now()}-${Math.random()}` });
  const unit = await unitModel.create({
    unit_name: `หน่วย-${Date.now()}-${Math.random()}`,
    unit_abbr: "u",
    unit_type: "Custom",
    usage_context: ["Product"],
  });
  return {
    product_name_th: "เค้ก",
    product_name_eng: "Cake",
    category_id: String(cat._id),
    product_price: 100,
    unit_id: String(unit._id),
    product_types: ["inStore"],
    ...over,
  };
}

type Created = { _id: unknown; product_id: string; product_types: string[]; product_stock_quantity: number | null };

describe("productService — product_types", () => {
  it("inStore+online พร้อมกันได้ → prefix pos- มีสต็อก + ตัดค่าซ้ำ", async () => {
    const p = (await productService.createProduct(
      await baseInput({ product_types: ["inStore", "online", "online"], product_stock_quantity: 7 })
    )) as Created;
    expect(p.product_types).toEqual(["inStore", "online"]);
    expect(p.product_id).toMatch(/^pos-/);
    expect(p.product_stock_quantity).toBe(7);
  });

  it("preorder ผสมกับประเภทอื่น → 400", async () => {
    await expect(
      productService.createProduct(
        await baseInput({ product_types: ["preorder", "online"], preorder_config: PREORDER_CONFIG })
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it("ส่งฟิลด์เก่า product_type มา → 400 ไม่ทิ้งเงียบ ๆ", async () => {
    const input = await baseInput();
    delete (input as Partial<CreateProductInput>).product_types;
    (input as unknown as Record<string, unknown>).product_type = "inStore";
    await expect(productService.createProduct(input)).rejects.toMatchObject({ status: 400 });

    const p = await makeProduct();
    await expect(
      productService.updateProduct(String(p._id), { product_type: "preorder" } as never)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("updateProduct: เปลี่ยนเป็น preorder → รหัสใหม่ขึ้นต้น pre- และสต็อกเป็น null", async () => {
    const p = (await productService.createProduct(await baseInput({ product_stock_quantity: 3 }))) as Created;
    expect(p.product_id).toMatch(/^pos-/);

    const u = (await productService.updateProduct(String(p._id), {
      product_types: ["preorder"],
      product_stock_quantity: null, // ต้องล้างสต็อกเองชัด ๆ (กันสต็อกหายเงียบ ๆ — พฤติกรรมเดิม)
      preorder_config: PREORDER_CONFIG,
    })) as Created;
    expect(u.product_types).toEqual(["preorder"]);
    expect(u.product_id).toMatch(/^pre-/);
    expect(u.product_stock_quantity).toBeNull();
  });

  it("updateProduct: inStore → inStore+online (prefix เดิม) → รหัสไม่เปลี่ยน", async () => {
    const p = (await productService.createProduct(await baseInput())) as Created;
    const u = (await productService.updateProduct(String(p._id), {
      product_types: ["inStore", "online"],
    })) as Created;
    expect(u.product_id).toBe(p.product_id);
    expect(u.product_types).toEqual(["inStore", "online"]);
  });

  it('getProducts ?product_type=online เจอสินค้าที่มี online อยู่ใน array', async () => {
    await makeProduct({ product_types: ["inStore", "online"] });
    await makeProduct({ product_types: ["inStore"] });
    const res = await productService.getProducts({
      pagination: { page: 1, limit: 20, skip: 0 },
      product_type: "online",
    } as never);
    expect(res.items).toHaveLength(1);
  });
});

describe("scripts/migrate-product-types", () => {
  it("แปลง product_type → product_types (รวม ready→inStore), รายงาน prefix ไม่ตรง, รันซ้ำข้าม", async () => {
    const col = mongoose.connection.db!.collection("products");
    await col.insertMany([
      { product_id: "pos-0126001", product_type: "inStore" },
      { product_id: "pos-0126002", product_type: "ready" },
      { product_id: "pos-0126003", product_type: "preorder" }, // prefix ผิด (§14)
      { product_id: "pre-0126004", product_type: "preorder" },
      { product_id: "pos-0126005", product_types: ["online"] }, // ของใหม่ ไม่แตะ
      { product_id: "pos-0126006" }, // ไม่มีประเภท → unresolved
    ]);

    const r1 = await runMigration();
    expect(r1.migrated).toBe(4);
    expect(r1.unresolved.map((u) => u.product_id)).toEqual(["pos-0126006"]);
    expect(r1.prefixMismatch.map((m) => m.product_id)).toEqual(["pos-0126003"]);

    const docs = await col.find({}, { sort: { product_id: 1 } }).toArray();
    expect(docs.map((d) => d.product_types)).toEqual([
      ["inStore"],
      ["inStore"],
      ["preorder"], // pos-0126003
      ["online"],
      undefined,
      ["preorder"], // pre-0126004 (เรียงหลัง pos-)
    ]);
    expect(docs.every((d) => !("product_type" in d))).toBe(true);

    const r2 = await runMigration();
    expect(r2.migrated).toBeNull();
    expect(await productModel.countDocuments({ product_types: "preorder" })).toBe(2);
  });
});
