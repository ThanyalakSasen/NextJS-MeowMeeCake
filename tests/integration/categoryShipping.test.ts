import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import productCategoryModel from "@/models/productCategoryModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import { categoryShipsNationwide } from "@/lib/shipping";
import { GET as listGET } from "@/app/api/admin/shipping-zones/categories/route";
import { PATCH as itemPATCH } from "@/app/api/admin/shipping-zones/categories/[id]/route";
import productModel from "@/models/productModel";
import storeSettingsModel from "@/models/storeSettingsModel";
import * as shippingService from "@/services/shippingService";
import { GET as productsGET, PATCH as productsPATCH } from "@/app/api/admin/shipping-zones/products/route";
import { GET as exceptionsGET } from "@/app/api/catalog/shipping-exceptions/route";
import { makeUser, makeProduct } from "./helpers";

/**
 * /api/admin/shipping-zones/categories — สวิตช์ "ส่งทั่วประเทศ" รายหมวดสินค้า ย้ายมาอยู่หน้า "ค่าจัดส่งหน้าร้านออนไลน์"
 * ใช้สิทธิ์ store_info (เดียวกับโซนค่าส่ง) — ไม่ต้องมีสิทธิ์จัดการสินค้า
 */

async function sessionFor(roleType: "owner" | "staff", perms: { can_view?: boolean; can_update?: boolean } = {}) {
  const role = await roleModel.create({ role_name: `${roleType}-${Math.random()}`, role_type: roleType });
  const user = await makeUser({ role_id: role._id });
  if (roleType === "staff" && (perms.can_view || perms.can_update)) {
    await createPermission({ role_id: String(role._id), menu_key: "shipping", granted_by: String(user._id), ...perms });
  }
  const session: SessionUser = {
    user_id: String(user._id), role_id: String(role._id), role_type: roleType,
    email: user.email, source: "jwt", auth_time: Date.now(),
  };
  return session;
}

const headers = (s: SessionUser) => ({ [USER_HEADER]: JSON.stringify(s), "content-type": "application/json" });

async function list(s: SessionUser) {
  const res = await listGET(new NextRequest("http://localhost:3000/api/admin/shipping-zones/categories", { headers: headers(s) }));
  return { status: res.status, body: await res.json() };
}

