import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import productVariantModel from "@/models/productVariantModel";
import productionItemModel from "@/models/productionItemModel";
import * as orderService from "@/services/orderService";
import * as cartService from "@/services/cartService";
import * as productService from "@/services/productService";
import * as productionOrderService from "@/services/productionOrderService";
import { productVariantService } from "@/services/productVariantService";
import { makeUser, makeProduct, makeVariant, makeRecipe } from "./helpers";

/**
 * docs/BACKLOG4.md Y9 (ตัดสินใจ 2026-10-01) — สต็อกแยกต่อ variant + สต็อกสินค้า = ผลรวม variant_stock
 */

const productStock = async (id: unknown) =>
  (await productModel.findById(id).lean<{ product_stock_quantity: number | null }>())!.product_stock_quantity;
const variantStock = async (id: unknown) =>
  (await productVariantModel.findById(id).lean<{ variant_stock: number }>())!.variant_stock;

/** เค้ก 3 ไซส์ S0 / M5 / L3 → สต็อกรวม 8 */
async function cakeWithSizes() {
  const cake = await makeProduct({ product_price: 100, product_stock_quantity: 8 });
  const [s, m, l] = [
    await makeVariant(String(cake._id), { variant_name: "S", variant_stock: 0 }),
    await makeVariant(String(cake._id), { variant_name: "M", variant_stock: 5 }),
    await makeVariant(String(cake._id), { variant_name: "L", variant_stock: 3 }),
  ];
  return { cake, s, m, l };
}

describe("variant stock (BACKLOG4 Y9)", () => {
  it("สั่ง M 2 ชิ้น → ตัดทั้ง M และสต็อกรวม · ยกเลิก → คืนทั้งคู่", async () => {
    const user = await makeUser();
    const { cake, m } = await cakeWithSizes();

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(cake._id), variant_id: String(m._id), quantity: 2 }],
    });
    expect(await variantStock(m._id)).toBe(3);
    expect(await productStock(cake._id)).toBe(6);

    await orderService.cancelOrder(String(order._id), { cancelled_by: String(user._id) });
    expect(await variantStock(m._id)).toBe(5);
    expect(await productStock(cake._id)).toBe(8);
  });

  it("S หมด → สั่ง S ไม่ได้ (409) แม้สต็อกรวมยังเหลือ · ไม่มีอะไรถูกตัดค้าง", async () => {
    const user = await makeUser();
    const { cake, s, m } = await cakeWithSizes();

    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [
          { product_id: String(cake._id), variant_id: String(m._id), quantity: 1 },
          { product_id: String(cake._id), variant_id: String(s._id), quantity: 1 },
        ],
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(await productStock(cake._id)).toBe(8);
    expect(await variantStock(m._id)).toBe(5);
    expect(await variantStock(s._id)).toBe(0);
  });

  it("สินค้ามีตัวเลือก แต่ไม่ระบุ variant → 400 ทั้งออเดอร์และตะกร้า", async () => {
    const user = await makeUser();
    const { cake } = await cakeWithSizes();
    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [{ product_id: String(cake._id), quantity: 1 }],
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      cartService.addItem(String(user._id), { product_id: String(cake._id), quantity: 1 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("checkStockAvailability — variant ที่หมดคืน ok=false", async () => {
    const { cake, s, l } = await cakeWithSizes();
    const res = await productService.checkStockAvailability([
      { product_id: String(cake._id), variant_id: String(l._id), quantity: 3 },
      { product_id: String(cake._id), variant_id: String(s._id), quantity: 1 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.items.map((i) => i.ok)).toEqual([true, false]);
  });

  it("ปรับสต็อกที่ตัวสินค้าตรง ๆ ถูกปฏิเสธ (409) — ต้องปรับที่ variant", async () => {
    const { cake } = await cakeWithSizes();
    await expect(productService.setStock(String(cake._id), 20)).rejects.toMatchObject({ status: 409 });
    await expect(productService.increaseStock(String(cake._id), 1)).rejects.toMatchObject({ status: 409 });
  });

  it("แอดมินแก้ variant → สต็อกรวมตามผลรวม (สร้างตัวแรก / แก้ / ลบ / กู้คืน)", async () => {
    // สินค้าเดิมมีสต็อก 10 แบบไม่แยกตัวเลือก → variant ตัวแรกทำให้สต็อกรวม = ผลรวม variant
    const cake = await makeProduct({ product_stock_quantity: 10 });
    const s = (await productVariantService.create({
      product_id: String(cake._id),
      variant_name: "S",
      variant_stock: 4,
    })) as { _id: unknown };
    expect(await productStock(cake._id)).toBe(4);

    const m = (await productVariantService.create({
      product_id: String(cake._id),
      variant_name: "M",
      variant_stock: 6,
    })) as { _id: unknown };
    expect(await productStock(cake._id)).toBe(10);

    await productVariantService.update(String(m._id), { variant_stock: 1 });
    expect(await productStock(cake._id)).toBe(5);

    await productVariantService.remove(String(s._id));
    expect(await productStock(cake._id)).toBe(1);

    await productVariantService.restore(String(s._id));
    expect(await productStock(cake._id)).toBe(5);
  });

  it("ยกเลิกออเดอร์ของ variant ที่ถูกลบไปแล้ว → สต็อกรวมยังเท่าผลรวม variant ที่เหลือ", async () => {
    const user = await makeUser();
    const { cake, m, l } = await cakeWithSizes();
    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(cake._id), variant_id: String(l._id), quantity: 2 }],
    });
    expect(await productStock(cake._id)).toBe(6); // M5 + L1
    await productVariantService.remove(String(l._id)); // L เหลือ 1 → ออกจากผลรวม
    expect(await productStock(cake._id)).toBe(5);

    await orderService.cancelOrder(String(order._id), { cancelled_by: String(user._id) });
    expect(await productStock(cake._id)).toBe(await variantStock(m._id));
  });

  it("ปิดงานผลิตสินค้าที่มีตัวเลือก → ไม่เพิ่มสต็อกอัตโนมัติ (ยังไม่รู้ว่าได้ตัวเลือกไหน)", async () => {
    const { cake } = await cakeWithSizes();
    const admin = await makeUser();
    const recipe = await makeRecipe(String(cake._id));
    const order = (await productionOrderService.createProductionOrder({
      production_date: new Date(),
      items: [{ product_id: String(cake._id), recipe_id: String(recipe._id), planned_qty: 10 }],
    })) as { _id: unknown };
    await productionOrderService.startProduction(String(order._id));
    await productionOrderService.completeProduction(String(order._id), { performed_by: String(admin._id) });

    expect(await productStock(cake._id)).toBe(8);
    const item = await productionItemModel
      .findOne({ production_order_id: order._id })
      .lean<{ product_stock_added_at: Date | null }>();
    expect(item!.product_stock_added_at).toBeNull();
  });
});
