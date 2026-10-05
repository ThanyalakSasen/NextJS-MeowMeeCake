import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSatangFix, FIX_LOG } from "../../scripts/fix-satang-money";

/**
 * docs/money-units.md §3 — scripts/fix-satang-money.ts แก้ค่าเงินที่ยังเป็นสตางค์ (÷100)
 * ตัดสินด้วยค่าอ้างอิง (ราคาสินค้า) หรือวันที่บันทึก · ตัดสินไม่ได้ = รายงาน ไม่แตะ · รันซ้ำไม่หารซ้ำ
 */

const OLD = new Date("2026-09-01T00:00:00Z"); // ก่อน SATANG_CUTOFF
const NEW = new Date("2026-10-03T00:00:00Z"); // หลัง SATANG_CUTOFF
const col = (name: string) => mongoose.connection.db!.collection(name);
const oid = () => new mongoose.Types.ObjectId();
const valueOf = async (name: string, _id: mongoose.Types.ObjectId, field: string) => (await col(name).findOne({ _id }))![field];

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

async function seed() {
  const ids: Record<string, mongoose.Types.ObjectId> = {};
  const put = async (name: string, key: string, doc: Record<string, unknown>) => {
    ids[key] = oid();
    await col(name).insertOne({ _id: ids[key], ...doc });
  };
  // ราคาลด: 4000 กับราคา 45 = สตางค์ · 29 กับราคา 35 = บาท
  await put("products", "pSatang", { product_id: "pos-1", product_price: 45, sale_price: 4000, updated_at: NEW });
  await put("products", "pBaht", { product_id: "pos-2", product_price: 35, sale_price: 29, updated_at: NEW });
  // เทียบราคาสินค้า: ≥10 เท่า = สตางค์ · ~1 เท่า = บาท · 2.5 เท่า = ตัดสินไม่ได้
  await put("preorderrounditems", "riSatang", { product_id: ids.pSatang, price_override: 4500, updated_at: NEW });
  await put("preorderrounditems", "riBaht", { product_id: ids.pBaht, price_override: 39, updated_at: NEW });
  await put("cartitems", "ciSatang", { product_id: ids.pSatang, price_snapshot: 3500, created_at: NEW });
  await put("cartitems", "ciAmbiguous", { product_id: ids.pBaht, price_snapshot: 90, created_at: OLD });
  // วันที่: ก่อนตัด = สตางค์ · หลังตัด = บาท · ÷100 แล้ว < 10 บาท = ตัดสินไม่ได้
  await put("payments", "payOld", { amount: 18000, created_at: OLD, updated_at: NEW });
  await put("payments", "payNew", { amount: 180, created_at: NEW });
  await put("payments", "payTiny", { amount: 100, created_at: OLD });
  await put("preorders", "preOld", { preorder_no: "PRE-OLD", subtotal: 85000, delivery_fee: 4000, discount_amount: 0, total_amount: 89000, created_at: OLD });
  await put("preorders", "preNew", { preorder_no: "PRE-NEW", subtotal: 650, total_amount: 650, created_at: NEW });
  await put("preorderitems", "itemOld", { preorder_id: ids.preOld, unit_price: 85000, total_price: 85000, cost_per_unit: null });
  await put("preorderitems", "itemNew", { preorder_id: ids.preNew, unit_price: 650, total_price: 650 });
  // โปรโมชัน: % ไม่ใช่เงิน · แต้มไม่ใช่เงิน
  await put("promotions", "promoAmount", { promotion_name: "ลด 50", discount_type: "Amount", discount_value: 5000, min_order_amount: 30000, updated_at: OLD });
  await put("promotions", "promoPercent", { promotion_name: "ลด 10%", discount_type: "Percentage", discount_value: 10, max_discount_amount: 10000, points_cost: 150, updated_at: OLD });
  await put("promotions", "promoNew", { promotion_name: "ใหม่", discount_type: "Amount", discount_value: 50, updated_at: NEW });
  await put("expenses", "expOld", { amount: 120000, updated_at: OLD });
  await put("expenses", "expEdited", { amount: 1500, created_at: OLD, updated_at: NEW }); // แก้หลังตัด = บาทแล้ว
  await put("ingredients", "ing", { ingredient_name: "แป้ง", cost_per_unit: 4, updated_at: OLD });
  await put("components", "comp", { component_name: "เนื้อเค้ก", estimated_cost_per_batch: 5500, updated_at: OLD });
  await put("recipes", "recipe", { recipe_name: "ชิโอะปัง", estimated_cost_per_batch: 16550, updated_at: OLD });
  return ids;
}

