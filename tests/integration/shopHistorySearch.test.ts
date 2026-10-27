import { describe, it, expect } from "vitest";
import * as cartService from "@/services/cartService";
import * as orderService from "@/services/orderService";
import { makeUser, makeProduct } from "./helpers";

/**
 * ประวัติการสั่งซื้อของลูกค้า — ค้นหาเลขออเดอร์ หรือชื่อสินค้าในออเดอร์ (search_items · GET /api/shop/orders?search=)
 * พรีออเดอร์ใช้โค้ดแบบเดียวกัน (preorderService.listPreorders)
 */
const page = { page: 1, limit: 20, skip: 0 };

async function orderWith(uid: string, name: string) {
  const p = await makeProduct({ product_name_th: name, product_name_eng: `${name} EN` });
  await cartService.addItem(uid, { product_id: String(p._id), quantity: 1 });
  return (await orderService.createOrderFromCart(uid, { order_type: "takeaway", storefront: true })) as { _id: unknown; order_no: string };
}

describe("ค้นหาประวัติการสั่งซื้อ (search_items)", () => {
  it("ค้นจากชื่อสินค้า (ไทย/อังกฤษ ไม่สนตัวพิมพ์) และเลขออเดอร์ · เห็นเฉพาะของตัวเอง", async () => {
    const me = String((await makeUser())._id);
    const other = String((await makeUser())._id);
    const croissant = await orderWith(me, "ครัวซองต์เนยสด");
    await orderWith(me, "บราวนี่");
    await orderWith(other, "ครัวซองต์อัลมอนด์");

    const list = async (search: string) =>
      ((await orderService.listOrders({ pagination: page, user_id: me, search, search_items: true })) as { items: { order_no: string }[] }).items.map((o) => o.order_no);

    expect(await list("ครัวซอง")).toEqual([croissant.order_no]);
    expect(await list("ครัวซองต์เนยสด en")).toEqual([croissant.order_no]);
    expect(await list(croissant.order_no.slice(-6))).toEqual([croissant.order_no]);
    expect(await list("ไม่มีสินค้านี้")).toEqual([]);
  });

  it("ไม่ใส่ search_items (หลังร้าน) = ค้นเลขออเดอร์อย่างเดียวเหมือนเดิม", async () => {
    const me = String((await makeUser())._id);
    await orderWith(me, "ชิโอะปัง");
    const res = (await orderService.listOrders({ pagination: page, user_id: me, search: "ชิโอะ" })) as { items: unknown[] };
    expect(res.items).toHaveLength(0);
  });
});
