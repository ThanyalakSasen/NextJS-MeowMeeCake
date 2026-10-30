import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import * as cartService from "@/services/cartService";
import { makeUser, makeProduct } from "./helpers";

/**
 * ตะกร้าแสดงราคาปัจจุบัน — เดิมโชว์ price_snapshot ตอนหยิบ แต่ตอนสั่งจริง orderService คิดราคาปัจจุบัน
 * ร้านเปลี่ยนราคาระหว่างนั้น = ยอดในตะกร้า/หน้ายืนยันไม่ตรงกับบิลที่ต้องจ่าย
 */
describe("ตะกร้าคิดราคาปัจจุบัน", () => {
  it("ร้านขึ้นราคา/ลดราคาหลังหยิบใส่ตะกร้า → บรรทัดและยอดรวมเป็นราคาใหม่", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 20 });
    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 2 });

    await productModel.updateOne({ _id: p._id }, { $set: { product_price: 150 } });
    let cart = await cartService.getCartDetail(String(user._id));
    expect(cart.items[0].price_snapshot).toBe(150);
    expect(cart.items[0].line_total).toBe(300);
    expect(cart.summary.subtotal).toBe(300);

    await productModel.updateOne({ _id: p._id }, { $set: { sale_price: 120 } });
    cart = await cartService.getCartDetail(String(user._id));
    expect(cart.summary.subtotal).toBe(240);
  });

  it("สินค้าถูกลบ → คงราคาเดิมไว้แสดง (สั่งไม่ได้อยู่แล้ว)", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 80, product_stock_quantity: 5 });
    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 1 });
    await productModel.updateOne({ _id: p._id }, { $set: { deleted_at: new Date(), product_price: 999 } });
    const cart = await cartService.getCartDetail(String(user._id));
    expect(cart.items[0].price_snapshot).toBe(80);
    expect(cart.items[0].is_available).toBe(false);
  });
});
