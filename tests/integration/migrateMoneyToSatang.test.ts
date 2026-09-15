import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import preorderModel from "@/models/preorderModel";
import preorderItemModel from "@/models/preorderItemModel";
import paymentModel from "@/models/paymentModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import expenseModel from "@/models/expenseModel";
import deliveryZoneModel from "@/models/deliveryZoneModel";
import ingredientModel from "@/models/ingredientModel";
import componentModel from "@/models/componentModel";
import recipeModel from "@/models/recipeModel";
import productModel from "@/models/productModel";
import promotionModel from "@/models/promotionModel";
import productVariantModel from "@/models/productVariantModel";
import productOptionModel from "@/models/productOptionModel";
import cartItemModel from "@/models/cartItemModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import mongoose from "mongoose";
import { runMigration } from "../../scripts/migrate-money-to-satang";
import { makeUser, makeProduct, makePreorder } from "./helpers";

/**
 * ต้อง type ตรงนี้เอง — ไม่งั้น `db.collection("migrations")` (ไม่ผ่าน mongoose model) จะ infer เป็น
 * `Document` ของ native driver ที่ `_id` เป็น `ObjectId` โดย default ทำให้ insert `{ _id: "string" }`
 * ตรง ๆ ชนกับ type ไม่ผ่าน tsc (เจอจริงจาก `npm run typecheck:test` ที่ CI รันแยกจาก `typecheck`
 * ปกติ — เป็นบั๊กที่ตกค้างมาตั้งแต่เฟส 2 เพราะไม่เคยรันคำสั่งนี้เองตอน verify ก่อน merge)
 */
interface MigrationMarkerDoc {
  _id: string;
  applied_at: Date;
  modified_count: number;
}

/**
 * BACKLOG §3.11 — scripts/migrate-money-to-satang.ts คูณข้อมูลเงินเดิม (บาท) ×100 ครั้งเดียวตอน
 * deploy จริง เทสนี้จำลองเอกสาร "แบบเก่า" (สร้างตรงผ่าน model ข้าม service ที่แปลงให้แล้ว) แล้วยืนยัน
 * ว่า migration แปลงถูกทุก field รวม nested array (selected_options[].extra_price) + กันรันซ้ำ
 */