describe("scripts/fix-satang-money (money-units.md §3)", () => {
  it("dry-run ไม่เขียน · --apply ÷100 เฉพาะค่าที่เป็นสตางค์ · ไม่แตะบาท/ตัดสินไม่ได้ · ไม่แตะ updated_at · รันซ้ำไม่หารซ้ำ", async () => {
    const ids = await seed();

    const dry = await runSatangFix();
    expect(dry.dryRun).toBe(true);
    const plannedKeys = dry.planned.map((p) => `${p.collection}.${p.field}`).sort();
    expect(plannedKeys).toEqual(
      [
        "products.sale_price",
        "preorderrounditems.price_override",
        "cartitems.price_snapshot",
        "payments.amount",
        "preorders.subtotal",
        "preorders.delivery_fee",
        "preorders.total_amount",
        "preorderitems.unit_price",
        "preorderitems.total_price",
        "promotions.discount_value",
        "promotions.min_order_amount",
        "promotions.max_discount_amount",
        "expenses.amount",
        "ingredients.cost_per_unit",
        "components.estimated_cost_per_batch",
        "recipes.estimated_cost_per_batch",
      ].sort()
    );
    expect(dry.review.map((r) => r._id).sort()).toEqual([String(ids.ciAmbiguous), String(ids.payTiny)].sort());
    expect(await valueOf("products", ids.pSatang, "sale_price")).toBe(4000);

    dir = mkdtempSync(join(tmpdir(), "satang-"));
    const res = await runSatangFix({ apply: true, backupDir: dir });
    expect(res.updated).toBe(16);
    expect(res.conflicts).toHaveLength(0);
    expect(res.backupFile).toBeTruthy();

    // แก้แล้ว
    expect(await valueOf("products", ids.pSatang, "sale_price")).toBe(40);
    expect(await valueOf("preorderrounditems", ids.riSatang, "price_override")).toBe(45);
    expect(await valueOf("cartitems", ids.ciSatang, "price_snapshot")).toBe(35);
    expect(await valueOf("payments", ids.payOld, "amount")).toBe(180);
    expect(await valueOf("preorders", ids.preOld, "total_amount")).toBe(890);
    expect(await valueOf("preorderitems", ids.itemOld, "unit_price")).toBe(850);
    expect(await valueOf("promotions", ids.promoAmount, "discount_value")).toBe(50);
    expect(await valueOf("promotions", ids.promoAmount, "min_order_amount")).toBe(300);
    expect(await valueOf("promotions", ids.promoPercent, "max_discount_amount")).toBe(100);
    expect(await valueOf("expenses", ids.expOld, "amount")).toBe(1200);
    expect(await valueOf("ingredients", ids.ing, "cost_per_unit")).toBe(0.04);
    expect(await valueOf("components", ids.comp, "estimated_cost_per_batch")).toBe(55);
    expect(await valueOf("recipes", ids.recipe, "estimated_cost_per_batch")).toBe(165.5);

    // ไม่แตะ
    expect(await valueOf("products", ids.pBaht, "sale_price")).toBe(29);
    expect(await valueOf("preorderrounditems", ids.riBaht, "price_override")).toBe(39);
    expect(await valueOf("cartitems", ids.ciAmbiguous, "price_snapshot")).toBe(90);
    expect(await valueOf("payments", ids.payNew, "amount")).toBe(180);
    expect(await valueOf("payments", ids.payTiny, "amount")).toBe(100);
    expect(await valueOf("preorders", ids.preNew, "total_amount")).toBe(650);
    expect(await valueOf("preorderitems", ids.itemNew, "unit_price")).toBe(650);
    expect(await valueOf("promotions", ids.promoPercent, "discount_value")).toBe(10);
    expect(await valueOf("promotions", ids.promoPercent, "points_cost")).toBe(150);
    expect(await valueOf("promotions", ids.promoNew, "discount_value")).toBe(50);
    expect(await valueOf("expenses", ids.expEdited, "amount")).toBe(1500);
    expect(((await valueOf("expenses", ids.expOld, "updated_at")) as Date).toISOString()).toBe(OLD.toISOString());

    // รันซ้ำ — ค่าที่ตัดสินด้วยวันที่ยังเข้าเงื่อนไข แต่ต้องไม่หาร 100 ซ้ำ
    expect(await col(FIX_LOG).countDocuments()).toBe(16);
    const again = await runSatangFix({ apply: true, backupDir: dir });
    expect(again.planned).toHaveLength(0);
    expect(again.alreadyFixed).toBe(13); // ค่าที่ใช้วันที่ตัดสิน (13) กันด้วยบันทึก · 3 ค่าที่เทียบราคาสินค้าไม่เข้าเงื่อนไขแล้วหลังแก้
    expect(again.review.map((r) => r._id).sort()).toEqual([String(ids.ciAmbiguous), String(ids.payTiny)].sort());
    expect(await valueOf("expenses", ids.expOld, "amount")).toBe(1200);
    expect(await valueOf("ingredients", ids.ing, "cost_per_unit")).toBe(0.04);
  });
});
