import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import { revenueByProductType } from "@/services/dashboardService";
import { makeUser, makeProduct, oid } from "./helpers";

/**
 * dashboardService.revenueByProductType — รายรับแยกตาม product_type ให้หน้าสรุปกำไร-ขาดทุน
 * จุดเสี่ยง: ผลรวมทุกกลุ่มต้องตรง total_amount เป๊ะ (ค่าส่ง/ส่วนลดกระจายตามสัดส่วน ไม่ทำเงินหาย/เกิน)
 * ตัวเลขทั้งหมดในเทสนี้เป็นสตางค์ตอนสร้างข้อมูล (BACKLOG §3.11) และผลลัพธ์เป็นบาท
 */
describe("revenueByProductType", () => {
  // ใช้ช่วงวันที่แคบ ๆ ของแต่ละเทสเพื่อไม่ให้ข้อมูลเทสอื่นปนกัน (DB ใช้ร่วมกันทั้งไฟล์)
  const day = (d: number) => new Date(Date.UTC(2031, 0, d, 5, 0, 0));
  const range = (d: number) => ({ date_from: day(d).toISOString(), date_to: new Date(day(d).getTime() + 3_600_000).toISOString() });

  async function order(d: number, totalSatang: number, items: Array<{ product: { _id: unknown }; total: number }>, over: Record<string, unknown> = {}) {
    const user = await makeUser();
    const o = await orderModel.create({
      order_no: `OP-RT-${Date.now()}-${Math.random()}`,
      user_id: user._id,
      order_type: "takeaway",
      payment_status: "paid",
      subtotal: items.reduce((s, i) => s + i.total, 0),
      discount_amount: 0,
      delivery_fee: 0,
      total_amount: totalSatang,
      created_at: day(d),
      ...over,
    });
    for (const it of items) {
      await orderItemModel.create({
        order_id: o._id,
        product_id: it.product._id,
        product_snapshot: { product_name_th: "x", product_name_eng: "x" },
        quantity: 1,
        unit_price: it.total,
        total_price: it.total,
      });
    }
    return o;
  }

  it("แยกยอดตาม product_type: หน้าร้าน / ออนไลน์ / พรีออเดอร์", async () => {
    const a = await makeProduct({ product_type: "inStore" });
    const b = await makeProduct({ product_type: "online" });
    const c = await makeProduct({ product_type: "preorder" });
    await order(1, 10000, [{ product: a, total: 10000 }]);
    await order(1, 25050, [{ product: b, total: 25050 }]);
    await order(1, 7000, [{ product: c, total: 7000 }]);

    const r = await revenueByProductType(range(1));

    expect(r).toMatchObject({ in_store: 100, online: 250.5, preorder: 70, unclassified: 0, total: 420.5, orders: 3 });
  });

  it("ออเดอร์ที่ปนหลายประเภท + ค่าส่ง − ส่วนลด: กระจายตามสัดส่วนและผลรวมตรง total_amount เป๊ะ", async () => {
    const a = await makeProduct({ product_type: "inStore" });
    const b = await makeProduct({ product_type: "online" });
    // สินค้า 100 บาท (หน้าร้าน) + 200 บาท (ออนไลน์) = 300 · ค่าส่ง 50 · ส่วนลด 20 → total 330 บาท
    // ส่วนเกิน +30 บาท กระจาย 1:2 → หน้าร้าน 100+10=110, ออนไลน์ 200+20=220
    await order(2, 33000, [{ product: a, total: 10000 }, { product: b, total: 20000 }], { delivery_fee: 5000, discount_amount: 2000 });

    const r = await revenueByProductType(range(2));

    expect(r.in_store).toBe(110);
    expect(r.online).toBe(220);
    expect(r.in_store + r.online + r.preorder + r.unclassified).toBeCloseTo(r.total, 2);
    expect(r.total).toBe(330);
  });

  it("เศษสตางค์จากการหารสัดส่วนไม่ทำให้ยอดรวมเพี้ยน (3 ประเภท เศษไม่ลงตัว)", async () => {
    const a = await makeProduct({ product_type: "inStore" });
    const b = await makeProduct({ product_type: "online" });
    const c = await makeProduct({ product_type: "preorder" });
    // สินค้ารวม 3 สตางค์ต่อประเภท ค่าส่ง 1 สตางค์ → ส่วนเกินหารสามไม่ลงตัว
    await order(3, 1000 + 1000 + 1000 + 1, [{ product: a, total: 1000 }, { product: b, total: 1000 }, { product: c, total: 1000 }], { delivery_fee: 1 });

    const r = await revenueByProductType(range(3));

    expect(Math.round((r.in_store + r.online + r.preorder + r.unclassified) * 100)).toBe(3001);
    expect(Math.round(r.total * 100)).toBe(3001);
  });

  it("ไม่นับออเดอร์ที่ยังไม่ชำระ / ถูกลบ / อยู่นอกช่วงวันที่", async () => {
    const b = await makeProduct({ product_type: "online" });
    await order(4, 10000, [{ product: b, total: 10000 }]); // นับ
    await order(4, 99900, [{ product: b, total: 99900 }], { payment_status: "pending" });
    await order(4, 88800, [{ product: b, total: 88800 }], { deleted_at: new Date() });
    await order(9, 77700, [{ product: b, total: 77700 }]); // คนละวัน

    const r = await revenueByProductType(range(4));

    expect(r).toMatchObject({ online: 100, total: 100, orders: 1 });
  });

  it("สินค้าที่หาไม่เจอ หรือออเดอร์ไม่มีรายการ → unclassified (ยอดรวมยังครบ)", async () => {
    await order(5, 5000, [{ product: { _id: oid() }, total: 5000 }]); // product_id ที่ไม่มีอยู่จริง
    await order(5, 3000, []); // ไม่มีรายการเลย

    const r = await revenueByProductType(range(5));

    expect(r).toMatchObject({ in_store: 0, online: 0, preorder: 0, unclassified: 80, total: 80, orders: 2 });
  });

  it("ไม่มีออเดอร์ในช่วง → ศูนย์ทุกช่อง ไม่ throw", async () => {
    expect(await revenueByProductType(range(20))).toEqual({ in_store: 0, online: 0, preorder: 0, unclassified: 0, total: 0, orders: 0 });
  });
});
