import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import notificationModel from "@/models/notificationModel";
import { checkDataIntegrity } from "@/services/dataIntegrityService";
import { makeProduct } from "./helpers";

/**
 * docs/BACKLOG4.md Y11 — ตรวจอาการของการเขียน DB ตรงนอกแอป (BACKLOG2 §16 + product_type "ready")
 * เงินเก็บเป็นบาท (docs/money-units.md) — makeProduct({ product_price: 65 }) = 65 บาทใน DB
 * เขียนข้อมูลเพี้ยนผ่าน collection ตรง ๆ (ข้าม schema) เหมือนที่เกิดจาก Compass/Atlas UI จริง
 */

const codesFor = (res: Awaited<ReturnType<typeof checkDataIntegrity>>, id: unknown) =>
  res.issues.filter((i) => i.id === String(id)).map((i) => i.code).sort();

describe("dataIntegrityService (BACKLOG4 Y11)", () => {
  it("ข้อมูลปกติ → ไม่มีปัญหา ไม่แจ้งเตือน", async () => {
    await makeProduct({ product_price: 65, product_stock_quantity: 3 });
    const res = await checkDataIntegrity({ notify: true });
    expect(res.issues).toEqual([]);
    expect(res.notified).toBe(false);
    expect(await notificationModel.countDocuments()).toBe(0);
  });

  it("ราคาหน่วยผิด (สตางค์/หาร 100) / ทศนิยมเกิน / ราคาลดแพงกว่า / ฟิลด์เก่า / prefix ไม่ตรง → รายงานครบ + แจ้งเจ้าของร้าน", async () => {
    const p = await makeProduct({ product_price: 65, sale_price: 64 });
    await productModel.collection.updateOne(
      { _id: p._id },
      { $set: { product_price: 0.65, sale_price: 6400, product_type: "ready", product_id: "pre-0110001" } }
    );
    const q = await makeProduct({ product_price: 100 });
    await productModel.collection.updateOne({ _id: q._id }, { $set: { product_price: 55.505 } });
    const r = await makeProduct({ product_price: 100 });
    await productModel.collection.updateOne({ _id: r._id }, { $set: { product_price: 35000 } });

    const res = await checkDataIntegrity({ notify: true });
    expect(codesFor(res, p._id)).toEqual(
      ["code_prefix_mismatch", "legacy_fields", "price_too_low", "sale_not_below_price"].sort()
    );
    expect(codesFor(res, q._id)).toEqual(["price_bad_precision"]);
    expect(codesFor(res, r._id)).toEqual(["price_too_high"]);
    expect(res.notified).toBe(true);
    const n = await notificationModel.findOne().lean<{ title: string; module: string }>();
    expect(n!.title).toContain("6");
    expect(n!.module).toBe("system");
  });
});
