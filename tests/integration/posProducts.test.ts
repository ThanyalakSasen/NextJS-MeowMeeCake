import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission, type MENU_KEYS } from "@/services/permissionService";
import { GET as posProductsGET } from "@/app/api/admin/pos/products/route";
import { makeUser, makeProduct, makeVariant, makeOption } from "./helpers";

/**
 * GET /api/admin/pos/products — รายการสินค้าให้ POS ใต้สิทธิ์ orders (frontend Q-BE10)
 * เดิม POS ใช้ /admin/products (ต้อง products.view) → พนักงานหน้าร้านที่มีแค่สิทธิ์ orders ได้ 403
 */

async function staff(menus: (typeof MENU_KEYS)[number][]) {
  const role = await roleModel.create({ role_name: `staff-${Math.random()}`, role_type: "staff" });
  const user = await makeUser({ role_id: role._id });
  for (const menu_key of menus) {
    await createPermission({ role_id: String(role._id), menu_key, granted_by: String(user._id), can_view: true });
  }
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: "staff",
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return session;
}

async function get(session: SessionUser, query = "") {
  const res = await posProductsGET(
    new NextRequest(`http://localhost:3000/api/admin/pos/products${query}`, {
      headers: { [USER_HEADER]: JSON.stringify(session) },
    })
  );
  return { status: res.status, body: await res.json() };
}

type PosItem = { _id: string; product_name_th: string; has_customization: boolean };
const names = (body: { data: { items: PosItem[] } }): string[] => body.data.items.map((p) => p.product_name_th);

describe("GET /api/admin/pos/products", () => {
  it("พนักงานที่มีแค่ orders.view → 200 · ไม่มีสิทธิ์ orders → 403", async () => {
    await makeProduct();
    expect((await get(await staff(["orders"]))).status).toBe(200);
    expect((await get(await staff(["products"]))).status).toBe(403);
  });

  it("คืนเฉพาะสินค้าที่ขายหน้าร้านได้ — ไม่รวมที่ลบ/พรีออเดอร์ · รวมที่ซ่อนจากเว็บ", async () => {
    await makeProduct({ product_name_th: "ก ปกติ" });
    await makeProduct({ product_name_th: "ข ซ่อนจากเว็บ", is_visible: false });
    await makeProduct({ product_name_th: "ค ลบแล้ว", deleted_at: new Date() });
    await makeProduct({ product_name_th: "ง พรีออเดอร์", product_id: "pre-0000001", is_preorder: true });
    const { body } = await get(await staff(["orders"]));
    expect(names(body)).toEqual(["ก ปกติ", "ข ซ่อนจากเว็บ"]);
    expect(body.data.meta.total).toBe(2);
  });

  it("search ค้นจากรหัสสินค้า ชื่อไทย และชื่ออังกฤษ (ไม่สนตัวพิมพ์)", async () => {
    await makeProduct({ product_id: "pos-1234567", product_name_th: "เค้กช็อกโกแลต", product_name_eng: "Chocolate Cake" });
    await makeProduct({ product_id: "pos-7654321", product_name_th: "ครัวซองต์", product_name_eng: "Croissant" });
    const session = await staff(["orders"]);
    expect(names((await get(session, "?search=pos-12")).body)).toEqual(["เค้กช็อกโกแลต"]);
    expect(names((await get(session, "?search=ครัว")).body)).toEqual(["ครัวซองต์"]);
    expect(names((await get(session, "?search=CHOCO")).body)).toEqual(["เค้กช็อกโกแลต"]);
    expect(names((await get(session, "?search=(")).body)).toEqual([]); // regex พิเศษไม่ทำให้ 500
  });

  it("has_customization — มีตัวเลือก (variant) หรือ option เสริม = true · ตัวที่ลบแล้วไม่นับ", async () => {
    const plain = await makeProduct({ product_name_th: "ก ไม่มีตัวเลือก" });
    const withVariant = await makeProduct({ product_name_th: "ข มีตัวเลือก" });
    const withOption = await makeProduct({ product_name_th: "ค มี option" });
    const deletedOnly = await makeProduct({ product_name_th: "ง ตัวเลือกถูกลบ" });
    await makeVariant(String(withVariant._id));
    await makeOption(String(withOption._id));
    await makeVariant(String(deletedOnly._id), { deleted_at: new Date() });
    const { body } = await get(await staff(["orders"]));
    const flags = Object.fromEntries(body.data.items.map((p: PosItem) => [String(p._id), p.has_customization]));
    expect(flags).toEqual({
      [String(plain._id)]: false,
      [String(withVariant._id)]: true,
      [String(withOption._id)]: true,
      [String(deletedOnly._id)]: false,
    });
  });

  it("ฟิลด์ที่ POS ใช้ครบ · ราคาเป็นบาท · ไม่มี purchase_cost", async () => {
    await makeProduct({ product_id: "pos-0000042", product_price: 120, sale_price: 99, purchase_cost: 4000, product_img: ["a.jpg"], product_stock_quantity: 7 });
    const [p] = (await get(await staff(["orders"]))).body.data.items;
    expect(p).toMatchObject({
      product_id: "pos-0000042",
      product_price: 120,
      sale_price: 99,
      product_img: ["a.jpg"],
      product_stock_quantity: 7,
      is_preorder: false,
      has_customization: false,
    });
    expect(p.product_name_eng).toBeTruthy();
    expect(p).not.toHaveProperty("purchase_cost");
  });

  it("แบ่งหน้าตาม page/limit · meta.total = ทั้งหมด", async () => {
    for (const n of ["ก", "ข", "ค", "ง", "จ"]) await makeProduct({ product_name_th: n });
    const session = await staff(["orders"]);
    const page2 = (await get(session, "?page=2&limit=2")).body;
    expect(names(page2)).toEqual(["ค", "ง"]);
    expect(page2.data.meta).toMatchObject({ page: 2, limit: 2, total: 5 });
  });
});
