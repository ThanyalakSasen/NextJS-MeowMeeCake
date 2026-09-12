import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import productVariantModel from "@/models/productVariantModel";
import productOptionModel from "@/models/productOptionModel";
import productCategoryModel from "@/models/productCategoryModel";
import unitModel from "@/models/unitModel";
import cartItemModel from "@/models/cartItemModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import preorderItemModel from "@/models/preorderItemModel";
import * as productService from "@/services/productService";
import { productVariantService } from "@/services/productVariantService";
import { productOptionService } from "@/services/productOptionService";
import * as cartService from "@/services/cartService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import * as orderService from "@/services/orderService";
import { makeUser, makeProduct, makeVariant, makeOption } from "./helpers";

/**
 * BACKLOG §3.11 เฟส 5b — productModel.product_price/sale_price, productVariantModel.variant_price,
 * productOptionModel.extra_price, cartItemModel.price_snapshot/selected_options[].extra_price,
 * preorderRoundItemModel.price_override เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
 */

async function makeCategoryAndUnit() {
  const cat = await productCategoryModel.create({ product_category_name: `หมวด-${Date.now()}` });
  const unit = await unitModel.create({
    unit_name: `หน่วย-${Date.now()}-${Math.random()}`,
    unit_abbr: "u",
    unit_type: "Custom",
    usage_context: ["Product"],
  });
  return { cat, unit };
}

describe("productService — product_price/sale_price เก็บสตางค์ คืนบาท", () => {
  it("createProduct/updateProduct: แปลงบาท↔สตางค์ถูกต้องทั้งสองฟิลด์", async () => {
    const { cat, unit } = await makeCategoryAndUnit();
    const created = (await productService.createProduct({
      product_name_th: "เค้ก",
      product_name_eng: "Cake",
      category_id: String(cat._id),
      product_price: 99.5,
      sale_price: 79.25,
      unit_id: String(unit._id),
      product_type: "inStore",
    })) as { _id: unknown; product_price: number; sale_price: number | null };
    expect(created.product_price).toBe(99.5);
    expect(created.sale_price).toBe(79.25);

    const raw = await productModel
      .findById(created._id)
      .lean<{ product_price: number; sale_price: number }>();
    expect(raw!.product_price).toBe(9950);
    expect(raw!.sale_price).toBe(7925);

    const updated = (await productService.updateProduct(String(created._id), {
      product_price: 120,
      sale_price: null,
    })) as { product_price: number; sale_price: number | null };
    expect(updated.product_price).toBe(120);
    expect(updated.sale_price).toBeNull();
    const rawAfter = await productModel
      .findById(created._id)
      .lean<{ product_price: number; sale_price: number | null }>();
    expect(rawAfter!.product_price).toBe(12000);
    expect(rawAfter!.sale_price).toBeNull();
  });

  it("getProductById/getProducts: คืนค่าเป็นบาทเสมอ", async () => {
    const { cat, unit } = await makeCategoryAndUnit();
    const created = (await productService.createProduct({
      product_name_th: "คุกกี้",
      product_name_eng: "Cookie",
      category_id: String(cat._id),
      product_price: 35,
      unit_id: String(unit._id),
      product_type: "inStore",
    })) as { _id: unknown };

    const byId = (await productService.getProductById(String(created._id))) as {
      product_price: number;
    };
    expect(byId.product_price).toBe(35);

    const { items } = await productService.getProducts({ limit: 100 });
    const found = items.find((it) => String((it as { _id: unknown })._id) === String(created._id));
    expect((found as { product_price: number } | undefined)?.product_price).toBe(35);
  });
});

