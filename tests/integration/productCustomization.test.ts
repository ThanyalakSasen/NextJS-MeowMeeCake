import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import orderItemModel from "@/models/orderItemModel";
import * as orderService from "@/services/orderService";
import * as cartService from "@/services/cartService";
import * as productService from "@/services/productService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import preorderItemModel from "@/models/preorderItemModel";
import {
  getProductCustomization,
  saveProductCustomization,
  LEGACY_GROUP_ID,
} from "@/services/productCustomizationService";
import { makeUser, makeProduct, makeVariant, makeOption } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ตัวเลือกสินค้าแบบกลุ่ม (ย้ายมาจาก backend ฝั่งลูกค้า · docs/customer-backend-merge.md §8)
 * ตัวเลือกเป็นแค่ราคาบวกเพิ่ม — ไม่มีสต็อกแยก (เลิก Y9) สต็อกอยู่ที่ตัวสินค้า
 */

const DAY = 24 * 60 * 60 * 1000;

const stock = async (id: unknown) =>
  (await productModel.findById(id).lean<{ product_stock_quantity: number | null }>())!.product_stock_quantity;

/** เค้ก 300 บาท: ขนาด (เลือก 1: 1 ปอนด์ +0 / 2 ปอนด์ +200) · รสชาติ (เลือก 1–2) · เทียน +20 · ข้อความ (ไม่บังคับ) */
async function birthdayCake() {
  const cake = await makeProduct({ product_price: 300, product_stock_quantity: 10 });
  const custom = await saveProductCustomization(String(cake._id), {
    groups: [
      {
        group_name: "ขนาด", min_select: 1, max_select: 1,
        variants: [
          { variant_name: "1 ปอนด์", variant_price: 0 },
          { variant_name: "2 ปอนด์", variant_price: 200 },
        ],
      },
      {
        group_name: "รสชาติ", min_select: 1, max_select: 2,
        variants: [
          { variant_name: "ช็อกโกแลต", variant_price: 0 },
          { variant_name: "วานิลลา", variant_price: 10 },
          { variant_name: "มะยงชิด", variant_price: 50 },
        ],
      },
    ],
    options: [
      { option_name: "เทียน", extra_price: 20 },
      { option_name: "ข้อความบนเค้ก", is_text_input: true, max_text_length: 20, extra_price: 0 },
    ],
  });
  const v = (group: number, i: number) => custom.groups[group].variants[i]._id;
  return { cake, custom, v };
}

