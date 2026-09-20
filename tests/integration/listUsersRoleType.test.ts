import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import { listUsers } from "@/services/userService";
import { makeUser } from "./helpers";

/**
 * listUsers({ role_type }) — หน้าจัดการพนักงานต้องได้เฉพาะ owner + staff (ไม่มีลูกค้า)
 * ผู้ใช้ไม่ได้เก็บ role_type เอง ต้องอ้างผ่านบทบาท (role_id) — เทสจึงสร้างบทบาทครบ 3 ประเภท
 */
describe("userService.listUsers — กรองตาม role_type", () => {
  const pagination = { page: 1, limit: 100, skip: 0 };
  // items ของ listUsers เป็น lean doc (populate role_id) — ระบุ shape เท่าที่เทสใช้แทน any
  type Listed = { _id: unknown; role_id: { role_type: string } };
  const rows = (r: { items: unknown[] }) => r.items as Listed[];
  const idsOf = (r: { items: unknown[] }) => rows(r).map((u) => String(u._id));
  const mk = (role_type: "owner" | "staff" | "customer", extra: Record<string, unknown> = {}) =>
    roleModel.create({ role_name: `${role_type}-${Date.now()}-${Math.random()}`, role_type, ...extra });

  it("role_type=owner,staff → ได้เฉพาะเจ้าของ/พนักงาน ไม่มีลูกค้า และ total ตรงกับที่กรอง", async () => {
    const owner = await mk("owner"), staff = await mk("staff"), customer = await mk("customer");
    const uOwner = await makeUser({ role_id: owner._id, user_fullname: "RT-owner" });
    const uStaff = await makeUser({ role_id: staff._id, user_fullname: "RT-staff" });
    const uCustomer = await makeUser({ role_id: customer._id, user_fullname: "RT-customer" });

    const r = await listUsers({ pagination, role_type: ["owner", "staff"], search: "RT-" });
    const ids = idsOf(r);

    expect(ids).toContain(String(uOwner._id));
    expect(ids).toContain(String(uStaff._id));
    expect(ids).not.toContain(String(uCustomer._id));
    expect(r.meta.total).toBe(2);
    expect(rows(r).every((u) => ["owner", "staff"].includes(u.role_id.role_type))).toBe(true);
  });

  it("กรองก่อน paginate: ลูกค้าจำนวนมากไม่ดันพนักงานตกหน้า (limit 2 ยังได้พนักงานครบ)", async () => {
    const staff = await mk("staff"), customer = await mk("customer");
    for (let i = 0; i < 5; i++) await makeUser({ role_id: customer._id, user_fullname: `PG-cust-${i}` });
    const s = await makeUser({ role_id: staff._id, user_fullname: "PG-staff" });

    const r = await listUsers({ pagination: { page: 1, limit: 2, skip: 0 }, role_type: ["owner", "staff"], search: "PG-", sort: { created_at: 1 } });

    expect(idsOf(r)).toEqual([String(s._id)]);
    expect(r.meta.total).toBe(1);
  });

  it("ระบุทั้ง role_id และ role_type: ต้องเข้าเงื่อนไขทั้งคู่ (role_id ของลูกค้า + role_type=staff → ว่าง)", async () => {
    const staff = await mk("staff"), customer = await mk("customer");
    await makeUser({ role_id: customer._id, user_fullname: "BOTH-cust" });
    const s = await makeUser({ role_id: staff._id, user_fullname: "BOTH-staff" });

    const wrong = await listUsers({ pagination, role_id: String(customer._id), role_type: ["staff"] });
    expect(wrong.items).toHaveLength(0);
    expect(wrong.meta.total).toBe(0);

    const right = await listUsers({ pagination, role_id: String(staff._id), role_type: ["staff"] });
    expect(idsOf(right)).toEqual([String(s._id)]);
  });

  it("บทบาทที่ถูกลบแบบ soft delete: ผู้ใช้ของบทบาทนั้นยังอยู่ในรายการ (ไม่หายเงียบ ๆ)", async () => {
    const staff = await mk("staff", { deleted_at: new Date() });
    const u = await makeUser({ role_id: staff._id, user_fullname: "SD-staff" });
    const r = await listUsers({ pagination, role_type: ["staff"], search: "SD-" });
    expect(idsOf(r)).toEqual([String(u._id)]);
  });

  it("ไม่ส่ง role_type → พฤติกรรมเดิม (ได้ทุกประเภท รวมลูกค้า)", async () => {
    const customer = await mk("customer");
    const u = await makeUser({ role_id: customer._id, user_fullname: "ALL-cust" });
    const r = await listUsers({ pagination, search: "ALL-" });
    expect(idsOf(r)).toEqual([String(u._id)]);
  });
});