async function patch(s: SessionUser, id: string, body: unknown) {
  const res = await itemPATCH(
    new NextRequest(`http://localhost:3000/api/admin/shipping-zones/categories/${id}`, {
      method: "PATCH", headers: headers(s), body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
  return { status: res.status, body: await res.json() };
}

describe("GET /api/admin/shipping-zones/categories", () => {
  it("คืนค่าที่มีผลจริง + บอกว่ายังไม่เคยตั้ง (เดาจากชื่อ) · ไม่แสดงหมวดที่ลบแล้ว", async () => {
    await productCategoryModel.create({ product_category_name: "ซาวโดว์ทดสอบ" });
    await productCategoryModel.create({ product_category_name: "เค้กทดสอบ", ships_nationwide: true });
    await productCategoryModel.create({ product_category_name: "หมวดที่ลบแล้ว", deleted_at: new Date() });

    const { status, body } = await list(await sessionFor("owner"));
    expect(status).toBe(200);
    const byName = Object.fromEntries(body.data.items.map((c: { product_category_name: string }) => [c.product_category_name, c]));
    expect(byName["ซาวโดว์ทดสอบ"]).toMatchObject({ ships_nationwide: true, ships_nationwide_auto: true });
    expect(byName["เค้กทดสอบ"]).toMatchObject({ ships_nationwide: true, ships_nationwide_auto: false });
    expect(byName["หมวดที่ลบแล้ว"]).toBeUndefined();
  });

  it("พนักงาน: มี store_info.view → 200 · ไม่มี → 403", async () => {
    expect((await list(await sessionFor("staff", { can_view: true }))).status).toBe(200);
    expect((await list(await sessionFor("staff"))).status).toBe(403);
  });
});

describe("PATCH /api/admin/shipping-zones/categories/:id", () => {
  it("พนักงานที่มี store_info.update (ไม่มีสิทธิ์สินค้า) ตั้งได้ → มีผลกับการคิดขอบเขตจัดส่ง", async () => {
    const cat = await productCategoryModel.create({ product_category_name: "ซาวโดว์ปิดส่ง" });
    const staff = await sessionFor("staff", { can_view: true, can_update: true });

    const { status, body } = await patch(staff, String(cat._id), { ships_nationwide: false });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ ships_nationwide: false, ships_nationwide_auto: false });
    const saved = await productCategoryModel.findById(cat._id).lean<{ product_category_name: string; ships_nationwide?: boolean }>();
    expect(categoryShipsNationwide(saved!)).toBe(false); // ชื่อซาวโดว์แต่ตั้งปิดไว้ → ใช้ค่าที่ตั้ง
  });

  it("ไม่มีสิทธิ์ update → 403 · body ผิด → 400 · หมวดไม่มี/ถูกลบ → 404", async () => {
    const cat = await productCategoryModel.create({ product_category_name: "คุกกี้" });
    const viewer = await sessionFor("staff", { can_view: true });
    expect((await patch(viewer, String(cat._id), { ships_nationwide: true })).status).toBe(403);

    const owner = await sessionFor("owner");
    expect((await patch(owner, String(cat._id), { ships_nationwide: "yes" })).status).toBe(400);
    expect((await patch(owner, "6a0000000000000000000099", { ships_nationwide: true })).status).toBe(404);
    expect((await patch(owner, "not-an-id", { ships_nationwide: true })).status).toBe(404);

    await productCategoryModel.updateOne({ _id: cat._id }, { $set: { deleted_at: new Date() } });
    expect((await patch(owner, String(cat._id), { ships_nationwide: true })).status).toBe(404);
  });
});

// ── ยกเว้นรายสินค้า (/api/admin/shipping-zones/products) ─────────────────────────────

async function listProducts(s: SessionUser) {
  const res = await productsGET(new NextRequest("http://localhost:3000/api/admin/shipping-zones/products", { headers: headers(s) }));
  return { status: res.status, body: await res.json() };
}

async function patchProducts(s: SessionUser, body: unknown) {
  const res = await productsPATCH(
    new NextRequest("http://localhost:3000/api/admin/shipping-zones/products", {
      method: "PATCH", headers: headers(s), body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: await res.json() };
}

describe("ยกเว้นขอบเขตจัดส่งรายสินค้า", () => {
  it("ตั้งหลายสินค้าพร้อมกัน → GET เห็นค่ายกเว้น + ค่าที่ใช้จริง · null = กลับไปตามหมวด", async () => {
    const cake = await productCategoryModel.create({ product_category_name: "เค้กยกเว้น", ships_nationwide: false });
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => makeProduct({ category_id: cake._id })));
    const staff = await sessionFor("staff", { can_view: true, can_update: true });

    const res = await patchProducts(staff, { product_ids: [String(a._id), String(b._id)], ships_nationwide: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 2, ships_nationwide: true });

    const rows = (await listProducts(staff)).body.data.items as Array<{ _id: string; ships_nationwide: boolean | null; category_ships_nationwide: boolean; effective_ships_nationwide: boolean }>;
    const row = (id: unknown) => rows.find((r) => r._id === String(id))!;
    expect(row(a._id)).toMatchObject({ ships_nationwide: true, category_ships_nationwide: false, effective_ships_nationwide: true });
    expect(row(c._id)).toMatchObject({ ships_nationwide: null, effective_ships_nationwide: false });

    await patchProducts(staff, { product_ids: [String(a._id)], ships_nationwide: null });
    expect((await productModel.findById(a._id).lean<{ ships_nationwide: unknown }>())!.ships_nationwide).toBeNull();
  });

  it("ค่ายกเว้นมีผลกับการตรวจขอบเขตจัดส่งตอนสั่งจริง (ทั้งเปิดและปิดสวนหมวด)", async () => {
    await storeSettingsModel.create({ province: "หนองคาย" });
    const cake = await productCategoryModel.create({ product_category_name: "เค้กสดยกเว้น", ships_nationwide: false });
    const bread = await productCategoryModel.create({ product_category_name: "ซาวโดว์ยกเว้น", ships_nationwide: true });
    const banana = await makeProduct({ category_id: cake._id });
    const fragile = await makeProduct({ category_id: bread._id });
    const quote = (ids: unknown[]) => shippingService.quoteStorefrontDelivery({ province: "อุดรธานี", productIds: ids.map(String) });

    await expect(quote([banana._id])).rejects.toMatchObject({ status: 400 }); // ตามหมวด = เฉพาะจังหวัด
    await shippingService.setProductShipping([String(banana._id)], true);
    await expect(quote([banana._id])).resolves.toMatchObject({ zone_code: expect.any(String) }); // ยกเว้นให้ส่งได้

    await expect(quote([fragile._id])).resolves.toBeTruthy(); // ตามหมวด = ทั่วประเทศ
    await shippingService.setProductShipping([String(fragile._id)], false);
    await expect(quote([fragile._id, banana._id])).rejects.toMatchObject({ status: 400 }); // ชิ้นเดียวเฉพาะจังหวัด = ทั้งตะกร้า
  });

  it("สิทธิ์: ไม่มี store_info.update → 403 · ไม่มี view → 403 · ไม่เลือกสินค้า/ค่าผิด → 400 · id ไม่พบ → 404 (ไม่แก้บางส่วน)", async () => {
    const p = await makeProduct();
    expect((await patchProducts(await sessionFor("staff", { can_view: true }), { product_ids: [String(p._id)], ships_nationwide: true })).status).toBe(403);
    expect((await listProducts(await sessionFor("staff"))).status).toBe(403);

    const owner = await sessionFor("owner");
    expect((await patchProducts(owner, { product_ids: [], ships_nationwide: true })).status).toBe(400);
    expect((await patchProducts(owner, { product_ids: [String(p._id)], ships_nationwide: "yes" })).status).toBe(400);
    expect((await patchProducts(owner, { product_ids: [String(p._id), "6a0000000000000000000099"], ships_nationwide: true })).status).toBe(404);
    expect((await productModel.findById(p._id).lean<{ ships_nationwide: unknown }>())!.ships_nationwide ?? null).toBeNull();
  });
});

describe("GET /api/catalog/shipping-exceptions (หน้าการจัดส่งของลูกค้า)", () => {
  it("แสดงเฉพาะสินค้าที่เปิดขายและตั้งต่างจากหมวด · ตั้งซ้ำกับหมวด/ตามหมวด/ซ่อน/ลบ ไม่แสดง", async () => {
    const cake = await productCategoryModel.create({ product_category_name: "เค้กลูกค้า", ships_nationwide: false });
    const bread = await productCategoryModel.create({ product_category_name: "ซาวโดว์ลูกค้า", ships_nationwide: true });
    const extra = await makeProduct({ product_name_th: "เค้กกล้วยหอมส่งได้", category_id: cake._id, ships_nationwide: true });
    const local = await makeProduct({ product_name_th: "ขนมปังสดเฉพาะจังหวัด", category_id: bread._id, ships_nationwide: false });
    await makeProduct({ product_name_th: "ซ้ำกับหมวด", category_id: bread._id, ships_nationwide: true });
    await makeProduct({ product_name_th: "ตามหมวด", category_id: cake._id });
    await makeProduct({ product_name_th: "ซ่อนอยู่", category_id: cake._id, ships_nationwide: true, is_visible: false });
    await makeProduct({ product_name_th: "ลบแล้ว", category_id: cake._id, ships_nationwide: true, deleted_at: new Date() });

    const res = await exceptionsGET();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.nationwide).toEqual([{ _id: String(extra._id), product_name_th: "เค้กกล้วยหอมส่งได้", category_name: "เค้กลูกค้า" }]);
    expect(data.province_only).toEqual([{ _id: String(local._id), product_name_th: "ขนมปังสดเฉพาะจังหวัด", category_name: "ซาวโดว์ลูกค้า" }]);
  });
});

