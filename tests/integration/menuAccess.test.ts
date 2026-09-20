import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import { createPermission, getMenuAccess, MENU_KEYS } from "@/services/permissionService";
import { makeUser } from "./helpers";

/**
 * getMenuAccess() — สิทธิ์เมนูของตัวเอง ส่งไปกับ GET /api/auth/me ให้ frontend ซ่อน/แสดงเมนู
 * (เดิม frontend เดาจาก role_type อย่างเดียว → staff ถูกปิดทุกเมนู)
 */
describe("permissionService.getMenuAccess", () => {
  async function makeStaffRole() {
    return roleModel.create({ role_name: `staff-${Date.now()}-${Math.random()}`, role_type: "staff" });
  }

  it("owner → true ทุก action ของทุกเมนู (ไม่ต้องมีแถวใน permissions)", async () => {
    const access = await getMenuAccess({ role_id: String((await makeStaffRole())._id), role_type: "owner" });
    for (const menu of MENU_KEYS) {
      expect(access[menu]).toEqual({ can_view: true, can_create: true, can_update: true, can_delete: true, can_approve: true });
    }
  });

  it("staff → ตามแถวใน permissions; เมนูที่ไม่มีแถวเป็น false ทุก action", async () => {
    const role = await makeStaffRole();
    const admin = await makeUser();
    await createPermission({ role_id: String(role._id), menu_key: "orders", granted_by: String(admin._id), can_view: true, can_update: true });

    const access = await getMenuAccess({ role_id: String(role._id), role_type: "staff" });

    expect(access.orders).toEqual({ can_view: true, can_create: false, can_update: true, can_delete: false, can_approve: false });
    expect(access.products.can_view).toBe(false);
    expect(Object.keys(access).sort()).toEqual([...MENU_KEYS].sort());
  });

  it("staff ที่ไม่มีสิทธิ์เลย → false ทุกเมนู (ไม่ throw)", async () => {
    const role = await makeStaffRole();
    const access = await getMenuAccess({ role_id: String(role._id), role_type: "staff" });
    expect(MENU_KEYS.every((m) => Object.values(access[m]).every((v) => v === false))).toBe(true);
  });

  it("สิทธิ์ที่หมดอายุแล้ว (expires_at ในอดีต) ไม่ถูกนับ", async () => {
    const role = await makeStaffRole();
    const admin = await makeUser();
    await createPermission({
      role_id: String(role._id),
      menu_key: "reports",
      granted_by: String(admin._id),
      can_view: true,
      expires_at: new Date(Date.now() - 60_000),
    });
    const access = await getMenuAccess({ role_id: String(role._id), role_type: "staff" });
    expect(access.reports.can_view).toBe(false);
  });
});