describe("productCustomization — กลุ่มตัวเลือกบวกราคา", () => {
  it("บันทึกทั้งชุด → อ่านคืนตามลำดับ · แก้ชุดใหม่ = ตัวที่หายไปถูกลบ", async () => {
    const { cake, custom } = await birthdayCake();
    expect(custom.groups.map((g) => g.group_name)).toEqual(["ขนาด", "รสชาติ"]);
    expect(custom.groups[1].max_select).toBe(2);
    expect(custom.options.map((o) => o.option_name)).toEqual(["เทียน", "ข้อความบนเค้ก"]);

    const next = await saveProductCustomization(String(cake._id), {
      groups: [{ _id: custom.groups[0]._id, group_name: "ขนาดเค้ก", variants: [custom.groups[0].variants[1]] }],
      options: [],
    });
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0]._id).toBe(custom.groups[0]._id);
    expect(next.groups[0].variants.map((x) => x._id)).toEqual([custom.groups[0].variants[1]._id]);
    expect(next.options).toEqual([]);
  });

  it('ตัวเลือกเก่าที่ไม่มีกลุ่ม → กลุ่ม "ตัวเลือก" เลือก 1 (บังคับ)', async () => {
    const p = await makeProduct();
    await makeVariant(String(p._id), { variant_name: "S" });
    const c = await getProductCustomization(String(p._id));
    expect(c.groups).toHaveLength(1);
    expect(c.groups[0]).toMatchObject({ _id: LEGACY_GROUP_ID, min_select: 1, max_select: 1 });
  });

  it("บันทึกผิดกติกา → 400 และไม่เขียนอะไร", async () => {
    const { cake } = await birthdayCake();
    await expect(
      saveProductCustomization(String(cake._id), {
        groups: [{ group_name: "ขนาด", min_select: 3, max_select: 3, variants: [{ variant_name: "A" }] }],
        options: [],
      })
    ).rejects.toMatchObject({ status: 400 });
    expect((await getProductCustomization(String(cake._id))).groups).toHaveLength(2);
  });

  it("สั่งซื้อ: ราคา = สินค้า + ตัวเลือกทุกกลุ่ม + ออปชัน · snapshot ครบ · ตัดสต็อกที่ตัวสินค้า", async () => {
    const user = await makeUser();
    const { cake, custom, v } = await birthdayCake();
    const order = (await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [
        {
          product_id: String(cake._id),
          variant_ids: [v(0, 1), v(1, 1), v(1, 2)],
          selected_options: [
            { option_id: custom.options[0]._id },
            { option_id: custom.options[1]._id, text_value: "  HBD  แม่ " },
          ],
          quantity: 2,
        },
      ],
    })) as { _id: unknown; subtotal: number };

    // 300 + 200 + 10 + 50 + 20 = 580 × 2
    expect(order.subtotal).toBe(1160);
    const item = await orderItemModel.findOne({ order_id: order._id }).lean<any>();
    expect(item.unit_price).toBe(580);
    expect(item.variant_id).toBeNull();
    expect(item.product_snapshot.variant_name).toBe("ขนาด: 2 ปอนด์ · รสชาติ: วานิลลา, มะยงชิด");
    expect(item.selected_variants).toHaveLength(3);
    expect(item.selected_options.map((o: any) => o.text_value)).toEqual([null, "HBD แม่"]);
    expect(await stock(cake._id)).toBe(8);
  });

  it("ไม่เลือกกลุ่มที่บังคับ / เลือกเกิน → 400 · ไม่ตัดสต็อก", async () => {
    const user = await makeUser();
    const { cake, v } = await birthdayCake();
    const create = (variant_ids: string[]) =>
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [{ product_id: String(cake._id), variant_ids, quantity: 1 }],
      });
    await expect(create([v(1, 0)])).rejects.toMatchObject({ status: 400, message: expect.stringContaining("ขนาด") });
    await expect(create([v(0, 0), v(1, 0), v(1, 1), v(1, 2)])).rejects.toMatchObject({ status: 400 });
    expect(await stock(cake._id)).toBe(10);
  });

  it("POS แบบเดิม: variant_id ตัวเดียวใช้กับตัวเลือกเก่าได้ · variant_stock 0 ไม่มีผลแล้ว", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50, product_stock_quantity: 5 });
    const big = await makeVariant(String(p._id), { variant_name: "ใหญ่", variant_price: 15, variant_stock: 0 });
    const order = (await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      channel: "instore",
      items: [{ product_id: String(p._id), variant_id: String(big._id), quantity: 1 }],
    })) as { subtotal: number };
    expect(order.subtotal).toBe(65);
    expect(await stock(p._id)).toBe(4);
  });

  it("ตั้งสต็อกสินค้าที่มีตัวเลือกได้ตรง ๆ (ไม่ 409 แบบ Y9)", async () => {
    const p = await makeProduct({ product_stock_quantity: 1 });
    await makeVariant(String(p._id));
    await productService.setStock(String(p._id), 7);
    expect(await stock(p._id)).toBe(7);
  });

  it("ตะกร้า: ชุดตัวเลือกเดียวกันรวมแถว · ต่างกันแยกแถว · สั่งจากตะกร้าคิดราคาใหม่ครบ", async () => {
    const user = await makeUser();
    const { cake, custom, v } = await birthdayCake();
    const uid = String(user._id);
    const pid = String(cake._id);
    await cartService.addItem(uid, { product_id: pid, variant_ids: [v(0, 0), v(1, 0)], quantity: 1 });
    await cartService.addItem(uid, { product_id: pid, variant_ids: [v(1, 0), v(0, 0)], quantity: 2 });
    await cartService.addItem(uid, {
      product_id: pid,
      variant_ids: [v(0, 1), v(1, 0)],
      selected_options: [{ option_id: custom.options[0]._id }],
      quantity: 1,
    });
    const cart = await cartService.getCartDetail(uid);
    expect(cart.items.map((i: any) => [i.quantity, i.price_snapshot])).toEqual([[3, 300], [1, 520]]);

    const order = (await orderService.createOrderFromCart(uid, { order_type: "takeaway" })) as { subtotal: number };
    expect(order.subtotal).toBe(3 * 300 + 520);
    expect(await stock(cake._id)).toBe(6);
  });

  it("พรีออเดอร์: ราคารอบ + ตัวเลือก · snapshot ลงรายการพรีออเดอร์", async () => {
    const { cake, v } = await birthdayCake();
    await productModel.updateOne({ _id: cake._id }, { $set: { is_preorder: true, product_stock_quantity: null } });
    const admin = await makeUser();
    const round = (await preorderRoundService.createRound(
      {
        round_name: `รอบตัวเลือก-${Date.now()}`, open_date: new Date(Date.now() - 1000),
        close_date: new Date(Date.now() + DAY), pickup_date: new Date(Date.now() + 5 * DAY), round_status: "open",
        items: [{ product_id: String(cake._id), max_qty_total: 100, price_override: 250 }],
      },
      String(admin._id)
    )) as { _id: unknown; items: Array<{ _id: unknown }> };
    const user = await makeUser();
    const pre = (await preorderService.createPreorder(String(user._id), {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: String(round.items[0]._id), variant_ids: [v(0, 1), v(1, 0)], quantity: 1 }],
    })) as { _id: unknown; subtotal: number };
    expect(pre.subtotal).toBe(450); // 250 + 200
    const item = await preorderItemModel.findOne({ preorder_id: pre._id }).lean<any>();
    expect(item.product_snapshot.variant_name).toBe("ขนาด: 2 ปอนด์ · รสชาติ: ช็อกโกแลต");
    expect(item.selected_variants).toHaveLength(2);
  });

  it("ออปชันบังคับ: ไม่เลือก → 400", async () => {
    const user = await makeUser();
    const p = await makeProduct();
    await makeOption(String(p._id), { option_name: "ถุงผ้า", is_required: true });
    await expect(
      cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 1 })
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("ถุงผ้า") });
  });
});
