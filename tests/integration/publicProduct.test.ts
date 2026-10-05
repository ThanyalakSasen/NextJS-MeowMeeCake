/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { GET as listGET } from "@/app/api/catalog/products/route";
import { GET as detailGET } from "@/app/api/catalog/products/[id]/route";
import { GET as recommendedGET } from "@/app/api/catalog/products/recommended/route";
import * as recommendationService from "@/services/recommendation/recommendationService";
import * as productService from "@/services/productService";
import { parsePagination } from "@/lib/queryParams";
import { makeProduct, makeIngredient, makeRecipe } from "./helpers";

/** API สาธารณะไม่ส่งต้นทุน/สูตร (BACKLOG5 R1) · sortBy เฉพาะ field ที่อนุญาต (BACKLOG5 Y5) */

const SECRET_COST = 37.25;
const req = (url: string) => new NextRequest(`http://localhost:3000${url}`);

async function productWithRecipe() {
  const p = await makeProduct({ product_price: 120, purchase_cost: SECRET_COST, low_stock_threshold: 3, product_stock_quantity: 9 });
  const flour = await makeIngredient({ ingredient_name: "แป้งสาลี" });
  await makeRecipe(String(p._id), {
    ingredients: [{ ingredient_id: flour._id, quantity: 987, unit_id: new Types.ObjectId() }],
  });
  return { p, id: String(p._id) };
}

const assertPublic = (product: any) => {
  expect(product).toBeTruthy();
  expect(product).not.toHaveProperty("purchase_cost");
  expect(product).not.toHaveProperty("low_stock_threshold");
  expect(product).not.toHaveProperty("yield_per_batch");
  expect(product).not.toHaveProperty("recipe_id");
  // ไม่มีปริมาณในสูตรหลุดออกมา — ตรวจที่ key (เดิมตรวจตัวเลข "987" ซึ่งบังเอิญโผล่ใน _id/รหัสสินค้า/มิลลิวินาทีของ created_at ได้ = เทสล้มสุ่ม)
  expect(JSON.stringify(product)).not.toContain("\"quantity\"");
};

describe("สินค้าสาธารณะไม่มีต้นทุน/สูตร", () => {
  it("รายการ + รายละเอียด: ไม่มี purchase_cost / low_stock_threshold · ราคา/สต็อกยังอยู่", async () => {
    const { id } = await productWithRecipe();
    const list = await (await listGET(req("/api/catalog/products"))).json();
    const item = list.data.items.find((p: any) => String(p._id) === id);
    assertPublic(item);
    expect(item).toMatchObject({ product_price: 120, product_stock_quantity: 9 });

    const detail = await (await detailGET(req(`/api/catalog/products/${id}`), { params: Promise.resolve({ id }) })).json();
    assertPublic(detail.data);
    expect(detail.data.product_price).toBe(120);
  });

  it("แนะนำสินค้า (ไม่ล็อกอิน): ชื่อวัตถุดิบเท่านั้น ไม่มีปริมาณในสูตร · สินค้าคล้ายกัน: ไม่มีต้นทุน", async () => {
    const { id } = await productWithRecipe();
    await makeProduct({ product_price: 90, purchase_cost: SECRET_COST });
    const res = await (await recommendedGET(req("/api/catalog/products/recommended"))).json();
    const products = res.data.products as any[];
    const mine = products.find((p) => String(p._id) === id);
    assertPublic(mine);
    expect(mine.ingredientNames).toEqual(["แป้งสาลี"]);
    for (const p of products) expect(p).not.toHaveProperty("purchase_cost");

    const similar = await recommendationService.similar(id, 5);
    for (const r of similar.recommendations as any[]) assertPublic(r.product);
  });
});

describe("sortBy", () => {
  it("หน้าร้านเรียงต้นทุนไม่ได้ (400) · field ที่อนุญาตใช้ได้ · หลังร้านเรียงต้นทุนได้แต่ field แปลก = 400", async () => {
    await productWithRecipe();
    expect((await listGET(req("/api/catalog/products?sortBy=purchase_cost"))).status).toBe(400);
    expect((await listGET(req("/api/catalog/products?sortBy=product_price&sortOrder=asc"))).status).toBe(200);
    const pagination = parsePagination(new URLSearchParams());
    await expect(productService.getProducts({ pagination, sortBy: "purchase_cost" })).resolves.toBeTruthy();
    await expect(productService.getProducts({ pagination, sortBy: "$where" })).rejects.toMatchObject({ status: 400 });
  });
});
