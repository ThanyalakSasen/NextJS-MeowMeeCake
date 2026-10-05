import { describe, it, expect } from "vitest";
import productCategoryModel from "@/models/productCategoryModel";
import storeSettingsModel from "@/models/storeSettingsModel";
import storeProfileModel from "@/models/storeProfileModel";
import orderModel from "@/models/orderModel";
import * as orderService from "@/services/orderService";
import * as shippingService from "@/services/shippingService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { bangkokDateKey, DAY_ORDER } from "@/lib/pickupLocations";
import { makeUser, makeProduct } from "./helpers";

/** ขั้น 4 — ค่าส่ง ShippingZones + ขอบเขตจัดส่ง + จุดรับสินค้า ของออเดอร์เว็บ (docs/customer-backend-merge.md §8.7) */

const address = (province: string) => ({
  recipient_name: "ลูกค้า",
  recipient_phone: "0812345678",
  house_no: "1",
  sub_district: "ในเมือง",
  district: "เมือง",
  province,
  zip_code: "43000",
});

async function webOrder(productId: string, province: string, extra: Record<string, unknown> = {}) {
  const user = await makeUser();
  return (await orderService.createOrder(String(user._id), {
    order_type: "delivery",
    delivery_address: address(province),
    items: [{ product_id: productId, quantity: 1 }],
    storefront: true,
    ...extra,
  })) as { _id: unknown; delivery_fee: number; payment_due_at: Date | null };
}

describe("ค่าส่งออเดอร์เว็บ (ShippingZones)", () => {
  it("ยังไม่มีโซนใน DB → สร้าง A–D ให้ · ค่าส่งตามจังหวัด · ไม่ส่งฟรีตามยอด", async () => {
    const zones = await shippingService.getShippingZones();
    expect(zones.map((z) => z.zone_code)).toEqual(["A", "B", "C", "D"]);

    const cat = await productCategoryModel.create({ product_category_name: "ซาวโดว์", ships_nationwide: true });
    const p = await makeProduct({ product_price: 2000, category_id: cat._id, product_stock_quantity: 10 });
    expect((await webOrder(String(p._id), "หนองคาย")).delivery_fee).toBe(40);
    expect((await webOrder(String(p._id), "อุดรธานี")).delivery_fee).toBe(60);
    expect((await webOrder(String(p._id), "กรุงเทพมหานคร")).delivery_fee).toBe(100); // ยอด 2000 ก็ยังเสียค่าส่ง
  });

  it("หมวดที่ไม่ส่งทั่วประเทศ → ส่งได้เฉพาะจังหวัดร้าน (นอกจังหวัด = 400)", async () => {
    await storeSettingsModel.create({ province: "หนองคาย" });
    const cake = await productCategoryModel.create({ product_category_name: "เค้กสด", ships_nationwide: false });
    const p = await makeProduct({ category_id: cake._id, product_stock_quantity: 10 });
    await expect(webOrder(String(p._id), "อุดรธานี")).rejects.toMatchObject({ status: 400 });
    expect((await webOrder(String(p._id), "หนองคาย")).delivery_fee).toBe(40);
  });

  it("พรีออเดอร์จากหน้าเว็บ → ShippingZones · จากหลังร้าน → DeliveryZones", async () => {
    const p = await makeProduct({
      is_preorder: true, product_stock_quantity: null, product_price: 300,
      preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: 1 },
    });
    const admin = await makeUser();
    const DAY = 24 * 60 * 60 * 1000;
    const round = (await preorderRoundService.createRound(
      {
        round_name: `รอบค่าส่ง-${Date.now()}`, open_date: new Date(Date.now() - 1000), close_date: new Date(Date.now() + DAY),
        pickup_date: new Date(Date.now() + 5 * DAY), round_status: "open",
        items: [{ product_id: String(p._id), max_qty_total: 100 }],
      },
      String(admin._id)
    )) as { _id: unknown; items: Array<{ _id: unknown }> };
    const order = (storefront: boolean) =>
      makeUser().then((u) =>
        preorderService.createPreorder(
          String(u._id),
          {
            round_id: String(round._id), order_type: "delivery", delivery_address: address("กรุงเทพมหานคร"),
            items: [{ round_item_id: String(round.items[0]._id), quantity: 1 }],
          },
          { storefront }
        )
      ) as Promise<{ delivery_fee: number }>;
    expect((await order(true)).delivery_fee).toBe(100); // Zone D
    expect((await order(false)).delivery_fee).toBe(40); // DeliveryZones fallback กรุงเทพฯ
  });

  it("หลังร้าน (ไม่ใช่ storefront) ยังคิดจาก DeliveryZones · ไม่มีกำหนดชำระ", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 5 });
    const order = (await orderService.createOrder(String(user._id), {
      order_type: "delivery",
      delivery_address: address("กรุงเทพมหานคร"),
      items: [{ product_id: String(p._id), quantity: 1 }],
    })) as { delivery_fee: number; payment_due_at: Date | null };
    expect(order.delivery_fee).toBe(40); // fallback DeliveryZones: กรุงเทพฯ + ปริมณฑล
    expect(order.payment_due_at ?? null).toBeNull();
  });
});

describe("จุดรับสินค้า (หน้าร้านประจำสัปดาห์)", () => {
  async function setupMarket() {
    await storeProfileModel.create({
      business_hours_migrated: true,
      weekly_markets: [
        { name: "ตลาดนัดทุกวัน", location: "ลานจอดรถ", days: DAY_ORDER, open_time: "00:00", close_time: "23:59" },
        { name: "งดออกร้าน", days: DAY_ORDER, is_active: false },
      ],
    });
    const [loc] = await shippingService.getActivePickupLocations();
    return loc;
  }

  it("เลือกจุด + วันที่เปิด → บันทึก snapshot · วันผิด = 400 · ไม่ส่ง = รับที่ร้านแบบเดิม", async () => {
    const loc = await setupMarket();
    expect((await shippingService.getActivePickupLocations()).map((l) => l.name)).toEqual(["ตลาดนัดทุกวัน"]);

    const user = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 10 });
    const tomorrow = bangkokDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000))!;
    const takeaway = (extra: Record<string, unknown>) =>
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [{ product_id: String(p._id), quantity: 1 }],
        storefront: true,
        ...extra,
      }) as Promise<{ _id: unknown }>;

    const order = await takeaway({ pickup_location_id: loc._id, pickup_date: tomorrow });
    const saved = await orderModel.findById(order._id).lean<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(saved.pickup_point.point_name).toBe("ตลาดนัดทุกวัน");
    expect(bangkokDateKey(saved.pickup_date)).toBe(tomorrow);

    await expect(takeaway({ pickup_location_id: loc._id, pickup_date: "2000-01-01" })).rejects.toMatchObject({ status: 400 });
    const plain = await orderModel.findById((await takeaway({}))._id).lean<{ pickup_point: unknown }>();
    expect(plain!.pickup_point).toBeNull();
  });

  it("ร้านยังไม่เคยย้ายเวลาทำการ → สร้างรายการหน้าร้านจาก business_hours ครั้งเดียว", async () => {
    await storeSettingsModel.create({ province: "หนองคาย", district: "เมือง" });
    await storeProfileModel.create({ store_name: "เหมียวมี่" });
    const first = await shippingService.getActivePickupLocations();
    expect(first).toHaveLength(1);
    expect(first[0].name).toBe("หน้าร้าน เหมียวมี่");
    expect(first[0].days).toEqual(DAY_ORDER);
    expect(await shippingService.getActivePickupLocations()).toHaveLength(1); // ไม่สร้างซ้ำ
  });
});