describe("scripts/migrate-money-to-satang", () => {
  it("คูณ field เงินทุกตัว ×100 ให้ทุก collection รวม nested selected_options[].extra_price", async () => {
    const user = await makeUser();
    const product = await makeProduct();

    const order = await orderModel.create({
      order_no: `OP-TEST-${Date.now()}`,
      user_id: user._id,
      order_type: "takeaway",
      subtotal: 100,
      discount_amount: 10,
      delivery_fee: 40,
      total_amount: 130,
    });
    const orderItem = await orderItemModel.create({
      order_id: order._id,
      product_id: product._id,
      product_snapshot: { product_name_th: "x", product_name_eng: "x" },
      selected_options: [{ option_name: "เพิ่มไข่", extra_price: 5, text_value: null }],
      quantity: 2,
      unit_price: 50,
      total_price: 100,
      cost_per_unit: 20, // ต้องถูกแปลงด้วยตั้งแต่เฟส 4 (section แยกจาก order_items)
    });
    // orderItem อีกตัวที่ cost_per_unit เป็น null (ไม่มีสูตร/purchase_cost ตอนสร้างจริง) — ต้องยืนยันว่า
    // $mul ไม่ error กลางทาง (MongoDB $mul ใช้กับ field ที่เป็น null ไม่ได้) และค่ายังเป็น null เหมือนเดิม
    const orderItemNullCost = await orderItemModel.create({
      order_id: order._id,
      product_id: product._id,
      product_snapshot: { product_name_th: "x", product_name_eng: "x" },
      quantity: 1,
      unit_price: 50,
      total_price: 50,
      cost_per_unit: null,
    });

    const preorder = await makePreorder(String(user._id), {
      subtotal: 200,
      discount_amount: 0,
      delivery_fee: 0,
      total_amount: 200,
    });
    const preorderItem = await preorderItemModel.create({
      preorder_id: preorder._id,
      round_item_id: new mongoose.Types.ObjectId(),
      product_id: product._id,
      product_snapshot: { product_name_th: "x", product_name_eng: "x" },
      pickup_date: new Date(),
      quantity: 1,
      unit_price: 200,
      total_price: 200,
      cost_per_unit: 80, // ต้องถูกแปลงด้วยตั้งแต่เฟส 4 (section แยกจาก preorder_items)
    });

    const payment = await paymentModel.create({
      order_id: order._id,
      user_id: user._id,
      amount: 130,
      status: "pending",
    });

    const usage = await promotionUsagesModel.create({
      promotion_id: new mongoose.Types.ObjectId(),
      user_id: user._id,
      order_id: order._id,
      discount_applied: 10,
    });

    const expense = await expenseModel.create({
      date: new Date(),
      description: "ทดสอบ",
      category: "อื่นๆ",
      amount: 300,
      payment_method: "เงินสด",
    });

    const zone = await deliveryZoneModel.create({
      zone_name: "โซนทดสอบ",
      fee: 45,
      sort_order: 0,
    });

    // BACKLOG §3.11 เฟส 4 — ingredient/component/recipe cost + product.purchase_cost
    const ingredient = await ingredientModel.create({
      ingredient_name: `วัตถุดิบ-migrate-${Date.now()}`,
      ingredient_category_id: new mongoose.Types.ObjectId(),
      unit_id: new mongoose.Types.ObjectId(),
      current_stock: 0,
      cost_per_unit: 15,
      reorder_point: 5,
    });
    const component = await componentModel.create({
      component_name: `ส่วนประกอบ-migrate-${Date.now()}`,
      componentcategory_id: new mongoose.Types.ObjectId(),
      yield_qty: 1,
      yield_unit_id: new mongoose.Types.ObjectId(),
      estimated_cost_per_batch: 60,
      created_by: new mongoose.Types.ObjectId(),
    });
    const recipe = await recipeModel.create({
      recipe_name: `สูตร-migrate-${Date.now()}`,
      product_id: product._id,
      yield_qty: 10,
      yield_unit_id: new mongoose.Types.ObjectId(),
      estimated_cost_per_batch: 90,
      created_by: new mongoose.Types.ObjectId(),
    });
    // purchase_cost เป็น null สำหรับสินค้าส่วนใหญ่ (ไม่ใช่ "ซื้อมาขายต่อ") — ต้องยืนยันว่า $mul ไม่พัง
    const productNullPurchaseCost = product; // makeProduct() ไม่ได้ตั้ง purchase_cost มา (default null)
    const productWithPurchaseCost = await makeProduct({ purchase_cost: 70 });

    // BACKLOG §3.11 เฟส 5a — promotion 3 ชนิด ยืนยันว่า discount_value แปลงเฉพาะ Amount
    const promoAmount = await promotionModel.create({
      promotion_code: `PROMO-AMT-${Date.now()}`,
      promotion_name: "ลดเงินสด",
      discount_type: "Amount",
      discount_value: 25,
      min_order_amount: 100,
      max_discount_amount: null,
      start_date: new Date(),
      end_date: new Date(Date.now() + 86_400_000),
      created_by: new mongoose.Types.ObjectId(),
    });
    const promoPercentage = await promotionModel.create({
      promotion_code: `PROMO-PCT-${Date.now()}`,
      promotion_name: "ลด %",
      discount_type: "Percentage",
      discount_value: 15, // % ดิบ — ต้อง "ไม่ถูกแตะ"
      max_discount_amount: 60,
      start_date: new Date(),
      end_date: new Date(Date.now() + 86_400_000),
      created_by: new mongoose.Types.ObjectId(),
    });
    const promoFreeShipping = await promotionModel.create({
      promotion_code: `PROMO-SHIP-${Date.now()}`,
      promotion_name: "ส่งฟรี",
      discount_type: "FreeShipping",
      discount_value: 0, // ไม่ถูกใช้เลย แต่ต้อง "ไม่ถูกแตะ" เช่นกัน
      start_date: new Date(),
      end_date: new Date(Date.now() + 86_400_000),
      created_by: new mongoose.Types.ObjectId(),
    });

    // BACKLOG §3.11 เฟส 5b — สร้างตรงผ่าน model ทั้งหมด (ไม่ผ่าน makeProduct()/makeVariant()/
    // makeOption() ที่แปลงบาท→สตางค์ให้อัตโนมัติแล้วตั้งแต่เฟส 5b — ถ้าใช้ helper พวกนั้นในเทสนี้จะได้
    // เอกสารที่ "เป็นสตางค์อยู่แล้ว" ปนกับเอกสารดิบที่จำลองว่ายังไม่เคย migrate จริง ทำให้ทดสอบ
    // migration ไม่ได้ตรงตามจริง)
    const rawProduct = await productModel.create({
      product_id: `pos-migrate-${Date.now()}`,
      product_name_th: "สินค้าดิบ",
      product_name_eng: "Raw product",
      category_id: new mongoose.Types.ObjectId(),
      unit_id: new mongoose.Types.ObjectId(),
      product_price: 35,
      sale_price: 28,
      product_type: "inStore",
      product_stock_quantity: 10,
    });
    const rawVariant = await productVariantModel.create({
      product_id: rawProduct._id,
      variant_name: "ไซส์ใหญ่",
      variant_price: 12,
    });
    const rawOption = await productOptionModel.create({
      product_id: rawProduct._id,
      option_name: "เพิ่มไข่",
      extra_price: 5,
    });
    const rawCartItem = await cartItemModel.create({
      cart_id: new mongoose.Types.ObjectId(),
      product_id: rawProduct._id,
      selected_options: [{ option_name: "เพิ่มไข่", extra_price: 5, text_value: null }],
      quantity: 2,
      price_snapshot: 40,
    });
    const rawRoundItemWithOverride = await preorderRoundItemModel.create({
      round_id: new mongoose.Types.ObjectId(),
      product_id: rawProduct._id,
      price_override: 33,
      max_qty_total: 10,
    });
    const rawRoundItemNullOverride = await preorderRoundItemModel.create({
      round_id: new mongoose.Types.ObjectId(),
      product_id: rawProduct._id,
      max_qty_total: 10, // price_override ไม่ระบุ = null (default) — ต้องยืนยันว่า $multiply ไม่พัง
    });

    const summary = await runMigration();
    expect(summary).toMatchObject({
      orders: 1,
      order_items: 2, // orderItem 2 ตัว (unit_price/total_price ไม่มีตัวไหนเป็น null)
      order_items_cost_per_unit: 1, // จับได้แค่ตัวที่ cost_per_unit เป็นตัวเลขจริง (อีกตัวเป็น null ข้ามไป)
      preorders: 1,
      preorder_items: 1,
      preorder_items_cost_per_unit: 1,
      payments: 1,
      promotion_usages: 1,
      expenses: 1,
      delivery_zones: 1,
      ingredients: 1,
      components: 1,
      recipes: 1,
      products_purchase_cost: 1, // เจอแค่ตัวที่มี purchase_cost เป็นตัวเลขจริง (filter $type:number)
      promotions: 3, // pipeline update แก้ทั้ง 3 เอกสาร (conditional อยู่ข้างในแต่ละเอกสารเอง)
      products_pricing: 3, // product (makeProduct) + productWithPurchaseCost (makeProduct) + rawProduct
      product_variants: 1,
      product_options: 1,
      cart_items: 1,
      preorder_round_items: 2, // ทั้งตัวที่มี price_override และตัวที่เป็น null (pipeline ไม่พัง)
    });

    const rOrder = await orderModel
      .findById(order._id)
      .lean<{ subtotal: number; discount_amount: number; delivery_fee: number; total_amount: number }>();
    expect(rOrder!.subtotal).toBe(10000);
    expect(rOrder!.discount_amount).toBe(1000);
    expect(rOrder!.delivery_fee).toBe(4000);
    expect(rOrder!.total_amount).toBe(13000);

    const rItem = await orderItemModel.findById(orderItem._id).lean<{
      unit_price: number;
      total_price: number;
      cost_per_unit: number;
      selected_options: { extra_price: number }[];
    }>();
    expect(rItem!.unit_price).toBe(5000);
    expect(rItem!.total_price).toBe(10000);
    expect(rItem!.selected_options[0].extra_price).toBe(500);
    expect(rItem!.cost_per_unit).toBe(2000); // เฟส 4 — 20 บาท × 100 = 2000 สตางค์

    const rItemNullCost = await orderItemModel
      .findById(orderItemNullCost._id)
      .lean<{ cost_per_unit: number | null }>();
    expect(rItemNullCost!.cost_per_unit).toBeNull(); // $mul ข้าม (filter $type:number) ไม่พัง ไม่กลายเป็น 0

    const rPreorder = await preorderModel
      .findById(preorder._id)
      .lean<{ subtotal: number; total_amount: number }>();
    expect(rPreorder!.subtotal).toBe(20000);
    expect(rPreorder!.total_amount).toBe(20000);

    const rPreorderItem = await preorderItemModel
      .findById(preorderItem._id)
      .lean<{ unit_price: number; total_price: number; cost_per_unit: number }>();
    expect(rPreorderItem!.unit_price).toBe(20000);
    expect(rPreorderItem!.total_price).toBe(20000);
    expect(rPreorderItem!.cost_per_unit).toBe(8000); // เฟส 4 — 80 บาท × 100 = 8000 สตางค์

    const rPayment = await paymentModel.findById(payment._id).lean<{ amount: number }>();
    expect(rPayment!.amount).toBe(13000);

    const rUsage = await promotionUsagesModel
      .findById(usage._id)
      .lean<{ discount_applied: number }>();
    expect(rUsage!.discount_applied).toBe(1000);

    const rExpense = await expenseModel.findById(expense._id).lean<{ amount: number }>();
    expect(rExpense!.amount).toBe(30000);

    const rZone = await deliveryZoneModel.findById(zone._id).lean<{ fee: number }>();
    expect(rZone!.fee).toBe(4500);

    // ── เฟส 4 ──────────────────────────────────────────────────
    const rIngredient = await ingredientModel
      .findById(ingredient._id)
      .lean<{ cost_per_unit: number }>();
    expect(rIngredient!.cost_per_unit).toBe(1500);

    const rComponent = await componentModel
      .findById(component._id)
      .lean<{ estimated_cost_per_batch: number }>();
    expect(rComponent!.estimated_cost_per_batch).toBe(6000);

    const rRecipe = await recipeModel
      .findById(recipe._id)
      .lean<{ estimated_cost_per_batch: number }>();
    expect(rRecipe!.estimated_cost_per_batch).toBe(9000);

    const rProductNull = await productModel
      .findById(productNullPurchaseCost._id)
      .lean<{ purchase_cost: number | null }>();
    expect(rProductNull!.purchase_cost).toBeNull(); // $mul ข้าม ไม่พัง ไม่กลายเป็น 0

    const rProductWithCost = await productModel
      .findById(productWithPurchaseCost._id)
      .lean<{ purchase_cost: number | null }>();
    expect(rProductWithCost!.purchase_cost).toBe(7000);

    // ── เฟส 5a ─────────────────────────────────────────────────
    const rPromoAmount = await promotionModel.findById(promoAmount._id).lean<{
      discount_value: number;
      min_order_amount: number | null;
      max_discount_amount: number | null;
    }>();
    expect(rPromoAmount!.discount_value).toBe(2500); // Amount → คูณ 100
    expect(rPromoAmount!.min_order_amount).toBe(10000); // เงินเสมอ → คูณ 100
    expect(rPromoAmount!.max_discount_amount).toBeNull(); // null → $multiply คืน null ไม่พัง ไม่เป็น 0

    const rPromoPct = await promotionModel.findById(promoPercentage._id).lean<{
      discount_value: number;
      max_discount_amount: number | null;
    }>();
    expect(rPromoPct!.discount_value).toBe(15); // Percentage → "ไม่ถูกแตะ" ยังเป็น % ดิบ
    expect(rPromoPct!.max_discount_amount).toBe(6000); // แต่ max_discount_amount แปลงเสมอ

    const rPromoShip = await promotionModel
      .findById(promoFreeShipping._id)
      .lean<{ discount_value: number }>();
    expect(rPromoShip!.discount_value).toBe(0); // FreeShipping → ไม่ถูกแตะเช่นกัน

    // ── เฟส 5b ─────────────────────────────────────────────────
    const rRawProduct = await productModel
      .findById(rawProduct._id)
      .lean<{ product_price: number; sale_price: number }>();
    expect(rRawProduct!.product_price).toBe(3500);
    expect(rRawProduct!.sale_price).toBe(2800);

    const rRawVariant = await productVariantModel
      .findById(rawVariant._id)
      .lean<{ variant_price: number }>();
    expect(rRawVariant!.variant_price).toBe(1200);

    const rRawOption = await productOptionModel
      .findById(rawOption._id)
      .lean<{ extra_price: number }>();
    expect(rRawOption!.extra_price).toBe(500);

    const rRawCartItem = await cartItemModel.findById(rawCartItem._id).lean<{
      price_snapshot: number;
      selected_options: { extra_price: number }[];
    }>();
    expect(rRawCartItem!.price_snapshot).toBe(4000);
    expect(rRawCartItem!.selected_options[0].extra_price).toBe(500);

    const rRawRoundItemWithOverride = await preorderRoundItemModel
      .findById(rawRoundItemWithOverride._id)
      .lean<{ price_override: number }>();
    expect(rRawRoundItemWithOverride!.price_override).toBe(3300);

    const rRawRoundItemNullOverride = await preorderRoundItemModel
      .findById(rawRoundItemNullOverride._id)
      .lean<{ price_override: number | null }>();
    expect(rRawRoundItemNullOverride!.price_override).toBeNull(); // $multiply ไม่พัง ไม่กลายเป็น 0
  });

  it("กันรันซ้ำต่อ collection — รันครั้งที่สองต้องไม่คูณ ×100 ซ้ำอีกรอบ (section ที่รันแล้ว = null)", async () => {
    const user = await makeUser();
    const order = await orderModel.create({
      order_no: `OP-TEST-${Date.now()}`,
      user_id: user._id,
      order_type: "takeaway",
      subtotal: 100,
      total_amount: 100,
    });

    async function currentSubtotal(): Promise<number> {
      const doc = await orderModel.findById(order._id).lean<{ subtotal: number }>();
      return doc!.subtotal;
    }

    const first = await runMigration();
    expect(first.orders).toBe(1); // section รันจริงครั้งแรก
    expect(await currentSubtotal()).toBe(10000);

    const second = await runMigration();
    expect(second.orders).toBeNull(); // ข้ามเพราะ section นี้มี marker แล้ว
    expect(await currentSubtotal()).toBe(10000); // ไม่ถูกคูณซ้ำ
  });

  it("เพิ่ม field ใหม่เข้าไฟล์ทีหลัง (เหมือนเฟส 2 เพิ่ม expenseModel) — section เก่าที่มี marker แล้วไม่โดนคูณซ้ำ แต่ section ใหม่ที่ยังไม่มี marker ต้องรันจริง", async () => {
    // จำลองสถานการณ์: DB นี้เคยรัน migrate ตอนมีแค่ orders/payments (เฟส 1 เก่า) ไปแล้ว — ใส่ marker
    // ของ 2 section นั้นตรง ๆ (ข้าม runMigration()) แต่ "ลืม" ใส่ marker ของ expenses (เพิ่งเพิ่มทีหลัง)
    const db = mongoose.connection.db!;
    await db.collection<MigrationMarkerDoc>("migrations").insertMany([
      { _id: "money_to_satang_3_11_orders", applied_at: new Date(), modified_count: 0 },
      { _id: "money_to_satang_3_11_payments", applied_at: new Date(), modified_count: 0 },
    ]);

    const order = await orderModel.create({
      order_no: `OP-TEST-${Date.now()}`,
      user_id: (await makeUser())._id,
      order_type: "takeaway",
      subtotal: 100, // ตั้งใจปล่อยเป็น "บาทดิบ" เหมือนไม่เคย migrate จริง (marker หลอกไว้เฉย ๆ)
      total_amount: 100,
    });
    const expense = await expenseModel.create({
      date: new Date(),
      description: "ทดสอบ",
      category: "อื่นๆ",
      amount: 50,
      payment_method: "เงินสด",
    });

    const result = await runMigration();
    expect(result.orders).toBeNull(); // ข้าม เพราะมี marker หลอกไว้ (จำลอง "เคยรันไปแล้วจริง")
    expect(result.expenses).toBe(1); // รันจริง เพราะไม่มี marker ของ section นี้เลย

    const rOrder = await orderModel.findById(order._id).lean<{ subtotal: number }>();
    expect(rOrder!.subtotal).toBe(100); // ไม่ถูกแตะ (section ถูกข้ามตาม marker)

    const rExpense = await expenseModel.findById(expense._id).lean<{ amount: number }>();
    expect(rExpense!.amount).toBe(5000); // ถูกแปลงจริง
  });

  it("เพิ่ม field เงินเข้า collection ที่มี section เดิมอยู่แล้ว (เหมือนเฟส 4 เพิ่ม cost_per_unit เข้า order_items) — ต้องมี marker แยกของตัวเอง ไม่ใช้ marker เดิมร่วมกัน", async () => {
    // จำลอง DB ที่เคยรันเฟส 1 ไปแล้วจริง (marker "order_items" มีอยู่แล้ว) แต่ cost_per_unit ของ
    // orderItem เดิมยังเป็นบาทดิบค้างอยู่ (เพราะเฟส 1 ตั้งใจไม่แตะ cost_per_unit)
    const db = mongoose.connection.db!;
    await db.collection<MigrationMarkerDoc>("migrations").insertOne({
      _id: "money_to_satang_3_11_order_items",
      applied_at: new Date(),
      modified_count: 1,
    });

    const user = await makeUser();
    const product = await makeProduct();
    const order = await orderModel.create({
      order_no: `OP-TEST-${Date.now()}`,
      user_id: user._id,
      order_type: "takeaway",
      subtotal: 10000,
      total_amount: 10000,
    });
    const orderItem = await orderItemModel.create({
      order_id: order._id,
      product_id: product._id,
      product_snapshot: { product_name_th: "x", product_name_eng: "x" },
      quantity: 1,
      unit_price: 10000, // สมมติว่าแปลงไปแล้วตอนเฟส 1 (ตรงกับ marker ที่ใส่ไว้)
      total_price: 10000,
      cost_per_unit: 25, // ค้างเป็นบาทดิบ (เฟส 1 ไม่แตะ) — ต้องถูกแปลงในเฟส 4
    });

    const result = await runMigration();
    expect(result.order_items).toBeNull(); // ข้าม (marker เดิมยังอยู่) — unit_price/total_price ไม่ถูกแตะซ้ำ
    expect(result.order_items_cost_per_unit).toBe(1); // รันจริง เพราะเป็น marker คนละตัว

    const rItem = await orderItemModel
      .findById(orderItem._id)
      .lean<{ unit_price: number; cost_per_unit: number }>();
    expect(rItem!.unit_price).toBe(10000); // ไม่ถูกคูณซ้ำ (section order_items ถูกข้าม)
    expect(rItem!.cost_per_unit).toBe(2500); // ถูกแปลงจริง (section แยกต่างหาก)
  });
});
