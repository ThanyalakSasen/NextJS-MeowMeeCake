import { describe, it, expect } from "vitest";
import * as cartService from "@/services/cartService";
import productModel from "@/models/productModel";
import { makeUser, makeProduct, makeVariant, makeOption } from "./helpers";

/** BACKLOG §3.4 — integration tests เพิ่ม: cartService */
describe("cartService.addItem", () => {
  it("สินค้าพรีออเดอร์ (is_preorder) → ปฏิเสธ (ต้องสั่งผ่านระบบพรีออเดอร์แยก)", async () => {
    const user = await makeUser();
    const p = await makeProduct({ is_preorder: true, product_stock_quantity: null });

    await expect(
      cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 1 })
    ).rejects.toThrow(/พรีออเดอร์/);
  });

  it("สินค้า is_visible=false → ปฏิเสธ", async () => {
    const user = await makeUser();
    const p = await makeProduct({ is_visible: false });

    await expect(
      cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 1 })
    ).rejects.toThrow(/ปิดการขาย/);
  });

  it("คิดราคา price_snapshot = base (sale_price ถ้ามี) + variant_price + Σextra_price ของ option", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, sale_price: 80 });
    const variant = await makeVariant(String(p._id), { variant_price: 15 });
    const opt = await makeOption(String(p._id), { extra_price: 5 });

    const item = await cartService.addItem(String(user._id), {
      product_id: String(p._id),
      variant_id: String(variant._id),
      selected_options: [{ option_id: String(opt._id) }],
      quantity: 2,
    });

    // 80 (sale_price) + 15 (variant) + 5 (option) = 100
    expect(item.price_snapshot).toBe(100);
    expect(item.quantity).toBe(2);
  });

  it("เพิ่มสินค้า+variant+option set เดิมซ้ำ → รวมจำนวนในรายการเดิม ไม่สร้างแยก", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50 });

    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 1 });
    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 3 });

    const detail = await cartService.getCartDetail(String(user._id));
    expect(detail.items.length).toBe(1);
    expect(detail.items[0].quantity).toBe(4);
  });

  it("option set ต่างกัน → แยกเป็นคนละรายการ ไม่รวมกับของเดิม", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50 });
    const opt = await makeOption(String(p._id), { extra_price: 10 });

    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 1 });
    await cartService.addItem(String(user._id), {
      product_id: String(p._id),
      selected_options: [{ option_id: String(opt._id) }],
      quantity: 1,
    });

    const detail = await cartService.getCartDetail(String(user._id));
    expect(detail.items.length).toBe(2);
  });
});

describe("cartService.updateItemQuantity", () => {
  it("quantity = 0 → soft-delete รายการ (ลบออกจากตะกร้า)", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50 });
    const item = await cartService.addItem(String(user._id), {
      product_id: String(p._id),
      quantity: 2,
    });

    const result = await cartService.updateItemQuantity(String(user._id), String(item._id), 0);
    expect(result.removed).toBe(true);

    const detail = await cartService.getCartDetail(String(user._id));
    expect(detail.items.length).toBe(0);
  });

  it("quantity ติดลบ → badRequest", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50 });
    const item = await cartService.addItem(String(user._id), {
      product_id: String(p._id),
      quantity: 2,
    });

    await expect(
      cartService.updateItemQuantity(String(user._id), String(item._id), -1)
    ).rejects.toThrow();
  });
});

