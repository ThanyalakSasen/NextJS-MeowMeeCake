import { describe, it, expect } from "vitest";
import * as cartService from "@/services/cartService";
import { makeUser, makeProduct, makeVariant, makeOption } from "./helpers";

/** BACKLOG §3.4 — integration tests เพิ่ม: cartService */
describe("cartService.addItem", () => {
  it("สินค้า product_type=preorder → ปฏิเสธ (ต้องสั่งผ่านระบบพรีออเดอร์แยก)", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_type: "preorder", product_stock_quantity: null });

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