describe("productVariantService / productOptionService — เก็บสตางค์ คืนบาท", () => {
  it("productVariantService: create/update/list/getById แปลง variant_price ถูกทาง", async () => {
    const product = await makeProduct();
    const created = (await productVariantService.create({
      product_id: String(product._id),
      variant_name: "ไซส์ใหญ่",
      variant_price: 25.5,
    })) as { _id: unknown; variant_price: number };
    expect(created.variant_price).toBe(25.5);

    const raw = await productVariantModel
      .findById(created._id)
      .lean<{ variant_price: number }>();
    expect(raw!.variant_price).toBe(2550);

    const updated = (await productVariantService.update(String(created._id), {
      variant_price: 30,
    })) as { variant_price: number };
    expect(updated.variant_price).toBe(30);

    const byId = (await productVariantService.getById(String(created._id))) as {
      variant_price: number;
    };
    expect(byId.variant_price).toBe(30);

    const { items } = await productVariantService.list({
      pagination: { page: 1, limit: 10, skip: 0 },
      filter: { product_id: String(product._id) },
    });
    expect((items[0] as { variant_price: number }).variant_price).toBe(30);
  });

  it("productOptionService: create/update/list/getById แปลง extra_price ถูกทาง", async () => {
    const product = await makeProduct();
    const created = (await productOptionService.create({
      product_id: String(product._id),
      option_name: "เพิ่มไข่",
      extra_price: 12,
    })) as { _id: unknown; extra_price: number };
    expect(created.extra_price).toBe(12);

    const raw = await productOptionModel.findById(created._id).lean<{ extra_price: number }>();
    expect(raw!.extra_price).toBe(1200);

    const updated = (await productOptionService.update(String(created._id), {
      extra_price: 15,
    })) as { extra_price: number };
    expect(updated.extra_price).toBe(15);

    const byId = (await productOptionService.getById(String(created._id))) as {
      extra_price: number;
    };
    expect(byId.extra_price).toBe(15);
  });
});

describe("cartService — price_snapshot/selected_options[].extra_price เก็บสตางค์ คืนบาท", () => {
  it("addItem/getCartDetail: คำนวณ price_snapshot จาก product+variant+option ที่เป็นสตางค์ทั้งหมด ถูกต้อง", async () => {
    const user = await makeUser();
    // 29.9 บาท เลือกเพื่อยืนยันว่าไม่มี floating-point drift (29.9*100 อาจเพี้ยนถ้าคูณตรง ๆ โดยไม่ผ่าน toSatang)
    const product = await makeProduct({ product_price: 29.9, product_stock_quantity: 10 });
    const variant = await makeVariant(String(product._id), { variant_price: 10.5 });
    const option = await makeOption(String(product._id), { extra_price: 5.25 });

    const item = (await cartService.addItem(String(user._id), {
      product_id: String(product._id),
      variant_id: String(variant._id),
      selected_options: [{ option_id: String(option._id) }],
      quantity: 2,
    })) as { price_snapshot: number; _id: unknown };
    // 29.9 + 10.5 + 5.25 = 45.65 บาท
    expect(item.price_snapshot).toBe(45.65);

    const raw = await cartItemModel.findById(item._id).lean<{ price_snapshot: number }>();
    expect(raw!.price_snapshot).toBe(4565); // สตางค์เป๊ะ ไม่เพี้ยนจาก float

    const detail = await cartService.getCartDetail(String(user._id));
    expect(detail.summary.subtotal).toBe(91.3); // 45.65 * 2
    const line = detail.items[0] as { line_total: number; price_snapshot: number };
    expect(line.price_snapshot).toBe(45.65);
    expect(line.line_total).toBe(91.3);
  });

  it("updateItemQuantity: คืน price_snapshot เป็นบาทหลังแก้จำนวน", async () => {
    const user = await makeUser();
    const product = await makeProduct({ product_price: 50 });
    const item = (await cartService.addItem(String(user._id), {
      product_id: String(product._id),
      quantity: 1,
    })) as { _id: unknown };

    const updated = (await cartService.updateItemQuantity(
      String(user._id),
      String(item._id),
      3
    )) as { price_snapshot: number; quantity: number };
    expect(updated.price_snapshot).toBe(50);
    expect(updated.quantity).toBe(3);
  });
});

describe("orderService.resolveLine — ไม่มี \"จุดข้ามโดเมน\" อีกต่อไปหลังเฟส 5b", () => {
  it("สร้างออเดอร์จากสินค้า+variant+option ที่มีทศนิยม → unit_price/subtotal ถูกต้องเป๊ะ ไม่มี rounding drift", async () => {
    const user = await makeUser();
    const product = await makeProduct({ product_price: 33.3, product_stock_quantity: 10 });
    const option = await makeOption(String(product._id), { extra_price: 6.7 });

    const order = (await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [
        {
          product_id: String(product._id),
          selected_options: [{ option_id: String(option._id) }],
          quantity: 3,
        },
      ],
    })) as { subtotal: number };
    // (33.3 + 6.7) * 3 = 120 บาทเป๊ะ
    expect(order.subtotal).toBe(120);
  });
});

