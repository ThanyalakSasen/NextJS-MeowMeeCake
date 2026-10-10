import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import { GET as unitsGET, POST as unitsPOST } from "@/app/api/admin/units/route";
import { makeUser, makeUnit } from "./helpers";

/**
 * /api/admin/units — อ่านได้ด้วย view ของ products · ingredients · recipes · stock (crudRoutes readMenus)
 * เขียนยังต้องใช้ products — frontend Final-Backlog P2 (หน้าวัตถุดิบ / สูตร / สต็อก โหลดหน่วยนับ)
 */

async function staff(perms: Record<string, Record<string, boolean>>) {
  const role = await roleModel.create({ role_name: `units-${Math.random()}`, role_type: "staff" });
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

async function call(handler: unknown, session: SessionUser, method = "GET", body?: unknown) {
  const req = new NextRequest("http://localhost:3000/api/admin/units", {
    method,
    headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await (handler as (r: NextRequest) => Promise<Response>)(req)).status;
}

describe("GET /api/admin/units — readMenus", () => {
  it.each(["products", "ingredients", "recipes", "stock"])("มี %s.view อย่างเดียว อ่านหน่วยนับได้", async (menu) => {
    await makeUnit();
    expect(await call(unitsGET, await staff({ [menu]: { can_view: true } }))).toBe(200);
  });

  it("ไม่มี view ของเมนูที่เกี่ยวข้องเลย = 403", async () => {
    expect(await call(unitsGET, await staff({ orders: { can_view: true } }))).toBe(403);
  });

  it("สร้างหน่วยนับยังต้องใช้ products.create — ingredients ครบทุก flag ก็ไม่ได้", async () => {
    const session = await staff({ ingredients: { can_view: true, can_create: true, can_update: true, can_delete: true } });
    expect(await call(unitsPOST, session, "POST", { unit_name: "ถาด", unit_abbr: "ถาด", unit_type: "Tray" })).toBe(403);
  });
});
