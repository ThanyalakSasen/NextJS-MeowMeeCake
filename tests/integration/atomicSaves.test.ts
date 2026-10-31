import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import permissionModel from "@/models/permissionModel";
import productionItemModel from "@/models/productionItemModel";
import productionOrderModel from "@/models/productionOrderModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import * as productionOrderService from "@/services/productionOrderService";
import { PUT as rolePermissionsPUT } from "@/app/api/admin/permissions/role/[roleId]/route";
import { PUT as productionEditPUT } from "@/app/api/admin/production-orders/[id]/edit/route";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * เอกสารบั๊กข้อ 12 — บันทึกหลายคำขอแบบไม่ atomic
 * สิทธิ์ทั้งบทบาท / ใบสั่งผลิตทั้งใบ บันทึกในคำขอเดียว: ตรวจทุกอย่างก่อนเขียน — ผิดแถวเดียว = ไม่มีอะไรถูกเขียน
 */

const FULL = { can_view: true, can_create: true, can_update: true, can_delete: true, can_approve: true };
let seq = 0;
type Row = Record<string, unknown> & { _id: unknown };
const name = (p: string) => `${p}-${++seq}-${Math.random()}`;

async function owner(): Promise<SessionUser> {
  const role = await roleModel.create({ role_name: name("owner"), role_type: "owner" });
  const user = await makeUser({ role_id: role._id });
  return { user_id: String(user._id), role_id: String(role._id), role_type: "owner", email: user.email, source: "jwt", auth_time: Date.now() };
}

