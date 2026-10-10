import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import { GET as stockListGET } from "@/app/api/admin/products/stock-list/route";
import { makeUser, makeProduct } from "./helpers";

/**
 * GET /api/admin/products/stock-list — หน้าสต็อกสินค้าโหลดรายการได้ด้วย stock.view (frontend Final-Backlog P12)
 * เดิมต้องใช้ /admin/products ที่ต้อง products.view
 */

async function staff(perms: Record<string, Record<string, boolean>>) {
  const role = await roleModel.create({ role_name: `stock-${Math.random()}`, role_type: "staff" });
  const user = await makeUser({ role_id: role._id });
  for (const [menu_key, flags] of Object.entries(perms)) {
    await createPermission({ role_id: String(role._id), menu_key: menu_key as never, granted_by: String(user._id), ...flags });
  }
  const session: SessionUser = {
    user_id: String(user._id), role_id: String(role._id), role_type: "staff",
    email: user.email, source: "jwt", auth_time: Date.now(),
  };
  return session;
}

async function call(session: SessionUser) {
  const req = new NextRequest("http://localhost:3000/api/admin/products/stock-list?limit=100", {
    headers: { [USER_HEADER]: JSON.stringify(session) },
  });
  const res = await (stockListGET as unknown as (r: NextRequest) => Promise<Response>)(req);
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

describe("GET /api/admin/products/stock-list", () => {
  it("มีแค่ stock.view ได้รายการสินค้าปกติ — ไม่มีพรีออเดอร์ · ไม่มีที่ถูกลบ · ไม่มี purchase_cost", async () => {
    const normal = await makeProduct({ product_name_th: "ขนมปังสต็อก", product_stock_quantity: 7, purchase_cost: 2500 });
    await makeProduct({ product_name_th: "เค้กพรีออเดอร์", is_preorder: true });
    await makeProduct({ product_name_th: "สินค้าลบแล้ว", deleted_at: new Date() });

    const { status, body } = await call(await staff({ stock: { can_view: true } }));
    expect(status).toBe(200);
    const names = body.data.items.map((p: { product_name_th: string }) => p.product_name_th);
    expect(names).toContain("ขนมปังสต็อก");
    expect(names).not.toContain("เค้กพรีออเดอร์");
    expect(names).not.toContain("สินค้าลบแล้ว");
    const row = body.data.items.find((p: { _id: string }) => p._id === String(normal._id));
    expect(row.product_stock_quantity).toBe(7);
    expect(row.purchase_cost).toBeUndefined();
  });

  it("ไม่มี stock.view = 403 (มีแค่ products ก็ไม่ได้ — หน้าสินค้าใช้ /admin/products อยู่แล้ว)", async () => {
    expect((await call(await staff({ products: { can_view: true } }))).status).toBe(403);
  });
});
