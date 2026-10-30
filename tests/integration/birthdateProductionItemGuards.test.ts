import { describe, it, expect } from "vitest";
import productionItemModel from "@/models/productionItemModel";
import * as productionOrderService from "@/services/productionOrderService";
import * as productionItemService from "@/services/productionItemService";
import { assertPasswordStrength } from "@/services/userService";
import { updateProfileBody, updateUserBody } from "@/schemas/user";
import { registerBody } from "@/schemas/auth";
import { makeProduct, makeRecipe } from "./helpers";

/** วันเกิดอนาคต/ก่อน 1900 · รหัสผ่านเกิน 72 · แก้จำนวนรายการผลิตที่หักสต็อกแล้ว */

const DAY = 24 * 60 * 60 * 1000;

describe("วันเกิด", () => {
  it("อนาคต / ก่อน 1900 ไม่ผ่าน · วันนี้และอดีตผ่าน", () => {
    const future = new Date(Date.now() + 3 * DAY).toISOString();
    expect(updateProfileBody.safeParse({ user_birthdate: future }).success).toBe(false);
    expect(updateProfileBody.safeParse({ user_birthdate: "1899-12-31" }).success).toBe(false);
    expect(updateProfileBody.safeParse({ user_birthdate: "1995-05-20" }).success).toBe(true);
    expect(updateProfileBody.safeParse({ user_birthdate: new Date().toISOString().slice(0, 10) }).success).toBe(true);
    expect(updateProfileBody.safeParse({ user_birthdate: null }).success).toBe(true);

    const reg = { user_fullname: "ทดสอบ", email: "a@b.co", password: "12345678" };
    expect(registerBody.safeParse({ ...reg, user_birthday: future }).success).toBe(false);
    expect(registerBody.safeParse({ ...reg, user_birthdate: "1800-01-01" }).success).toBe(false);
    expect(registerBody.safeParse({ ...reg, user_birthday: "2000-01-01" }).success).toBe(true);
  });

  it("ฟอร์มพนักงานใช้กติกาเดียวกัน", () => {
    expect(updateUserBody.safeParse({ user_birthdate: new Date(Date.now() + 3 * DAY).toISOString() }).success).toBe(false);
    expect(updateUserBody.safeParse({ user_birthdate: "1990-01-01" }).success).toBe(true);
  });
});

describe("รหัสผ่าน", () => {
  it("เกิน 72 ตัว → 400 · 72 ผ่าน", () => {
    expect(() => assertPasswordStrength("a".repeat(73))).toThrow(/72/);
    expect(() => assertPasswordStrength("a".repeat(72))).not.toThrow();
  });
});

describe("รายการผลิตที่หักสต็อกแล้ว", () => {
  it("แก้จำนวน/สถานะ → 409 · แก้หมายเหตุได้", async () => {
    const product = await makeProduct({ product_stock_quantity: 0 });
    const recipe = await makeRecipe(String(product._id));
    const order = (await productionOrderService.createProductionOrder({
      production_date: new Date(),
      items: [{ product_id: String(product._id), recipe_id: String(recipe._id), planned_qty: 3 }],
    })) as { _id: unknown };
    const item = (await productionItemModel.findOne({ production_order_id: order._id }).lean<{ _id: unknown }>())!;
    await productionItemModel.updateOne({ _id: item._id }, { $set: { stock_updated_at: new Date() } });

    const id = String(item._id);
    await expect(productionItemService.updateItem(id, { planned_qty: 5 })).rejects.toMatchObject({ status: 409 });
    await expect(productionItemService.updateItem(id, { actual_qty: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(productionItemService.updateItem(id, { item_status: "cancelled" })).rejects.toMatchObject({ status: 409 });
    await expect(productionItemService.updateItem(id, { notes: "ไข่แตก 2 ฟอง" })).resolves.toMatchObject({ notes: "ไข่แตก 2 ฟอง" });
  });
});
