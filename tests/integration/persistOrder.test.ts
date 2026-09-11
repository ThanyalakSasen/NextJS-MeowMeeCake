import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import productModel from "@/models/productModel";
import * as orderService from "@/services/orderService";
import { makeUser, makeProduct } from "./helpers";

describe("orderService.createOrder → persistOrder (integration)", () => {
  it("happy path: สร้างออเดอร์ + items, ตัดสต็อก, คิดยอดถูก", async () => {
    const user = await makeUser();
    const p1 = await makeProduct({ product_price: 120, product_stock_quantity: 10 });
    const p2 = await makeProduct({ product_price: 80, sale_price: 60, product_stock_quantity: 5 });

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [
        { product_id: String(p1._id), quantity: 2 },
        { product_id: String(p2._id), quantity: 3 },
      ],
    });

    // ยอด: 120*2 + 60*3 = 240 + 180 = 420 · takeaway → ค่าส่ง 0 · ไม่มีส่วนลด
    expect(order.subtotal).toBe(420);
    expect(order.delivery_fee).toBe(0);
    expect(order.total_amount).toBe(420);
    expect(order.items).toHaveLength(2);

    // สต็อกถูกตัด
    expect((await productModel.findById(p1._id).lean())!.product_stock_quantity).toBe(8);
    expect((await productModel.findById(p2._id).lean())!.product_stock_quantity).toBe(2);

    // orderItem snapshot ราคาต่อหน่วยสด (p2 ใช้ sale_price)
    const items = await orderItemModel.find({ order_id: order._id }).lean();
    const byProduct = new Map(items.map((it) => [String(it.product_id), it]));
    expect(byProduct.get(String(p2._id))!.unit_price).toBe(60);
  });

  it("re-price: ราคาสินค้าเปลี่ยนหลังสร้าง product → ออเดอร์ใหม่ใช้ราคาปัจจุบัน", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 20 });
    await productModel.updateOne({ _id: p._id }, { $set: { product_price: 150 } });

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 1 }],
    });
    expect(order.subtotal).toBe(150);
  });

  it("compensation: สต็อกไม่พอ → throw, ไม่มีออเดอร์, สต็อกไม่เปลี่ยน", async () => {
    const user = await makeUser();
    const ok = await makeProduct({ product_stock_quantity: 10 });
    const low = await makeProduct({ product_stock_quantity: 1 });

    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [
          { product_id: String(ok._id), quantity: 2 },
          { product_id: String(low._id), quantity: 5 }, // เกินสต็อก
        ],
      })
    ).rejects.toThrow();

    expect(await orderModel.countDocuments()).toBe(0);
    expect(await orderItemModel.countDocuments()).toBe(0);
    // deductStockForOrder คืนสต็อกที่ตัดไปบางส่วนแล้ว
    expect((await productModel.findById(ok._id).lean())!.product_stock_quantity).toBe(10);
    expect((await productModel.findById(low._id).lean())!.product_stock_quantity).toBe(1);
  });

  it("preorder product → reject (ต้องสั่งผ่านระบบ preorder)", async () => {
    const user = await makeUser();
    const pre = await makeProduct({ product_type: "preorder", product_stock_quantity: null });
    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [{ product_id: String(pre._id), quantity: 1 }],
      })
    ).rejects.toThrow(/พรีออเดอร์/);
  });
});