describe("preorderRoundService — price_override เก็บสตางค์ คืนบาท", () => {
  async function makePreorderProduct() {
    return makeProduct({
      product_type: "preorder",
      product_stock_quantity: null,
      product_price: 40,
      preorder_config: { min_order_qty: 1, max_order_qty: 10, lead_time_days: 1 },
    });
  }

  it("addRoundItem/updateRoundItem: แปลง price_override บาท↔สตางค์ถูกต้อง", async () => {
    const user = await makeUser();
    const product = await makePreorderProduct();
    const round = await preorderRoundService.createRound(
      {
        round_name: `รอบทดสอบ-${Date.now()}`,
        open_date: new Date(Date.now() - 1000),
        close_date: new Date(Date.now() + 86_400_000),
        pickup_date: new Date(Date.now() + 2 * 86_400_000),
      },
      String(user._id)
    );

    const item = (await preorderRoundService.addRoundItem(String(round._id), {
      product_id: String(product._id),
      price_override: 55.5,
      max_qty_total: 20,
    })) as { _id: unknown; price_override: number | null };
    expect(item.price_override).toBe(55.5);

    const raw = await preorderRoundItemModel
      .findById(item._id)
      .lean<{ price_override: number | null }>();
    expect(raw!.price_override).toBe(5550);

    const updated = (await preorderRoundService.updateRoundItem(String(item._id), {
      price_override: 60,
    })) as { price_override: number | null };
    expect(updated.price_override).toBe(60);
  });

  it("getRoundDetail/listRoundItems: current_price ใช้ price_override เมื่อมี ไม่งั้น fallback ไปราคาสินค้า — คืนบาททั้งคู่", async () => {
    const user = await makeUser();
    const withOverride = await makePreorderProduct();
    const withoutOverride = await makePreorderProduct();
    const round = await preorderRoundService.createRound(
      {
        round_name: `รอบทดสอบ-${Date.now()}`,
        open_date: new Date(Date.now() - 1000),
        close_date: new Date(Date.now() + 86_400_000),
        pickup_date: new Date(Date.now() + 2 * 86_400_000),
        items: [
          { product_id: String(withOverride._id), price_override: 45, max_qty_total: 10 },
          { product_id: String(withoutOverride._id), max_qty_total: 10 },
        ],
      },
      String(user._id)
    );

    const detail = await preorderRoundService.getRoundDetail(String(round._id));
    const items = detail.items as Array<{
      product_id: { _id: unknown; product_price: number };
      current_price: number;
      price_override: number | null;
    }>;
    const itemWithOverride = items.find(
      (it) => String(it.product_id._id) === String(withOverride._id)
    )!;
    const itemWithoutOverride = items.find(
      (it) => String(it.product_id._id) === String(withoutOverride._id)
    )!;
    expect(itemWithOverride.current_price).toBe(45); // ใช้ price_override
    expect(itemWithoutOverride.current_price).toBe(40); // fallback ไป product_price (40 บาท)
    expect(itemWithoutOverride.product_id.product_price).toBe(40); // populate มาต้องเป็นบาทด้วย

    const list = (await preorderRoundService.listRoundItems(String(round._id))) as Array<{
      current_price?: number;
      price_override: number | null;
    }>;
    expect(list.find((it) => it.price_override === 45)).toBeTruthy();
  });

  it("end-to-end: สร้างพรีออเดอร์จริงจาก round item ที่มี price_override → preorderItem.unit_price เก็บสตางค์ถูก คืน API เป็นบาท", async () => {
    const user = await makeUser();
    const product = await makePreorderProduct();
    const round = await preorderRoundService.createRound(
      {
        round_name: `รอบทดสอบ-${Date.now()}`,
        open_date: new Date(Date.now() - 1000),
        close_date: new Date(Date.now() + 86_400_000),
        pickup_date: new Date(Date.now() + 2 * 86_400_000),
        items: [{ product_id: String(product._id), price_override: 88, max_qty_total: 5 }],
      },
      String(user._id)
    );
    const roundItem = (await preorderRoundService.listRoundItems(String(round._id)))[0] as {
      _id: unknown;
    };

    const input: preorderService.CreatePreorderInput = {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: String(roundItem._id), quantity: 2 }],
    };
    const preorder = (await preorderService.createPreorder(String(user._id), input)) as {
      _id: unknown;
      subtotal: number;
      items: Array<{ unit_price: number }>;
    };

    expect(preorder.subtotal).toBe(176); // 88 * 2
    expect(preorder.items[0].unit_price).toBe(88);

    const rawItem = await preorderItemModel
      .findOne({ preorder_id: preorder._id })
      .lean<{ unit_price: number }>();
    expect(rawItem!.unit_price).toBe(8800); // สตางค์ดิบใน DB
  });
});
