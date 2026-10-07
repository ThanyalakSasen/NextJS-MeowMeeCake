import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import productModel from "@/models/productModel";
import productCategoryModel from "@/models/productCategoryModel";
import unitModel from "@/models/unitModel";
import * as productService from "@/services/productService";
import type { CreateProductInput } from "@/services/productService";
import { runMigration } from "../../scripts/migrate-is-preorder";
import { makeProduct } from "./helpers";

/**
 * docs/BACKLOG2.md §14 (แก้ 2026-09-30) — เลิกแยกประเภทสินค้าตามช่องทาง (product_types) ใช้ is_preorder ตัวเดียว
 *   - สินค้าปกติ pos- มีสต็อก · พรีออเดอร์ pre- ไม่มีสต็อก ต้องมี preorder_config
 *   - ส่งฟิลด์เก่า (product_type / product_types) → 400
 *   - updateProduct สร้าง product_id ใหม่เมื่อ prefix ไม่ตรงกับ is_preorder
 *   - scripts/migrate-is-preorder.ts แปลงข้อมูลทุกรุ่น (dry-run ค่าเริ่มต้น, --apply + backup)
 */

const PREORDER_CONFIG = { min_order_qty: 1, max_order_qty: 5, lead_time_days: 3 };

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

type Created = { _id: unknown; product_id: string; is_preorder: boolean; product_stock_quantity: number | null };

describe("productService — is_preorder", () => {
  it("ไม่ส่ง is_preorder = สินค้าปกติ: prefix pos- มีสต็อก", async () => {
    const p = (await productService.createProduct(await baseInput({ product_stock_quantity: 7 }))) as Created;
    expect(p.is_preorder).toBe(false);
    expect(p.product_id).toMatch(/^pos-\d{7}$/);
    expect(p.product_stock_quantity).toBe(7);
  });

  it("is_preorder: true → prefix pre- สต็อก null · ไม่มี preorder_config → 400", async () => {
    const p = (await productService.createProduct(
      await baseInput({ is_preorder: true, preorder_config: PREORDER_CONFIG })
    )) as Created;
    expect(p.is_preorder).toBe(true);
    expect(p.product_id).toMatch(/^pre-\d{7}$/);
    expect(p.product_stock_quantity).toBeNull();

    await expect(productService.createProduct(await baseInput({ is_preorder: true }))).rejects.toThrow(/preorder_config/);
  });

  it("สินค้าปกติส่ง preorder_config → 400 · is_preorder ไม่ใช่ boolean → 400", async () => {
    await expect(
      productService.createProduct(await baseInput({ preorder_config: PREORDER_CONFIG }))
    ).rejects.toThrow(/preorder_config/);
    await expect(
      productService.createProduct(await baseInput({ is_preorder: "yes" as unknown as boolean }))
    ).rejects.toThrow(/is_preorder/);
  });

  it("ส่งฟิลด์เก่า product_type / product_types → 400 (ไม่ทิ้งเงียบ ๆ)", async () => {
    for (const legacy of [{ product_type: "inStore" }, { product_types: ["online"] }]) {
      await expect(
        productService.createProduct({ ...(await baseInput()), ...legacy } as CreateProductInput)
      ).rejects.toThrow(/เลิกใช้แล้ว/);
    }
    const p = await makeProduct();
    await expect(
      productService.updateProduct(String(p._id), { product_types: ["preorder"] } as never)
    ).rejects.toThrow(/เลิกใช้แล้ว/);
  });

  it("updateProduct: เปลี่ยนเป็นพรีออเดอร์ → รหัสใหม่ pre- และสต็อกเป็น null", async () => {
    const p = (await productService.createProduct(await baseInput({ product_stock_quantity: 3 }))) as Created;
    const u = (await productService.updateProduct(String(p._id), {
      is_preorder: true,
      preorder_config: PREORDER_CONFIG,
      product_stock_quantity: null,
    })) as Created;
    expect(u.product_id).toMatch(/^pre-\d{7}$/);
    expect(u.product_stock_quantity).toBeNull();
  });

  it("updateProduct: สินค้ามีสต็อก เปลี่ยนเป็นพรีออเดอร์โดยไม่ส่ง product_stock_quantity (แบบหน้าแก้สินค้า) → ได้ สต็อกเป็น null", async () => {
    const p = (await productService.createProduct(await baseInput({ product_stock_quantity: 3 }))) as Created;
    const u = (await productService.updateProduct(String(p._id), {
      is_preorder: true,
      preorder_config: PREORDER_CONFIG,
    })) as Created;
    expect(u.product_id).toMatch(/^pre-\d{7}$/);
    expect(u.product_stock_quantity).toBeNull();
  });

  it("updateProduct: ส่ง product_stock_quantity เป็นตัวเลข → 400 ให้ใช้ /stock · สต็อกไม่เปลี่ยน", async () => {
    const p = (await productService.createProduct(await baseInput({ product_stock_quantity: 3 }))) as Created;
    await expect(
      productService.updateProduct(String(p._id), { product_stock_quantity: 99 })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/\/stock/) });
    await expect(
      productService.updateProduct(String(p._id), { product_name_th: "ชื่อใหม่", product_stock_quantity: 0 })
    ).rejects.toMatchObject({ status: 400 });
    const after = await productModel.findById(p._id).lean<{ product_stock_quantity: number; product_name_th: string }>();
    expect(after?.product_stock_quantity).toBe(3);
    expect(after?.product_name_th).toBe("เค้ก");
  });

  it("updateProduct: พรีออเดอร์ → สินค้าปกติ → สต็อกเริ่ม 0", async () => {
    const p = (await productService.createProduct(
      await baseInput({ is_preorder: true, preorder_config: PREORDER_CONFIG, product_stock_quantity: null })
    )) as Created;
    const u = (await productService.updateProduct(String(p._id), { is_preorder: false, preorder_config: null })) as Created;
    expect(u.product_stock_quantity).toBe(0);
  });

  it("updateProduct: ส่ง is_preorder ค่าเดิมกับสินค้าที่รหัสค้างผิดประเภท → แก้รหัสให้ (วิธีแก้ pos-1626294 แบบ §14)", async () => {
    const p = await makeProduct({
      product_id: "pos-1626999",
      is_preorder: true,
      product_stock_quantity: null,
      preorder_config: PREORDER_CONFIG,
    });
    const u = (await productService.updateProduct(String(p._id), { is_preorder: true })) as Created;
    expect(u.product_id).toMatch(/^pre-\d{7}$/);
  });

  it("updateProduct: ไม่ส่ง is_preorder → รหัสไม่เปลี่ยน", async () => {
    const p = (await productService.createProduct(await baseInput())) as Created;
    const u = (await productService.updateProduct(String(p._id), { product_name_th: "เค้กใหม่" })) as Created;
    expect(u.product_id).toBe(p.product_id);
  });

  it("getProducts is_preorder กรองได้ทั้งสองแบบ", async () => {
    const tag = `F${Date.now()}`;
    await makeProduct({ product_name_th: `${tag}-a` });
    await makeProduct({
      product_name_th: `${tag}-b`,
      is_preorder: true,
      product_stock_quantity: null,
      preorder_config: PREORDER_CONFIG,
    });
    const pagination = { page: 1, limit: 50, skip: 0 };
    const names = (r: { items: unknown[] }) => r.items.map((i) => (i as { product_name_th: string }).product_name_th);
    expect(names(await productService.getProducts({ pagination, search: tag, is_preorder: true }))).toEqual([`${tag}-b`]);
    expect(names(await productService.getProducts({ pagination, search: tag, is_preorder: false }))).toEqual([`${tag}-a`]);
  });
});