describe("PATCH หมวด + reset_products (เปิด/ปิดทั้งหมวด)", () => {
  it("ล้างค่ายกเว้นเฉพาะสินค้าในหมวดนั้น · ไม่ส่ง reset = ไม่แตะสินค้า", async () => {
    const cake = await productCategoryModel.create({ product_category_name: "เค้กรีเซ็ต", ships_nationwide: false });
    const other = await productCategoryModel.create({ product_category_name: "หมวดอื่นรีเซ็ต", ships_nationwide: false });
    const a = await makeProduct({ category_id: cake._id, ships_nationwide: true });
    const b = await makeProduct({ category_id: cake._id, ships_nationwide: false });
    const c = await makeProduct({ category_id: other._id, ships_nationwide: true });
    const owner = await sessionFor("owner");
    const override = async (id: unknown) => (await productModel.findById(id).lean<{ ships_nationwide: unknown }>())!.ships_nationwide;

    const plain = await patch(owner, String(cake._id), { ships_nationwide: true });
    expect(plain.body.data.products_reset).toBe(0);
    expect(await override(a._id)).toBe(true); // ไม่แตะ

    const reset = await patch(owner, String(cake._id), { ships_nationwide: false, reset_products: true });
    expect(reset.status).toBe(200);
    expect(reset.body.data).toMatchObject({ ships_nationwide: false, products_reset: 2 });
    expect(await override(a._id)).toBeNull();
    expect(await override(b._id)).toBeNull();
    expect(await override(c._id)).toBe(true); // หมวดอื่นไม่โดน
  });
});

