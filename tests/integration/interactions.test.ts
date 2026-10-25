import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import interactionModel from "@/models/interactionModel";
import productModel from "@/models/productModel";
import * as interactionService from "@/services/interactionService";
import * as cartService from "@/services/cartService";
import { flushBackground } from "@/lib/backgroundTasks";
import { trackInteractionBody } from "@/schemas/interaction";
import { makeUser, makeProduct } from "./helpers";

/** บันทึกพฤติกรรมให้ระบบแนะนำสินค้า — view (POST /api/shop/interactions) · add_to_cart (ตอนใส่ตะกร้า) */

describe("Interactions", () => {
  it("view: บันทึกครั้งแรก · ดูซ้ำภายใน 30 นาทีไม่บันทึกเพิ่ม · เกิน 30 นาทีบันทึกใหม่", async () => {
    const user = await makeUser();
    const product = await makeProduct();
    const uid = String(user._id);
    const pid = String(product._id);

    expect(await interactionService.trackView(uid, pid)).toEqual({ recorded: true });
    expect(await interactionService.trackView(uid, pid)).toEqual({ recorded: false });

    // created_at เป็น immutable ใน mongoose → แก้ผ่าน collection ตรง ๆ
    await interactionModel.collection.updateMany(
      { user_id: user._id },
      { $set: { created_at: new Date(Date.now() - interactionService.VIEW_DEDUPE_MS - 1000) } }
    );
    expect(await interactionService.trackView(uid, pid)).toEqual({ recorded: true });
    expect(await interactionModel.countDocuments({ user_id: user._id, action_type: "view" })).toBe(2);
  });

  it("view: สินค้าไม่มี/ถูกลบ = 404", async () => {
    const user = await makeUser();
    const product = await makeProduct();
    await productModel.updateOne({ _id: product._id }, { deleted_at: new Date() });
    await expect(interactionService.trackView(String(user._id), String(product._id))).rejects.toMatchObject({ status: 404 });
    await expect(
      interactionService.trackView(String(user._id), String(new mongoose.Types.ObjectId()))
    ).rejects.toMatchObject({ status: 404 });
  });

  it("body รับแค่ action_type view — client ส่ง purchase/wishlist/add_to_cart เองไม่ได้", () => {
    const product_id = String(new mongoose.Types.ObjectId());
    expect(trackInteractionBody.safeParse({ product_id, action_type: "view" }).success).toBe(true);
    for (const action_type of ["purchase", "wishlist", "add_to_cart"]) {
      expect(trackInteractionBody.safeParse({ product_id, action_type }).success).toBe(false);
    }
    expect(trackInteractionBody.safeParse({ product_id: "x", action_type: "view" }).success).toBe(false);
  });

  it("ใส่ตะกร้า → บันทึก add_to_cart ทุกครั้ง (รวมกรณีเพิ่มจำนวนรายการเดิม)", async () => {
    const user = await makeUser();
    const product = await makeProduct();
    await cartService.addItem(String(user._id), { product_id: String(product._id), quantity: 2 });
    await cartService.addItem(String(user._id), { product_id: String(product._id), quantity: 1 });
    await flushBackground();

    const rows = await interactionModel
      .find({ user_id: user._id, action_type: "add_to_cart" })
      .sort({ created_at: 1 })
      .lean();
    expect(rows.map((r) => r.metadata)).toEqual([{ quantity: 2 }, { quantity: 1 }]);
  });
});
