import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import productStockTransactionModel from "@/models/productStockTransactionModel";
import * as productService from "@/services/productService";
import * as orderService from "@/services/orderService";
import * as productionOrderService from "@/services/productionOrderService";
import * as productStockHistoryService from "@/services/productStockHistoryService";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * ประวัติสต็อกสินค้า (ProductStockTransactions) — productService บันทึกทุกทางที่สต็อกเปลี่ยน
 * ยอดก่อน/หลังต้องต่อกันเป็นสายเดียวกับ product_stock_quantity จริง
 */

type Txn = {
  type: string;
  delta: number;
  qty_before: number;
  qty_after: number;
  note: string;
  ref_type: string | null;
  ref_id: unknown;
  performed_by: unknown;
};

const historyOf = (productId: unknown) =>
  productStockTransactionModel.find({ product_id: productId }).sort({ created_at: 1, _id: 1 }).lean<Txn[]>();

const stockOf = async (productId: unknown) =>
  (await productModel.findById(productId).lean<{ product_stock_quantity: number }>())!.product_stock_quantity;

describe("ประวัติสต็อกสินค้า — ปรับเองจากหน้าสต็อก", () => {
  it("รับเข้า / เบิกใช้ / ปรับยอด → receive / use / adjust พร้อมยอดก่อน → หลัง ผู้ทำ และหมายเหตุ", async () => {
    const admin = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 10 });
    const by = String(admin._id);

    await productService.adjustStock(String(p._id), 5, { log: { performed_by: by, note: " ของเข้า " } });
    await productService.decreaseStock(String(p._id), 2, { log: { performed_by: by, note: "ตกแตก" } });
    const { before } = await productService.setStockDetailed(String(p._id), 11, { performed_by: by });

    expect(before).toBe(13);
    const h = await historyOf(p._id);
    expect(h.map((t) => [t.type, t.delta, t.qty_before, t.qty_after])).toEqual([
      ["receive", 5, 10, 15],
      ["use", -2, 15, 13],
      ["adjust", -2, 13, 11],
    ]);
    expect(h[0].note).toBe("ของเข้า");
    expect(h[1].note).toBe("ตกแตก");
    expect(h.every((t) => String(t.performed_by) === by)).toBe(true);
    expect(await stockOf(p._id)).toBe(11);
  });

  it("เบิกเกินที่มี (409) → ไม่มีประวัติ", async () => {
    const p = await makeProduct({ product_stock_quantity: 1 });
    await expect(productService.adjustStock(String(p._id), -5)).rejects.toMatchObject({ status: 409 });
    expect(await historyOf(p._id)).toHaveLength(0);
  });
});

describe("ประวัติสต็อกสินค้า — ออเดอร์", () => {
  it("สร้างออเดอร์ → sale ผูกออเดอร์ · ยกเลิก → sale_return พร้อมผู้ยกเลิกและเหตุผล", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 3 }],
    });
    await orderService.cancelOrder(String(order._id), { cancelled_by: String(user._id), cancelled_reason: "เปลี่ยนใจ" });

    const h = await historyOf(p._id);
    expect(h.map((t) => [t.type, t.delta, t.qty_before, t.qty_after])).toEqual([
      ["sale", -3, 10, 7],
      ["sale_return", 3, 7, 10],
    ]);
    expect(h.every((t) => t.ref_type === "order" && String(t.ref_id) === String(order._id))).toBe(true);
    expect(h[0].performed_by).toBeNull();
    expect(String(h[1].performed_by)).toBe(String(user._id));
    expect(h[1].note).toBe("ยกเลิกออเดอร์: เปลี่ยนใจ");

    // หน้าประวัติแสดงชื่อลูกค้าของออเดอร์ได้ แม้แถวขายไม่มีผู้ทำ (performed_by null)
    const listed = await productStockHistoryService.listHistory({ product_id: String(p._id), pagination: { page: 1, limit: 10, skip: 0 } });
    expect(listed.items.every((t) => t.ref_customer?.user_fullname === user.user_fullname && t.ref_no === order.order_no)).toBe(true);
  });

  it("สต็อกไม่พอบางรายการ → ตัดไม่สำเร็จทั้งออเดอร์ ไม่มีประวัติ sale ค้าง", async () => {
    const enough = await makeProduct({ product_stock_quantity: 10 });
    const short = await makeProduct({ product_stock_quantity: 1 });
    await expect(
      productService.deductStockForOrder([
        { product_id: String(enough._id), quantity: 2 },
        { product_id: String(short._id), quantity: 5 },
      ])
    ).rejects.toMatchObject({ status: 409 });
    expect(await stockOf(enough._id)).toBe(10);
    expect(await historyOf(enough._id)).toHaveLength(0);
    expect(await historyOf(short._id)).toHaveLength(0);
  });
});

describe("ประวัติสต็อกสินค้า — ปิดงานผลิต", () => {
  it("เพิ่มสินค้าสำเร็จรูป → production ผูกใบสั่งผลิต + ผู้ปิดงาน · listHistory คืนเลขใบสั่งผลิต", async () => {
    const admin = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 4 });
    const recipe = await makeRecipe(String(p._id));
    const order = (await productionOrderService.createProductionOrder({
      production_date: new Date(),
      items: [{ product_id: String(p._id), recipe_id: String(recipe._id), planned_qty: 6 }],
    })) as { _id: unknown; production_no: string };
    await productionOrderService.startProduction(String(order._id));
    await productionOrderService.completeProduction(String(order._id), { performed_by: String(admin._id) });

    const h = await historyOf(p._id);
    expect(h.map((t) => [t.type, t.delta, t.qty_before, t.qty_after])).toEqual([["production", 6, 4, 10]]);
    expect(String(h[0].performed_by)).toBe(String(admin._id));

    const listed = await productStockHistoryService.listHistory({
      pagination: { page: 1, limit: 20, skip: 0 },
      product_id: String(p._id),
    });
    expect(listed.meta.total).toBe(1);
    expect(listed.items[0]).toMatchObject({ type: "production", ref_type: "production_order", ref_no: order.production_no });
    expect(listed.items[0].product_id).toMatchObject({ product_name_th: p.product_name_th });
    expect(listed.items[0].performed_by).toMatchObject({ _id: admin._id });
  });
});

describe("listHistory — ตัวกรอง", () => {
  it("กรองตามชนิด + ช่วงวันที่ (วันไทย) · ชนิดไม่รู้จัก = 400", async () => {
    const p = await makeProduct({ product_stock_quantity: 0 });
    await productService.adjustStock(String(p._id), 3);
    await productService.adjustStock(String(p._id), -1);
    const pagination = { page: 1, limit: 20, skip: 0 };

    const receives = await productStockHistoryService.listHistory({ pagination, product_id: String(p._id), type: "receive" });
    expect(receives.items.map((i: { delta: number }) => i.delta)).toEqual([3]);

    const future = await productStockHistoryService.listHistory({
      pagination,
      product_id: String(p._id),
      date_from: "2999-01-01",
    });
    expect(future.items).toHaveLength(0);

    await expect(
      productStockHistoryService.listHistory({ pagination, type: "steal" })
    ).rejects.toMatchObject({ status: 400 });
  });
});
