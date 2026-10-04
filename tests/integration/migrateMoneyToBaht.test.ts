import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigration, MARKER_ID } from "../../scripts/migrate-money-to-baht";

/**
 * docs/money-units.md — scripts/migrate-money-to-baht.ts ÷100 ข้อมูลเงินที่เป็นสตางค์ (ครั้งเดียว)
 * ข้อมูลตั้งต้นเขียนผ่าน collection ตรง ๆ ให้เหมือน DB จริงที่มีสองหน่วยปนกัน
 */

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});
const db = () => mongoose.connection.db!;
const oid = () => new mongoose.Types.ObjectId();

describe("scripts/migrate-money-to-baht", () => {
  it("dry-run ไม่เขียน · --apply ÷100 เฉพาะค่าสตางค์ · ค่าที่เป็นบาทแล้วไม่แตะ · ลง marker · รันซ้ำไม่ได้", async () => {
    const [bahtProduct, satangProduct, satangOrder, bahtOrder, item, ing, promoAmt, promoPct, pre] = Array.from({ length: 9 }, oid);
    const oldUpdated = new Date("2026-09-01T00:00:00Z");
    await db().collection("products").insertMany([
      { _id: bahtProduct, product_price: 35, sale_price: null, updated_at: oldUpdated }, // FrontOffice เขียนบาท
      { _id: satangProduct, product_price: 6500, sale_price: 6000, purchase_cost: 2550 },
    ]);
    await db().collection("orders").insertMany([
      { _id: satangOrder, order_no: "ORD-20260930-AAAAAA", subtotal: 12000, discount_amount: 1200, delivery_fee: 4500, total_amount: 15300 },
      { _id: bahtOrder, order_no: "ORD-1790786142302-M2PY", subtotal: 55, discount_amount: 0, delivery_fee: 0, total_amount: 55 },
    ]);
    await db().collection("orderitems").insertOne({
      _id: item, unit_price: 6000, total_price: 12000, cost_per_unit: 1655,
      selected_options: [{ option_id: oid(), extra_price: 2500 }, { option_id: oid(), extra_price: 0 }],
    });
    await db().collection("ingredients").insertOne({ _id: ing, cost_per_unit: 15 }); // สตางค์ต่อกรัม
    await db().collection("promotions").insertMany([
      { _id: promoAmt, discount_type: "Amount", discount_value: 5000, min_order_amount: 30000 },
      { _id: promoPct, discount_type: "Percentage", discount_value: 10, max_discount_amount: 10000 },
    ]);
    await db().collection("preorders").insertOne({ _id: pre, preorder_no: "PRE-0001", subtotal: 85000, discount_amount: 0, delivery_fee: 4000, total_amount: 89000 });

    const dry = await runMigration();
    expect(dry.dryRun).toBe(true);
    expect((await db().collection("products").findOne({ _id: satangProduct }))!.product_price).toBe(6500);

    dir = mkdtempSync(join(tmpdir(), "baht-"));
    const res = await runMigration({ apply: true, backupDir: dir });
    expect(res.conflicts).toEqual([]);
    expect(res.review).toEqual([]);

    const get = (c: string, id: unknown) => db().collection(c).findOne({ _id: id as mongoose.Types.ObjectId });
    expect(await get("products", bahtProduct)).toMatchObject({ product_price: 35, updated_at: oldUpdated });
    expect(await get("products", satangProduct)).toMatchObject({ product_price: 65, sale_price: 60, purchase_cost: 25.5 });
    expect(await get("orders", satangOrder)).toMatchObject({ subtotal: 120, discount_amount: 12, delivery_fee: 45, total_amount: 153 });
    expect(await get("orders", bahtOrder)).toMatchObject({ subtotal: 55, total_amount: 55 });
    const it2 = (await get("orderitems", item))!;
    expect(it2).toMatchObject({ unit_price: 60, total_price: 120, cost_per_unit: 16.55 });
    expect(it2.selected_options.map((o: { extra_price: number }) => o.extra_price)).toEqual([25, 0]);
    expect((await get("ingredients", ing))!.cost_per_unit).toBe(0.15);
    expect(await get("promotions", promoAmt)).toMatchObject({ discount_value: 50, min_order_amount: 300 });
    expect(await get("promotions", promoPct)).toMatchObject({ discount_value: 10, max_discount_amount: 100 }); // % ไม่แตะ
    expect(await get("preorders", pre)).toMatchObject({ subtotal: 850, delivery_fee: 40, total_amount: 890 });
    expect(await db().collection<{ _id: string }>("migrations").findOne({ _id: MARKER_ID })).toBeTruthy();

    await expect(runMigration({ apply: true, backupDir: dir })).rejects.toThrow("ห้ามรันซ้ำ");
  });

  it("ออเดอร์ที่หน่วยปนกันในเอกสารเดียว → รายงาน review", async () => {
    // เคสจริง WEB-1790317257577: subtotal สตางค์ แต่ค่าส่งเป็นบาท
    await db().collection("orders").insertOne({ _id: oid(), order_no: "WEB-1790317257577", subtotal: 5500, discount_amount: 0, delivery_fee: 65, total_amount: 5565 });
    const res = await runMigration();
    expect(res.review.map((r) => r.no)).toEqual(["WEB-1790317257577"]);
  });

  it("ค่าบาทที่เข้ามาหลังวางแผน (FrontOffice / หลังร้านโค้ดใหม่) ไม่ถูก ÷100 — ตรวจ 2026-10-04", async () => {
    const [prod, variant, option, pre, promo, order] = Array.from({ length: 6 }, oid);
    await db().collection("products").insertOne({ _id: prod, product_price: 35, sale_price: 29 });
    await db().collection("productvariants").insertOne({ _id: variant, variant_price: 30 });
    await db().collection("productoptions").insertOne({ _id: option, extra_price: 25 });
    await db().collection("preorders").insertOne({ _id: pre, preorder_no: "PRE-1791013745988-RM33", subtotal: 275, discount_amount: 0, delivery_fee: 0, total_amount: 275 });
    await db().collection("promotions").insertOne({ _id: promo, discount_type: "Percentage", discount_value: 50, min_order_amount: 50 });
    await db().collection("orders").insertOne({ _id: order, order_no: "ORD-1791057213901-ILQN", subtotal: 279, discount_amount: 140, delivery_fee: 0, total_amount: 139 });

    const res = await runMigration();
    expect(res.planned).toEqual([]);
    const get = (c: string, id: unknown) => db().collection(c).findOne({ _id: id as mongoose.Types.ObjectId });
    dir = mkdtempSync(join(tmpdir(), "baht-"));
    await runMigration({ apply: true, backupDir: dir });
    expect(await get("products", prod)).toMatchObject({ product_price: 35, sale_price: 29 });
    expect((await get("productvariants", variant))!.variant_price).toBe(30);
    expect((await get("productoptions", option))!.extra_price).toBe(25);
    expect(await get("preorders", pre)).toMatchObject({ subtotal: 275, total_amount: 275 });
    expect(await get("promotions", promo)).toMatchObject({ discount_value: 50, min_order_amount: 50 });
    expect(await get("orders", order)).toMatchObject({ discount_amount: 140 });
  });
});
