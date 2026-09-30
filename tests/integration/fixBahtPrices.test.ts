import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import productModel from "@/models/productModel";
import { runFix } from "../../scripts/fix-baht-prices";
import { runAudit } from "../../scripts/audit-money-units";
import { makeProduct } from "./helpers";

/**
 * docs/BACKLOG4.md R7 — scripts/fix-baht-prices.ts ×100 ราคาที่ถูกเขียนเป็นบาท (แบบมีเงื่อนไข + backup)
 */

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});
const db = () => mongoose.connection.db!;
const priceOf = async (id: unknown) =>
  (await productModel.collection.findOne({ _id: id as mongoose.Types.ObjectId }))!.product_price as number;

describe("scripts/fix-baht-prices (BACKLOG4 R7)", () => {
  it("dry-run ไม่เขียน · --apply ×100 เฉพาะค่าต่ำ (รวมสินค้าที่ลบแล้ว/ราคารอบ/ตะกร้า) · ไม่แตะ updated_at · รันซ้ำไม่คูณซ้ำ", async () => {
    const baht = await makeProduct({ product_price: 100 });
    const ok = await makeProduct({ product_price: 65 });
    const deleted = await makeProduct({ product_price: 100 });
    const oldUpdated = new Date("2026-09-01T00:00:00Z");
    await productModel.collection.updateOne({ _id: baht._id }, { $set: { product_price: 35, updated_at: oldUpdated } });
    await productModel.collection.updateOne({ _id: deleted._id }, { $set: { product_price: 45, deleted_at: new Date() } });
    const roundItemId = new mongoose.Types.ObjectId();
    await db().collection("preorderrounditems").insertOne({ _id: roundItemId, round_id: new mongoose.Types.ObjectId(), price_override: 366 });
    const cartId = new mongoose.Types.ObjectId();
    await db().collection("cartitems").insertOne({ _id: cartId, cart_id: new mongoose.Types.ObjectId(), price_snapshot: 35, deleted_at: null });

    const dry = await runFix();
    expect(dry.planned).toHaveLength(4);
    expect(await priceOf(baht._id)).toBe(35);

    dir = mkdtempSync(join(tmpdir(), "r7-"));
    const res = await runFix({ apply: true, backupDir: dir });
    expect(res.written).toBe(4);
    expect(await priceOf(baht._id)).toBe(3500);
    expect(await priceOf(deleted._id)).toBe(4500);
    expect(await priceOf(ok._id)).toBe(6500);
    expect((await db().collection("preorderrounditems").findOne({ _id: roundItemId }))!.price_override).toBe(36600);
    expect((await db().collection("cartitems").findOne({ _id: cartId }))!.price_snapshot).toBe(3500);
    expect(((await productModel.collection.findOne({ _id: baht._id }))!.updated_at as Date).toISOString()).toBe(
      oldUpdated.toISOString()
    );

    expect((await runFix({ apply: true, backupDir: dir })).planned).toHaveLength(0);

    // backup ใช้กับ audit-money-units ได้ (Y10) → แถวที่แก้แล้ว = SATANG_FIXED
    const audit = await runAudit({ backupDir: dir, reportPath: null });
    expect(audit.rows.find((r) => r.id === String(baht._id) && r.field === "product_price")!.verdict).toBe("SATANG_FIXED");
  });

  it("ค่ามีทศนิยม → หยุด ไม่เขียนอะไร", async () => {
    const p = await makeProduct({ product_price: 100 });
    const q = await makeProduct({ product_price: 100 });
    await productModel.collection.updateOne({ _id: p._id }, { $set: { product_price: 35 } });
    await productModel.collection.updateOne({ _id: q._id }, { $set: { product_price: 12.5 } });
    await expect(runFix({ apply: true, backupDir: mkdtempSync(join(tmpdir(), "r7-")) })).rejects.toThrow("ทศนิยม");
    expect(await priceOf(p._id)).toBe(35);
  });
});
