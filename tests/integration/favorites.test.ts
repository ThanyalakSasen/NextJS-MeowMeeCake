import { describe, it, expect } from "vitest";
import interactionModel from "@/models/interactionModel";
import productModel from "@/models/productModel";
import * as favoriteService from "@/services/favoriteService";
import { makeUser, makeProduct } from "./helpers";

/** รายการโปรด (customer-backend-merge.md §8.14) — Interactions action_type "wishlist" */

describe("รายการโปรด", () => {
  it("เพิ่ม → แสดงล่าสุดก่อน พร้อมราคาลด · เพิ่มซ้ำไม่ซ้ำแถว · เอาออก/กู้คืนใช้แถวเดิม · สินค้าถูกลบไม่แสดง", async () => {
    const user = await makeUser();
    const uid = String(user._id);
    const a = await makeProduct({ product_price: 120, sale_price: 99 });
    const b = await makeProduct({ product_price: 80 });

    await favoriteService.addFavorite(uid, String(a._id));
    await new Promise((r) => setTimeout(r, 5));
    await favoriteService.addFavorite(uid, String(b._id));
    await favoriteService.addFavorite(uid, String(b._id));
    expect(await interactionModel.countDocuments({ user_id: user._id, action_type: "wishlist" })).toBe(2);

    const { items } = await favoriteService.listFavorites(uid);
    expect(items.map((i) => i.id)).toEqual([String(b._id), String(a._id)]);
    expect(items[1]).toMatchObject({ price: 99, originalPrice: 120, inStock: true });
    expect(items[0]).toMatchObject({ price: 80, originalPrice: null });

    await favoriteService.removeFavorite(uid, String(b._id));
    expect((await favoriteService.listFavorites(uid)).items.map((i) => i.id)).toEqual([String(a._id)]);
    await favoriteService.addFavorite(uid, String(b._id));
    expect(await interactionModel.countDocuments({ user_id: user._id, action_type: "wishlist" })).toBe(2);

    await productModel.updateOne({ _id: a._id }, { $set: { deleted_at: new Date() } });
    expect((await favoriteService.listFavorites(uid)).items.map((i) => i.id)).toEqual([String(b._id)]);
  });

  it("สินค้าไม่มี = 404 · id ผิดรูปแบบ = 400 · เห็นเฉพาะของตัวเอง", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const p = await makeProduct();
    await expect(favoriteService.addFavorite(String(user._id), "5f9d88b9c3a1e2b3c4d5e6f7")).rejects.toMatchObject({ status: 404 });
    expect(() => favoriteService.readProductId({ productId: "bad" })).toThrow();
    expect(favoriteService.readProductId({ product_id: String(p._id) })).toBe(String(p._id));
    await favoriteService.addFavorite(String(user._id), String(p._id));
    expect((await favoriteService.listFavorites(String(other._id))).items).toEqual([]);
  });
});