describe("cartService — ตรวจสต็อกตอนเพิ่มลงตะกร้า", () => {
  it("เพิ่มเกินสต็อก → 409 · สต็อก 0 → บอกว่าหมดแล้ว", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_name_th: "ครัวซองต์", product_stock_quantity: 3 });
    const sold = await makeProduct({ product_name_th: "บราวนี่", product_stock_quantity: 0 });

    await expect(
      cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 4 })
    ).rejects.toMatchObject({ status: 409, message: "ครัวซองต์ เหลือ 3 ชิ้น" });
    await expect(
      cartService.addItem(String(user._id), { product_id: String(sold._id), quantity: 1 })
    ).rejects.toMatchObject({ status: 409, message: "บราวนี่ หมดแล้ว" });

    const detail = await cartService.getCartDetail(String(user._id));
    expect(detail.items.length).toBe(0);
  });

  it("นับรวมทุกบรรทัดของสินค้าเดียวกัน (ตัวเลือกต่างกันใช้สต็อกเดียวกัน)", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_name_th: "เค้ก", product_stock_quantity: 5 });
    const opt = await makeOption(String(p._id), { extra_price: 10 });
    const uid = String(user._id);

    await cartService.addItem(uid, { product_id: String(p._id), quantity: 3 });
    await expect(
      cartService.addItem(uid, {
        product_id: String(p._id),
        selected_options: [{ option_id: String(opt._id) }],
        quantity: 3,
      })
    ).rejects.toMatchObject({
      status: 409,
      message: "ตอนนี้มีเค้กอยู่ในตะกร้าแล้ว 3 ชิ้น เพิ่มได้อีกแค่ 2 ชิ้น",
      details: { available: 5, in_cart: 3 },
    });

    // พอดีสต็อกพอดี → ผ่าน · เพิ่มอีกชิ้น → ครบแล้ว
    await cartService.addItem(uid, { product_id: String(p._id), quantity: 2 });
    await expect(
      cartService.addItem(uid, { product_id: String(p._id), quantity: 1 })
    ).rejects.toThrow(/ครบจำนวนที่เหลือแล้ว/);
  });

  it("updateItemQuantity: เพิ่มเกินสต็อก → 409 · ลดจำนวนได้เสมอแม้สต็อกลดลงต่ำกว่าในตะกร้า", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 5 });
    const uid = String(user._id);
    const item = await cartService.addItem(uid, { product_id: String(p._id), quantity: 4 });

    await expect(cartService.updateItemQuantity(uid, String(item._id), 6)).rejects.toMatchObject({ status: 409 });
    // ไม่นับบรรทัดตัวเองซ้ำ: 4 → 5 ผ่าน
    const up = await cartService.updateItemQuantity(uid, String(item._id), 5);
    expect(up.quantity).toBe(5);

    await productModel.updateOne({ _id: p._id }, { $set: { product_stock_quantity: 1 } });
    const down = await cartService.updateItemQuantity(uid, String(item._id), 3);
    expect(down.quantity).toBe(3);
  });

  it("ตะกร้าคนอื่นไม่นับรวม (ไม่จองสต็อก)", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 2 });

    await cartService.addItem(String(a._id), { product_id: String(p._id), quantity: 2 });
    const item = await cartService.addItem(String(b._id), { product_id: String(p._id), quantity: 2 });
    expect(item.quantity).toBe(2);
  });
});

describe("cartService.removeItem / clearCart", () => {
  it("removeItem รายการที่ไม่ใช่ของตัวเอง (คนละ user) → notFound", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const p = await makeProduct({ product_price: 50 });
    const item = await cartService.addItem(String(owner._id), {
      product_id: String(p._id),
      quantity: 1,
    });

    await expect(
      cartService.removeItem(String(stranger._id), String(item._id))
    ).rejects.toThrow(/ไม่พบรายการ/);
  });

  it("clearCart ล้างทุกรายการ → getCartDetail ว่างเปล่า", async () => {
    const user = await makeUser();
    const p1 = await makeProduct({ product_price: 50 });
    const p2 = await makeProduct({ product_price: 30 });
    await cartService.addItem(String(user._id), { product_id: String(p1._id), quantity: 1 });
    await cartService.addItem(String(user._id), { product_id: String(p2._id), quantity: 1 });

    const result = await cartService.clearCart(String(user._id));
    expect(result.removed_count).toBe(2);

    const detail = await cartService.getCartDetail(String(user._id));
    expect(detail.items.length).toBe(0);
    expect(detail.summary.subtotal).toBe(0);
  });
});
