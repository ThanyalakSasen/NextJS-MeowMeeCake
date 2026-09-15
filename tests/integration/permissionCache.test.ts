import { describe, it, expect, beforeAll } from "vitest";
import roleModel from "@/models/roleModel";
import permissionModel from "@/models/permissionModel";
import { makeUser } from "./helpers";

/**
 * BACKLOG3 §7 — permissionService.getEffectivePermissions() เดิมไม่มี cache เลย ยิง query ทุก request
 * ที่ผ่าน authGuard.requirePermission() (แทบทุก mutation ของ /api/admin/*) เพิ่ม TTL cache แบบเดียวกับ
 * deliveryZoneService.ts แต่ keyed ด้วย role_id + invalidate ทันทีทุกจุดที่เขียน permission
 *
 * เทสไฟล์นี้ตั้งใจ override PERMISSION_CACHE_TTL_MS เป็นค่าจริง (ไฟล์อื่นปิด cache ไว้ผ่าน
 * vitest.config.mts เพื่อกัน state รั่วข้ามเทส) เพราะเป็นจุดเดียวที่ต้องพิสูจน์ว่า cache "ทำงานจริง"
 * ไม่ใช่แค่โค้ดที่ไม่เคยถูกเรียกถึง — ต้อง dynamic import หลัง set env (module อ่าน env ตอน load ครั้งแรก)
 */
describe("permissionService.getEffectivePermissions — TTL cache + invalidation (BACKLOG3 §7)", () => {
  let permissionService: typeof import("@/services/permissionService");

  beforeAll(async () => {
    process.env.PERMISSION_CACHE_TTL_MS = "60000";
    permissionService = await import("@/services/permissionService");
  });

  async function makeStaffRole() {
    return roleModel.create({ role_name: `staff-${Date.now()}-${Math.random()}`, role_type: "staff" });
  }

  it("cache ทำงานจริง: เขียนตรงผ่าน model (ข้าม service, ไม่ invalidate) แล้ว query ซ้ำภายใน TTL ยังเห็นค่าเก่าค้างอยู่", async () => {
    const role = await makeStaffRole();
    const admin = await makeUser();
    await permissionService.createPermission({
      role_id: String(role._id),
      menu_key: "orders",
      granted_by: String(admin._id),
      can_view: true,
    });

    const first = await permissionService.getEffectivePermissions(String(role._id));
    expect(first.permissions.orders?.can_view).toBe(true);

    // เขียนตรงผ่าน model ข้าม service เลย (ไม่มีทาง invalidate cache ได้) — จำลองว่า cache ยังไม่หมดอายุ
    await permissionModel.updateOne(
      { role_id: role._id, menu_key: "orders" },
      { $set: { can_view: false } }
    );

    const second = await permissionService.getEffectivePermissions(String(role._id));
    expect(second.permissions.orders?.can_view).toBe(true); // ยังเป็นค่าเก่าจาก cache ไม่ใช่ false ที่เพิ่งเขียนตรง
  });

  it("createPermission → invalidate cache ทันที เห็นสิทธิ์ใหม่โดยไม่ต้องรอ TTL หมดอายุ", async () => {
    const role = await makeStaffRole();
    const admin = await makeUser();

    const before = await permissionService.getEffectivePermissions(String(role._id));
    expect(before.permissions.orders).toBeUndefined();

    await permissionService.createPermission({
      role_id: String(role._id),
      menu_key: "orders",
      granted_by: String(admin._id),
      can_view: true,
    });

    const after = await permissionService.getEffectivePermissions(String(role._id));
    expect(after.permissions.orders?.can_view).toBe(true);
  });

  it("updatePermission → invalidate cache ทันที", async () => {
    const role = await makeStaffRole();
    const admin = await makeUser();
    const perm = await permissionService.createPermission({
      role_id: String(role._id),
      menu_key: "orders",
      granted_by: String(admin._id),
      can_view: true,
      can_update: false,
    });

    await permissionService.getEffectivePermissions(String(role._id)); // ทำให้ cache

    await permissionService.updatePermission(String((perm as { _id: unknown })._id), {
      can_update: true,
    });

    const after = await permissionService.getEffectivePermissions(String(role._id));
    expect(after.permissions.orders?.can_update).toBe(true);
  });

  it("deletePermission (soft) → invalidate cache ทันที สิทธิ์หายจาก effective permissions", async () => {
    const role = await makeStaffRole();
    const admin = await makeUser();
    const perm = await permissionService.createPermission({
      role_id: String(role._id),
      menu_key: "orders",
      granted_by: String(admin._id),
      can_view: true,
    });

    await permissionService.getEffectivePermissions(String(role._id)); // ทำให้ cache

    await permissionService.deletePermission(String((perm as { _id: unknown })._id));

    const after = await permissionService.getEffectivePermissions(String(role._id));
    expect(after.permissions.orders).toBeUndefined();
  });

  it("restorePermission → invalidate cache ทันที สิทธิ์กลับมาเห็นทันที", async () => {
    const role = await makeStaffRole();
    const admin = await makeUser();
    const perm = await permissionService.createPermission({
      role_id: String(role._id),
      menu_key: "orders",
      granted_by: String(admin._id),
      can_view: true,
    });
    await permissionService.deletePermission(String((perm as { _id: unknown })._id));
    await permissionService.getEffectivePermissions(String(role._id)); // ทำให้ cache (ตอนนี้ไม่เห็นสิทธิ์)

    await permissionService.restorePermission(String((perm as { _id: unknown })._id));

    const after = await permissionService.getEffectivePermissions(String(role._id));
    expect(after.permissions.orders?.can_view).toBe(true);
  });

  it("cache แยกกันตาม role_id — แก้สิทธิ์ role หนึ่งไม่กระทบ cache ของอีก role", async () => {
    const roleA = await makeStaffRole();
    const roleB = await makeStaffRole();
    const admin = await makeUser();

    await permissionService.createPermission({
      role_id: String(roleB._id),
      menu_key: "orders",
      granted_by: String(admin._id),
      can_view: true,
    });
    const b = await permissionService.getEffectivePermissions(String(roleB._id));
    expect(b.permissions.orders?.can_view).toBe(true);

    const a = await permissionService.getEffectivePermissions(String(roleA._id));
    expect(a.permissions.orders).toBeUndefined();
  });
});
