import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { saveProductCustomization } from "@/services/productCustomizationService";
import * as cartService from "@/services/cartService";
import { POST as addItemPOST } from "@/app/api/shop/cart/items/route";
import { makeUser, makeProduct } from "./helpers";

/**
 * POST /api/shop/cart/items ต้องส่ง variant_ids ต่อให้ cartService — เดิม route ทิ้งไป (schema รับ แต่ไม่ส่งต่อ)
 * → สินค้าที่มีกลุ่มบังคับเลือกใส่ตะกร้าจากหน้าเว็บไม่ได้เลย (frontend BACKLOG4 C1)
 */

async function customer() {
  const role = await roleModel.create({ role_name: `customer-${Math.random()}`, role_type: "customer" });
  const user = await makeUser({ role_id: role._id, is_email_verified: true });
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: "customer",
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return { user, session };
}

const post = (session: SessionUser, body: unknown) =>
  addItemPOST(
    new NextRequest("http://localhost:3000/api/shop/cart/items", {
      method: "POST",
      headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) } as never
  );

async function cakeWithGroups() {
  const product = await makeProduct({ product_price: 150 });
  const custom = await saveProductCustomization(String(product._id), {
    groups: [
      { group_name: "ขนาด", min_select: 1, max_select: 1, variants: [{ variant_name: "เล็ก", variant_price: 0 }, { variant_name: "ใหญ่", variant_price: 50 }] },
      { group_name: "ท็อปปิ้ง", min_select: 0, max_select: 2, variants: [{ variant_name: "ช็อก", variant_price: 10 }, { variant_name: "อัลมอนด์", variant_price: 20 }] },
    ],
    options: [],
  });
  return { product, custom };
}

describe("POST /api/shop/cart/items — variant_ids", () => {
  it("เลือกหลายกลุ่ม → 201 · ราคา = ฐาน + ทุกตัวเลือก · เก็บ selected_variants ครบ", async () => {
    const { session, user } = await customer();
    const { product, custom } = await cakeWithGroups();
    const big = custom.groups[0].variants[1];
    const choc = custom.groups[1].variants[0];
    const res = await post(session, { product_id: String(product._id), quantity: 1, variant_ids: [big._id, choc._id] });
    expect(res.status).toBe(201);
    const cart = await cartService.getCartDetail(String(user._id));
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].price_snapshot).toBe(210);
    expect(cart.items[0].selected_variants.map((v: { variant_name: string }) => v.variant_name)).toEqual(["ใหญ่", "ช็อก"]);
  });

  it("ไม่ส่งตัวเลือกของกลุ่มบังคับ → 400", async () => {
    const { session } = await customer();
    const { product } = await cakeWithGroups();
    const res = await post(session, { product_id: String(product._id), quantity: 1 });
    expect(res.status).toBe(400);
  });

  it("variant_id แบบเดิม (ตัวเลือกเดียว) ยังใช้ได้", async () => {
    const { session } = await customer();
    const { product, custom } = await cakeWithGroups();
    const res = await post(session, { product_id: String(product._id), quantity: 1, variant_id: custom.groups[0].variants[0]._id });
    expect(res.status).toBe(201);
  });
});
