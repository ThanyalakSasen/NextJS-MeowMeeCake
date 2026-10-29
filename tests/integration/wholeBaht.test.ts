import { describe, it, expect } from "vitest";
import { promotionCreate } from "@/schemas/promotion";
import { expenseCreate } from "@/schemas/expense";
import { deliveryZoneCreate } from "@/schemas/delivery";
import { updateRoundItemBody } from "@/schemas/preorderRound";
import { productOptionCreate, productVariantCreate } from "@/schemas/catalog";
import ingredientModel from "@/models/ingredientModel";
import * as ingredientTxnService from "@/services/ingredientTransactionService";
import { makeUser, makeUnit, makeIngredient } from "./helpers";

/**
 * ช่องเงินที่หลังร้านกรอก = บาทเต็ม · วัตถุดิบหน่วยนับเป็นชิ้นทำรายการด้วยมือได้เฉพาะจำนวนเต็ม
 * หน้าเว็บล็อกไว้แล้ว — เดิมยิง API ตรงใส่ 12.50 / ไข่ 1.5 ฟองได้
 */

const oid = "507f1f77bcf86cd799439011";

describe("ช่องเงิน = บาทเต็ม", () => {
  it("ทศนิยม → ไม่ผ่าน schema · จำนวนเต็มผ่าน", () => {
    const promo = {
      promotion_code: "WHOLE",
      promotion_name: "โปร",
      discount_type: "Amount" as const,
      discount_value: 50,
      start_date: new Date(),
      end_date: new Date(Date.now() + 86_400_000),
    };
    expect(promotionCreate.safeParse(promo).success).toBe(true);
    expect(promotionCreate.safeParse({ ...promo, discount_value: 50.5 }).success).toBe(false);
    expect(promotionCreate.safeParse({ ...promo, min_order_amount: 99.99 }).success).toBe(false);

    const expense = { date: new Date(), description: "ค่าไฟ", category: "ค่าสาธารณูปโภค", amount: 1200, payment_method: "เงินสด" };
    expect(expenseCreate.safeParse(expense).success).toBe(true);
    expect(expenseCreate.safeParse({ ...expense, amount: 1200.5 }).success).toBe(false);

    expect(deliveryZoneCreate.safeParse({ zone_name: "ใกล้", fee: 40.5 }).success).toBe(false);
    expect(updateRoundItemBody.safeParse({ price_override: 120.25 }).success).toBe(false);
    expect(productOptionCreate.safeParse({ product_id: oid, option_name: "ท็อปปิ้ง", extra_price: 5.5 }).success).toBe(false);
    expect(productVariantCreate.safeParse({ product_id: oid, variant_name: "ใหญ่", variant_price: 10 }).success).toBe(true);
  });
});

describe("วัตถุดิบหน่วยนับเป็นชิ้น — จำนวนเต็มเท่านั้น", () => {
  it("ฟอง: 1.5 → 400 ไม่แตะสต็อก · 2 ผ่าน · หน่วยกรัมยังเป็นทศนิยมได้", async () => {
    const user = await makeUser();
    const by = String(user._id);
    const egg = await makeUnit({ unit_name: `ฟอง-${Date.now()}`, unit_abbr: `ฟอง${Math.random()}`, unit_type: "Piece" });
    const eggs = await makeIngredient({ unit_id: egg._id, current_stock: 10 });

    await expect(
      ingredientTxnService.createTransaction({ ingredient_id: String(eggs._id), type: "receive", qty: 1.5, performed_by: by })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ingredientTxnService.createTransaction({ ingredient_id: String(eggs._id), type: "adjust", qty: 7.5, performed_by: by })
    ).rejects.toMatchObject({ status: 400 });
    expect((await ingredientModel.findById(eggs._id).lean<{ current_stock: number }>())!.current_stock).toBe(10);

    await ingredientTxnService.createTransaction({ ingredient_id: String(eggs._id), type: "use", qty: 2, performed_by: by });
    expect((await ingredientModel.findById(eggs._id).lean<{ current_stock: number }>())!.current_stock).toBe(8);

    const gram = await makeUnit({ unit_type: "IngredientWeight" });
    const flour = await makeIngredient({ unit_id: gram._id, current_stock: 0 });
    await ingredientTxnService.createTransaction({ ingredient_id: String(flour._id), type: "receive", qty: 12.5, performed_by: by });
    expect((await ingredientModel.findById(flour._id).lean<{ current_stock: number }>())!.current_stock).toBe(12.5);
  });
});
