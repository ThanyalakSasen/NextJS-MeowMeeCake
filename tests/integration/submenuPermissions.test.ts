import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import permissionModel from "@/models/permissionModel";
import migrationModel from "@/models/migrationModel";
import { createPermission, ensureSubmenuPermissions, getMenuAccess, migrateSubmenuPermissions, SUBMENU_PARENT, type MenuKey } from "@/services/permissionService";
import { requirePermission } from "@/lib/authGuard";
import type { SessionUser } from "@/lib/session";
import { makeUser } from "./helpers";

/**
 * แยกสิทธิ์ตามหน้าย่อย (src/lib/menuKeys.ts) — แถวสิทธิ์ของ key เดิมถูกคัดลอกให้ key หน้าย่อยครั้งเดียว
 * ใครเคยเข้าหน้าไหนได้ ยังเข้าได้เหมือนเดิม · หลังจากนั้นตั้งแยกกันได้ และไม่ถูกคัดลอกทับอีก
 */

async function staffRole(rows: Record<string, Record<string, boolean>>) {
  const role = await roleModel.create({ role_name: `sub-${Math.random()}`, role_type: "staff" });
  const owner = await makeUser();
  // เขียนตรงลง DB (จำลองแถวที่มีอยู่ก่อนแยก key) — ไม่ผ่าน createPermission ที่จะสั่งย้ายก่อน
  for (const [menu_key, flags] of Object.entries(rows)) {
    await permissionModel.create({ role_id: role._id, menu_key, granted_by: owner._id, ...flags });
  }
  const session: SessionUser = {
    user_id: String(owner._id), role_id: String(role._id), role_type: "staff", email: owner.email, source: "jwt", auth_time: Date.now(),
  };
  return { role, owner, session };
}

/** ล้างเครื่องหมาย "ย้ายแล้ว" แล้วย้ายใหม่ (ensureSubmenuPermissions จำผลไว้ทั้ง process · DB ถูกล้างทุกเทสต์) */
async function migrate() {
  await migrationModel.deleteMany({});
  await migrateSubmenuPermissions();
}

describe("ย้ายสิทธิ์ไปหน้าย่อย", () => {
  it("บทบาทที่มี reports / products / orders / ingredients / employees / store_info ได้สิทธิ์หน้าย่อยเท่าเดิม", async () => {
    const { role, session } = await staffRole({
      reports: { can_view: true, can_update: true },
      products: { can_view: true },
      orders: { can_view: true, can_create: true },
      ingredients: { can_view: true, can_update: true },
      employees: { can_view: true },
      store_info: { can_view: true, can_update: true },
    });
    await migrate();

    const access = await getMenuAccess(session);
    // parent เป็น MenuKey ทั้ง union — ต้องประกาศเป็น Partial<Record<MenuKey,…>> ถึงจะ index ได้
    const expected: Partial<Record<MenuKey, { v: boolean; u: boolean }>> = {
      reports: { v: true, u: true }, products: { v: true, u: false }, orders: { v: true, u: false },
      ingredients: { v: true, u: true }, employees: { v: true, u: false }, store_info: { v: true, u: true },
    };
    for (const [child, parent] of Object.entries(SUBMENU_PARENT)) {
      const p = expected[parent!]!;
      expect(access[child as keyof typeof access].can_view, child).toBe(p.v);
      expect(access[child as keyof typeof access].can_update, child).toBe(p.u);
    }
    expect(access.pos.can_create).toBe(true);
    // API ที่ย้ายไปใช้ key หน้าย่อยแล้ว ผ่านเหมือนเดิม
    await expect(requirePermission(session, "reports_reviews", "update")).resolves.toBeUndefined();
    await expect(requirePermission(session, "pos", "create")).resolves.toBeUndefined();
    expect(await permissionModel.countDocuments({ role_id: role._id, menu_key: "finance_summary" })).toBe(1);
  });

  it("ไม่มีแถวของ key เดิม = ไม่ได้สิทธิ์หน้าย่อย · แถวหน้าย่อยที่มีอยู่แล้วไม่ถูกทับ", async () => {
    const { role, session, owner } = await staffRole({ reports: { can_view: true } });
    await createPermission({ role_id: String(role._id), menu_key: "reports_sales", granted_by: String(owner._id), can_view: false });
    await migrate();
    const access = await getMenuAccess(session);
    expect(access.reports_sales.can_view).toBe(false); // ตั้งไว้แล้ว ไม่ถูกคัดลอกทับ
    expect(access.finance_expenses.can_view).toBe(true);
    expect(access.pos.can_view).toBe(false);
    await expect(requirePermission(session, "pos", "view")).rejects.toMatchObject({ status: 403 });
  });

  it("ย้ายแล้วไม่ย้ายซ้ำ — ลบสิทธิ์หน้าย่อยไปแล้วไม่กลับมาเอง", async () => {
    const { role, session } = await staffRole({ orders: { can_view: true } });
    await migrate();
    await permissionModel.updateOne({ role_id: role._id, menu_key: "pos" }, { $set: { deleted_at: new Date() } });
    await ensureSubmenuPermissions();
    expect(await migrationModel.exists({ _id: "submenu-permissions-v1" })).toBeTruthy();
    expect(await permissionModel.countDocuments({ role_id: role._id, menu_key: "pos", deleted_at: null })).toBe(0);
    void session;
  });

  it("ส่งหลาย key ให้ requirePermission = มีสิทธิ์ใน key ใดก็ผ่าน", async () => {
    const { session } = await staffRole({ pricing: { can_view: true } });
    await expect(requirePermission(session, ["products", "pricing"], "view")).resolves.toBeUndefined();
    await expect(requirePermission(session, ["products", "recipes"], "view")).rejects.toMatchObject({ status: 403 });
  });
});
