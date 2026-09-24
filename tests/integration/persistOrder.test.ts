import { describe, it, expect, vi, afterEach } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import productModel from "@/models/productModel";
import productVariantModel from "@/models/productVariantModel";
import productOptionModel from "@/models/productOptionModel";
import * as orderService from "@/services/orderService";
import { makeUser, makeProduct, makeVariant, makeOption } from "./helpers";

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

    // orderItem snapshot ราคาต่อหน่วยสด (p2 ใช้ sale_price) — query ตรงจาก DB เห็นเป็นสตางค์
    // (BACKLOG §3.11 — ต่างจาก order.* ด้านบนที่มาจาก getOrderById ซึ่งแปลงกลับเป็นบาทให้แล้ว)
    const items = await orderItemModel.find({ order_id: order._id }).lean();
    const byProduct = new Map(items.map((it) => [String(it.product_id), it]));
    expect(byProduct.get(String(p2._id))!.unit_price).toBe(6000);
  });

  it("เลขออเดอร์ตามช่องทาง: เว็บไซต์ (online / ไม่ระบุ) = ORD- , หน้าร้าน (instore) = POS-", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 10 });
    const make = (channel?: "online" | "instore") =>
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        channel,
        items: [{ product_id: String(p._id), quantity: 1 }],
      });

    expect((await make("online")).order_no).toMatch(/^ORD-\d{8}-[A-Z0-9]{6}$/);
    expect((await make(undefined)).order_no).toMatch(/^ORD-/);
    expect((await make("instore")).order_no).toMatch(/^POS-\d{8}-[A-Z0-9]{6}$/);
  });

  it("re-price: ราคาสินค้าเปลี่ยนหลังสร้าง product → ออเดอร์ใหม่ใช้ราคาปัจจุบัน", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 20 });
    // อัปเดตตรงผ่าน model (ข้าม makeProduct()'s auto-convert) — 15000 สตางค์ = 150 บาท
    // (BACKLOG §3.11 เฟส 5b — productModel.product_price เก็บเป็นสตางค์แล้ว)
    await productModel.updateOne({ _id: p._id }, { $set: { product_price: 15000 } });

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

  it("BACKLOG §3.11: ราคาที่ float คูณแล้วมี rounding error ค้าง → เก็บเป็นสตางค์ (integer) แม่นเป๊ะ", async () => {
    const user = await makeUser();
    // 29.9*3 = 89.69999999999999 ใน JS ดิบ (ไม่ใช่ 89.7 พอดี) — ก่อนแก้ §3.11 โค้ดเดิมไม่เคย round2()
    // orderItem.total_price แต่ละบรรทัดเลย (round2 มีแค่ตอนรวม subtotal/total_amount) ทำให้
    // total_price ของ "รายการเดียว" เก็บ float เพี้ยนแบบนี้ตรง ๆ ได้ — หลังแก้ค่าที่เก็บเป็น integer
    // สตางค์เสมอ ไม่มีทางเพี้ยนแบบนี้อีกไม่ว่าราคา/จำนวนจะเป็นเท่าไหร่
    expect(29.9 * 3).not.toBe(89.7); // sanity: ยืนยันว่า float ดิบมีปัญหาจริงก่อน
    const p = await makeProduct({ product_price: 29.9, product_stock_quantity: 10 });

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 3 }],
    });

    expect(order.subtotal).toBe(89.7);
    expect(order.total_amount).toBe(89.7);

    // ยืนยันค่าที่เก็บจริงใน DB เป็นสตางค์ integer เป๊ะ ทั้งระดับออเดอร์และระดับรายการ
    const rawOrder = await orderModel.findById(order._id).lean<{ subtotal: number }>();
    expect(rawOrder!.subtotal).toBe(8970);
    expect(Number.isInteger(rawOrder!.subtotal)).toBe(true);

    const rawItem = await orderItemModel
      .findOne({ order_id: order._id })
      .lean<{ total_price: number }>();
    expect(rawItem!.total_price).toBe(8970); // ไม่ใช่ 89.69999999999999 แบบที่ float ดิบจะให้
    expect(Number.isInteger(rawItem!.total_price)).toBe(true);
  });

  it("preorder product → reject (ต้องสั่งผ่านระบบ preorder)", async () => {
    const user = await makeUser();
    const pre = await makeProduct({ product_types: ["preorder"], product_stock_quantity: null });
    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [{ product_id: String(pre._id), quantity: 1 }],
      })
    ).rejects.toThrow(/พรีออเดอร์/);
  });
});

/**
 * BACKLOG §3.18 — resolveLines() เปลี่ยนจากวน await resolveLine() ทีละรายการ (query แยก ~3N ครั้ง)
 * เป็น batch query ด้วย `$in` ครั้งเดียวต่อ collection (product/variant/option) แล้ว join ใน memory
 * เทสนี้ยืนยันทั้งจำนวน query ที่ลดลงจริง และ correctness ทุก edge case ที่ join ผิดคนได้ง่าย
 */