describe("scripts/migrate-is-preorder", () => {
  it("dry-run ไม่เขียน · --apply แปลงทุกรุ่น + ล้างฟิลด์เก่า + backup · รายงาน prefix/unresolved · รันซ้ำไม่มีอะไรทำ", async () => {
    const col = mongoose.connection.db!.collection("products");
    await col.deleteMany({});
    await col.insertMany([
      { product_id: "pos-0126001", product_types: ["inStore"] },
      { product_id: "pos-0126002", product_types: ["inStore", "online"] },
      { product_id: "pre-0126003", product_types: ["preorder"] },
      { product_id: "pos-0126004", product_types: ["preorder"] }, // prefix ผิด (§14)
      { product_id: "pos-0126005", product_type: "ready" }, // รุ่นแรก
      { product_id: "pre-0126006", product_type: "preorder" },
      // ฟิลด์เก่าค้างคู่กับฟิลด์ใหม่ (แบบที่เจอใน DB จริง 2026-09-30)
      { product_id: "pos-0126007", is_preorder: false, product_types: ["inStore"], product_type: "ready" },
      { product_id: "pos-0126008", is_preorder: false }, // เสร็จแล้ว ไม่แตะ
      { product_id: "pos-0126009" }, // ตัดสินไม่ได้
    ]);

    const dry = await runMigration();
    expect(dry.dryRun).toBe(true);
    expect(dry.planned).toHaveLength(7);
    expect(dry.migrated).toBe(0);
    expect(await col.countDocuments({ is_preorder: { $exists: true } })).toBe(2); // ยังไม่แตะ

    const backupDir = mkdtempSync(join(tmpdir(), "is-preorder-"));
    const r = await runMigration({ apply: true, backupDir });
    expect(r.migrated).toBe(7);
    expect(r.conflicts).toEqual([]);
    expect(r.unresolved.map((u) => u.product_id)).toEqual(["pos-0126009"]);
    expect(r.prefixMismatch.map((m) => m.product_id)).toEqual(["pos-0126004"]);
    expect(JSON.parse(readFileSync(r.backupFile!, "utf8"))).toHaveLength(7);

    const byId = new Map((await col.find({}).toArray()).map((d) => [d.product_id, d]));
    expect(byId.get("pos-0126001")?.is_preorder).toBe(false);
    expect(byId.get("pos-0126002")?.is_preorder).toBe(false);
    expect(byId.get("pre-0126003")?.is_preorder).toBe(true);
    expect(byId.get("pos-0126004")?.is_preorder).toBe(true);
    expect(byId.get("pos-0126005")?.is_preorder).toBe(false);
    expect(byId.get("pre-0126006")?.is_preorder).toBe(true);
    expect(byId.get("pos-0126007")?.is_preorder).toBe(false);
    const legacyLeft = await col.countDocuments({
      $or: [{ product_types: { $exists: true } }, { product_type: { $exists: true } }],
    });
    expect(legacyLeft).toBe(0);

    const again = await runMigration({ apply: true, backupDir });
    expect(again.planned).toHaveLength(0);
    expect(again.backupFile).toBeNull();
    expect(await productModel.countDocuments({ is_preorder: true })).toBe(3);
  });
});