async function staff(perms: Record<string, Record<string, boolean>>): Promise<SessionUser> {
  const role = await roleModel.create({ role_name: name("staff"), role_type: "staff" });
  const user = await makeUser({ role_id: role._id });
  for (const [menu_key, flags] of Object.entries(perms)) {
    await createPermission({ role_id: String(role._id), menu_key: menu_key as never, granted_by: String(user._id), ...flags });
  }
  return { user_id: String(user._id), role_id: String(role._id), role_type: "staff", email: user.email, source: "jwt", auth_time: Date.now() };
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function put(handler: unknown, session: SessionUser, params: Record<string, string>, body: unknown) {
  const req = new NextRequest("http://localhost:3000/api/x", {
    method: "PUT",
    headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
}

describe("PUT /admin/permissions/role/[roleId] — สิทธิ์ทั้งบทบาทในคำขอเดียว", () => {
  it("สร้าง + แก้หลายเมนูรวดเดียว · flag ที่ไม่เปลี่ยนไม่แตะ · แถวว่างไม่สร้าง", async () => {
    const session = await owner();
    const target = await roleModel.create({ role_name: name("t"), role_type: "staff" });
    await createPermission({ role_id: String(target._id), menu_key: "products", granted_by: session.user_id, can_view: true });

    const res = await put(rolePermissionsPUT, session, { roleId: String(target._id) }, {
      rows: [
        { menu_key: "products", can_view: true, can_update: true },
        { menu_key: "orders", can_view: true },
        { menu_key: "payments", can_view: false },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ created: 1, updated: 1 });
    const rows = await permissionModel.find({ role_id: target._id, deleted_at: null }).lean<Row[]>();
    expect(rows.map((r) => r.menu_key).sort()).toEqual(["orders", "products"]);
    expect(rows.find((r) => r.menu_key === "products")).toMatchObject({ can_view: true, can_update: true });
  });

  it("เกินเพดานสิทธิ์แถวเดียว = 403 และไม่มีเมนูไหนถูกบันทึก", async () => {
    const session = await staff({ permissions: FULL, products: { can_view: true } });
    const target = await roleModel.create({ role_name: name("t"), role_type: "staff" });
    const res = await put(rolePermissionsPUT, session, { roleId: String(target._id) }, {
      rows: [
        { menu_key: "products", can_view: true },
        { menu_key: "payments", can_view: true, can_approve: true },
      ],
    });
    expect(res.status).toBe(403);
    expect(await permissionModel.countDocuments({ role_id: target._id })).toBe(0);
  });

  it("เมนูซ้ำในคำขอ = 400", async () => {
    const session = await owner();
    const target = await roleModel.create({ role_name: name("t"), role_type: "staff" });
    const res = await put(rolePermissionsPUT, session, { roleId: String(target._id) }, {
      rows: [{ menu_key: "orders", can_view: true }, { menu_key: "orders", can_create: true }],
    });
    expect(res.status).toBe(400);
    expect(await permissionModel.countDocuments({ role_id: target._id })).toBe(0);
  });
});

async function line(qty: number) {
  const product = await makeProduct({ product_stock_quantity: 0 });
  const recipe = await makeRecipe(String(product._id));
  return { product_id: String(product._id), recipe_id: String(recipe._id), planned_qty: qty };
}

async function orderWithItems() {
  const order = (await productionOrderService.createProductionOrder({
    production_date: new Date(),
    items: [await line(2), await line(3)],
  })) as { _id: unknown };
  const items = await productionItemModel.find({ production_order_id: order._id }).sort({ _id: 1 }).lean<Row[]>();
  return { id: String(order._id), a: String(items[0]._id), b: String(items[1]._id) };
}

describe("PUT /admin/production-orders/[id]/edit — ใบสั่งผลิตทั้งใบในคำขอเดียว", () => {
  it("หัวใบ + ลบ + แก้ + เพิ่ม บันทึกพร้อมกัน", async () => {
    const session = await owner();
    const { id, a, b } = await orderWithItems();
    const add = await line(7);
    const res = await put(productionEditPUT, session, { id }, {
      production_note: "แก้ทั้งใบ",
      items: { remove: [a], update: [{ item_id: b, planned_qty: 5, notes: "เพิ่มจำนวน" }], add: [add] },
    });
    expect(res.status).toBe(200);
    expect((await productionOrderModel.findById(id).lean<Row>())?.production_note).toBe("แก้ทั้งใบ");
    const live = await productionItemModel.find({ production_order_id: id, deleted_at: null }).lean<Row[]>();
    expect(live.map((it) => it.planned_qty).sort()).toEqual([5, 7]);
    expect(live.find((it) => String(it._id) === b)?.notes).toBe("เพิ่มจำนวน");
  });

  it("รายการใหม่สูตรไม่ตรงสินค้า = 400 และหัวใบ/รายการเดิมไม่เปลี่ยน", async () => {
    const session = await owner();
    const { id, a, b } = await orderWithItems();
    const x = await line(1);
    const y = await line(1);
    const res = await put(productionEditPUT, session, { id }, {
      production_note: "ไม่ควรถูกบันทึก",
      items: { remove: [a], update: [{ item_id: b, planned_qty: 9 }], add: [{ ...x, recipe_id: y.recipe_id }] },
    });
    expect(res.status).toBe(400);
    expect((await productionOrderModel.findById(id).lean<Row>())?.production_note ?? null).toBeNull();
    const live = await productionItemModel.find({ production_order_id: id, deleted_at: null }).lean<Row[]>();
    expect(live.map((it) => it.planned_qty).sort()).toEqual([2, 3]);
  });

  it("รายการของใบอื่น / หักสต็อกแล้ว = ไม่ได้ และไม่มีอะไรเปลี่ยน", async () => {
    const session = await owner();
    const first = await orderWithItems();
    const other = await orderWithItems();
    expect((await put(productionEditPUT, session, { id: first.id }, { items: { remove: [other.a] } })).status).toBe(404);

    await productionItemModel.updateOne({ _id: first.b }, { $set: { stock_updated_at: new Date() } });
    const res = await put(productionEditPUT, session, { id: first.id }, {
      items: { remove: [first.a], update: [{ item_id: first.b, planned_qty: 1 }] },
    });
    expect(res.status).toBe(409);
    expect(await productionItemModel.countDocuments({ production_order_id: first.id, deleted_at: null })).toBe(2);
  });

  it("ลบรายการต้องมีสิทธิ์ production.delete ด้วย", async () => {
    const session = await staff({ production: { can_view: true, can_update: true } });
    const { id, a, b } = await orderWithItems();
    expect((await put(productionEditPUT, session, { id }, { items: { remove: [a] } })).status).toBe(403);
    expect((await put(productionEditPUT, session, { id }, { items: { update: [{ item_id: b, planned_qty: 4 }] } })).status).toBe(200);
  });
});