describe("orderService.createOrder — resolveLines() batch resolve (BACKLOG §3.18)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("จำนวนครั้งที่ยิง productModel/productVariantModel/productOptionModel.find ไม่โตตามจำนวนรายการในออเดอร์ (คงที่ ไม่ใช่ O(N))", async () => {
    // เทียบจำนวนครั้งที่เรียก .find() ระหว่างออเดอร์ 1 รายการ กับ 3 รายการ (ที่แต่ละรายการมีทั้ง
    // variant+option ครบ) — ต้องเท่ากันเป๊ะถ้า resolveLines() batch จริง (ถ้ายังเป็นแบบเดิมที่วน
    // resolveLine() ทีละรายการ จำนวนครั้งจะโตขึ้นตามจำนวนรายการ ไม่เท่ากัน)
    // หมายเหตุ: productModel.find() ยังถูกเรียกอีก 1 ครั้งจาก recipeService.getUnitCostByProduct()
    // (fallback purchase_cost, คนละหน้าที่กับ resolveLines) นับรวมอยู่ในทั้งสองเคสเท่ากันอยู่แล้ว
    // จึงไม่กระทบการเปรียบเทียบ
    async function countFindCalls(itemCount: number): Promise<{ product: number; variant: number; option: number }> {
      const user = await makeUser();
      const items = [];
      for (let i = 0; i < itemCount; i++) {
        const p = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
        const v = await makeVariant(String(p._id), { variant_price: 5 });
        const o = await makeOption(String(p._id), { extra_price: 2 });
        items.push({
          product_id: String(p._id),
          variant_id: String(v._id),
          selected_options: [{ option_id: String(o._id) }],
          quantity: 1,
        });
      }

      const findSpy = vi.spyOn(productModel, "find");
      const variantFindSpy = vi.spyOn(productVariantModel, "find");
      const optionFindSpy = vi.spyOn(productOptionModel, "find");

      await orderService.createOrder(String(user._id), { order_type: "takeaway", items });

      const counts = {
        product: findSpy.mock.calls.length,
        variant: variantFindSpy.mock.calls.length,
        option: optionFindSpy.mock.calls.length,
      };
      vi.restoreAllMocks();
      return counts;
    }

    const with1Item = await countFindCalls(1);
    const with3Items = await countFindCalls(3);

    expect(with3Items).toEqual(with1Item);
  });

  it("ไม่ query variant/option เลยถ้าไม่มีรายการไหนใช้เลย (กัน query เปล่าโดยไม่จำเป็น)", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50, product_stock_quantity: 10 });

    const variantFindSpy = vi.spyOn(productVariantModel, "find");
    const optionFindSpy = vi.spyOn(productOptionModel, "find");

    await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(p._id), quantity: 1 }],
    });

    expect(variantFindSpy).not.toHaveBeenCalled();
    expect(optionFindSpy).not.toHaveBeenCalled();
  });

  it("สินค้าเดียวกันสั่งซ้ำในออเดอร์เดียวคนละ variant/option → join ไม่ปนกัน คิดราคาถูกคนละบรรทัด", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });
    const vSmall = await makeVariant(String(p._id), { variant_name: "เล็ก", variant_price: 0 });
    const vLarge = await makeVariant(String(p._id), { variant_name: "ใหญ่", variant_price: 30 });

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [
        { product_id: String(p._id), variant_id: String(vSmall._id), quantity: 1 },
        { product_id: String(p._id), variant_id: String(vLarge._id), quantity: 1 },
      ],
    });

    // 100 (เล็ก) + 130 (ใหญ่) = 230 — ถ้า join สลับกันจะได้ 100+100 หรือ 130+130 แทน
    expect(order.subtotal).toBe(230);
    const items = await orderItemModel.find({ order_id: order._id }).lean<{ variant_id: unknown; unit_price: number }[]>();
    const byVariant = new Map(items.map((it) => [String(it.variant_id), it.unit_price]));
    expect(byVariant.get(String(vSmall._id))).toBe(10000); // 100 บาท = 10000 สตางค์
    expect(byVariant.get(String(vLarge._id))).toBe(13000); // 130 บาท = 13000 สตางค์
  });

  it("variant_id เป็นของสินค้าอื่น (ไม่ใช่ product_id ที่ระบุ) → reject ไม่พบ variant", async () => {
    const user = await makeUser();
    const p1 = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
    const p2 = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
    const variantOfP2 = await makeVariant(String(p2._id), { variant_price: 10 });

    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        // ระบุ product_id ของ p1 แต่ variant_id เป็นของ p2 — ต้อง reject เหมือนหา variant ไม่เจอ
        items: [{ product_id: String(p1._id), variant_id: String(variantOfP2._id), quantity: 1 }],
      })
    ).rejects.toThrow(/ไม่พบตัวเลือกสินค้า/);
  });

  it("option_id เป็นของสินค้าอื่น → reject ไม่พบตัวเลือกเสริม", async () => {
    const user = await makeUser();
    const p1 = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
    const p2 = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
    const optionOfP2 = await makeOption(String(p2._id), { extra_price: 5 });

    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [
          {
            product_id: String(p1._id),
            selected_options: [{ option_id: String(optionOfP2._id) }],
            quantity: 1,
          },
        ],
      })
    ).rejects.toThrow(/ไม่พบตัวเลือกเสริม/);
  });

  it("ตัวเลือกแบบกรอกข้อความที่บังคับ (is_required) แต่ไม่กรอกมา → reject ต้องกรอกข้อความ", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
    const opt = await makeOption(String(p._id), {
      option_name: "ข้อความบนเค้ก",
      is_text_input: true,
      is_required: true,
      max_text_length: 20,
    });

    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [
          { product_id: String(p._id), selected_options: [{ option_id: String(opt._id) }], quantity: 1 },
        ],
      })
    ).rejects.toThrow(/ต้องกรอกข้อความ/);
  });

  it("ข้อความยาวเกิน max_text_length → reject", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
    const opt = await makeOption(String(p._id), {
      option_name: "ข้อความบนเค้ก",
      is_text_input: true,
      max_text_length: 5,
    });

    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        items: [
          {
            product_id: String(p._id),
            selected_options: [{ option_id: String(opt._id), text_value: "ยาวเกินห้าตัวอักษรแน่นอน" }],
            quantity: 1,
          },
        ],
      })
    ).rejects.toThrow(/ยาวเกิน/);
  });
});
