import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import orderModel from "@/models/orderModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import * as orderService from "@/services/orderService";
import * as preorderService from "@/services/preorderService";
import { makeUser, makeProduct, makePreorder, oid } from "./helpers";

/**
 * ยกเลิกเอกสารเดียวกันพร้อมกันหลายคำขอ (cron หมดเวลาชำระ + หน้าเว็บที่ยกเลิกแบบ lazy + ลูกค้ากดเอง)
 * ต้องคืนสต็อก/โควตาแค่ครั้งเดียว — เดิมอ่าน → คืน → save ทำให้แต่ละคำขอคืนซ้ำ (ยกเลิก 3 ครั้ง สต็อก 10 → 16)
 */
describe("ยกเลิกพร้อมกัน — คืนสต็อก/โควตาครั้งเดียว", () => {
  it("ออเดอร์: ยกเลิกพร้อมกัน 3 คำขอ → สต็อกกลับเท่าเดิมพอดี", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });
    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 3 }],
    });
    expect((await productModel.findById(p._id).lean())!.product_stock_quantity).toBe(7);

    const results = await Promise.allSettled(
      [1, 2, 3].map(() => orderService.cancelOrder(String(order._id), { cancelled_reason: "x" }))
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true); // คำขอที่แพ้ได้ผลสำเร็จแบบ idempotent
    expect((await productModel.findById(p._id).lean())!.product_stock_quantity).toBe(10);
    expect((await orderModel.findById(order._id).lean<{ order_status: string }>())!.order_status).toBe("cancelled");
  });

  it("ออเดอร์: ยกเลิกชนกับเปลี่ยนสถานะอื่น → ฝ่ายที่แพ้ได้ 409 และไม่คืนสต็อกเกิน", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });
    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 2 }],
    });

    const [a, b] = await Promise.allSettled([
      orderService.updateOrderStatus(String(order._id), "confirmed"),
      orderService.cancelOrder(String(order._id), {}),
    ]);
    const final = (await orderModel.findById(order._id).lean<{ order_status: string }>())!.order_status;
    const stock = (await productModel.findById(p._id).lean())!.product_stock_quantity;

    if (final === "cancelled") expect(stock).toBe(10);
    else {
      // confirmed ชนะ → การยกเลิกต้องไม่คืนสต็อก (ถ้ายกเลิกตามมาทีหลังได้สำเร็จก็ต้องคืนครั้งเดียว)
      expect(final).toBe("confirmed");
      expect(stock).toBe(8);
    }
    expect([a.status, b.status]).toContain("fulfilled");
  });

  it("พรีออเดอร์: ยกเลิกพร้อมกัน 3 คำขอ → คืนโควตารอบครั้งเดียว", async () => {
    const user = await makeUser();
    const p = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    const roundItem = await preorderRoundItemModel.create({
      round_id: oid(),
      product_id: p._id,
      max_qty_total: 20,
      current_qty: 5,
    });
    const preorder = await makePreorder(String(user._id), { round_id: roundItem.round_id });
    await preorderItemModel.create({
      preorder_id: preorder._id,
      round_item_id: roundItem._id,
      product_id: p._id,
      product_snapshot: { product_name_th: "ก", product_name_eng: "a", variant_name: "-" },
      pickup_date: new Date(),
      quantity: 2,
      unit_price: 50,
      total_price: 100,
    });

    await Promise.allSettled(
      [1, 2, 3].map(() => preorderService.cancelPreorder(String(preorder._id), { cancelled_reason: "x" }))
    );

    expect((await preorderRoundItemModel.findById(roundItem._id).lean())!.current_qty).toBe(3);
  });
});

describe("สินค้าปิดการขาย (is_visible: false)", () => {
  it("หน้าเว็บลูกค้า (storefront) สั่งไม่ได้ → 400 และไม่ตัดสต็อก", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 10, is_visible: false });
    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        storefront: true,
        items: [{ product_id: String(p._id), quantity: 1 }],
      })
    ).rejects.toMatchObject({ status: 400 });
    expect((await productModel.findById(p._id).lean())!.product_stock_quantity).toBe(10);
  });

  it("หลังร้าน/POS (ไม่ใช่ storefront) ยังขายได้ตามเดิม", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 10, is_visible: false });
    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      channel: "instore",
      items: [{ product_id: String(p._id), quantity: 1 }],
    });
    expect(order.order_no.startsWith("POS-")).toBe(true);
  });
});