describe("พรีออเดอร์ส่งได้ทุกจังหวัด (ไม่ตรวจขอบเขตจัดส่ง)", () => {
  it("รอบพรีออเดอร์ (preorder: true) และสินค้า is_preorder ส่งนอกจังหวัดได้ · สินค้าปกติเฉพาะจังหวัดยังถูกกัน", async () => {
    await storeSettingsModel.create({ province: "หนองคาย" });
    const cake = await productCategoryModel.create({ product_category_name: "เค้กสดพรี", ships_nationwide: false });
    const fresh = await makeProduct({ category_id: cake._id });
    const pre = await makeProduct({
      category_id: cake._id,
      is_preorder: true,
      product_stock_quantity: null,
      preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: 1 },
    });
    const quote = (ids: unknown[], preorder?: boolean) =>
      shippingService.quoteStorefrontDelivery({ province: "เชียงใหม่", productIds: ids.map(String), preorder });

    await expect(quote([fresh._id])).rejects.toMatchObject({ status: 400 });
    // สินค้าปกติในรอบพรีออเดอร์ — สั่งผ่านพรีออเดอร์ = ส่งได้
    expect((await quote([fresh._id], true)).fee).toBeGreaterThan(0);
    // สินค้าพรีออเดอร์ส่งได้แม้หมวดส่งเฉพาะจังหวัด
    expect((await quote([pre._id])).fee).toBeGreaterThan(0);
    // ปนกับสินค้าเฉพาะจังหวัดในตะกร้าปกติ → ยังกันตามสินค้าปกติ
    await expect(quote([pre._id, fresh._id])).rejects.toMatchObject({ status: 400 });
  });

  it("หน้า \"การจัดส่ง\": สินค้าพรีออเดอร์ที่ตั้งส่งเฉพาะจังหวัดไม่ขึ้นในรายการเฉพาะจังหวัด", async () => {
    const bread = await productCategoryModel.create({ product_category_name: "ซาวโดว์พรี", ships_nationwide: true });
    await makeProduct({
      product_name_th: "พรีเฉพาะจังหวัด",
      category_id: bread._id,
      ships_nationwide: false,
      is_preorder: true,
      product_stock_quantity: null,
      preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: 1 },
    });
    await makeProduct({ product_name_th: "ปกติเฉพาะจังหวัด", category_id: bread._id, ships_nationwide: false });
    const body = await (await exceptionsGET()).json();
    const names = body.data.province_only.map((p: { product_name_th: string }) => p.product_name_th);
    expect(names).toContain("ปกติเฉพาะจังหวัด");
    expect(names).not.toContain("พรีเฉพาะจังหวัด");
  });
});
