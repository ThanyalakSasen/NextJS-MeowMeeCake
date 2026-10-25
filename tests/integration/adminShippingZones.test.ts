import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import * as shippingService from "@/services/shippingService";
import { GET as listGET, POST as zonePOST } from "@/app/api/admin/shipping-zones/route";
import { PATCH as zonePATCH, DELETE as zoneDELETE } from "@/app/api/admin/shipping-zones/[zone_code]/route";
import { computeShippingFee } from "@/lib/shipping";
import { makeUser } from "./helpers";

/**
 * /api/admin/shipping-zones — หลังร้านแก้โซนค่าส่งเว็บ A–D (frontend Q-BE2 · F2)
 * เดิมมีแค่ GET /catalog/shipping-zones (อ่านอย่างเดียว) — แก้ได้ทาง DB เท่านั้น
 */

async function sessionFor(roleType: "owner" | "staff", perms: { can_view?: boolean; can_update?: boolean; can_create?: boolean; can_delete?: boolean } = {}) {
  const role = await roleModel.create({ role_name: `${roleType}-${Math.random()}`, role_type: roleType });
  const user = await makeUser({ role_id: role._id });
  if (roleType === "staff" && Object.values(perms).some(Boolean)) {
    await createPermission({ role_id: String(role._id), menu_key: "shipping", granted_by: String(user._id), ...perms });
  }
  const session: SessionUser = {
    user_id: String(user._id),
    role_id: String(role._id),
    role_type: roleType,
    email: user.email,
    source: "jwt",
    auth_time: Date.now(),
  };
  return session;
}

const headers = (s: SessionUser) => ({ [USER_HEADER]: JSON.stringify(s), "content-type": "application/json" });

async function list(session: SessionUser) {
  const res = await listGET(new NextRequest("http://localhost:3000/api/admin/shipping-zones", { headers: headers(session) }));
  return { status: res.status, body: await res.json() };
}

async function patch(session: SessionUser, code: string, body: unknown) {
  const res = await zonePATCH(
    new NextRequest(`http://localhost:3000/api/admin/shipping-zones/${code}`, {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ zone_code: code }) }
  );
  return { status: res.status, body: await res.json() };
}

describe("GET /api/admin/shipping-zones", () => {
  it("owner เห็นโซน A–D (สร้างชุดเริ่มต้นให้ถ้ายังไม่มี)", async () => {
    const { status, body } = await list(await sessionFor("owner"));
    expect(status).toBe(200);
    expect(body.data.items.map((z: { zone_code: string }) => z.zone_code)).toEqual(["A", "B", "C", "D"]);
  });

  it("พนักงาน: มี store_info.view → 200 · ไม่มี → 403", async () => {
    expect((await list(await sessionFor("staff", { can_view: true }))).status).toBe(200);
    expect((await list(await sessionFor("staff"))).status).toBe(403);
  });
});

describe("PATCH /api/admin/shipping-zones/:zone_code", () => {
  it("แก้ค่าส่ง + จังหวัด + ชื่อ → ค่าส่งออเดอร์เว็บเปลี่ยนตาม", async () => {
    const owner = await sessionFor("owner");
    const res = await patch(owner, "B", { fee: 55.555, provinces: ["อุดรธานี", "เลย", "เลย"], zone_label: "Zone B — ใกล้ร้าน" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ zone_code: "B", fee: 55.56, provinces: ["อุดรธานี", "เลย"], zone_label: "Zone B — ใกล้ร้าน" });

    expect((await shippingService.quoteStorefrontDelivery({ province: "เลย", productIds: [] })).fee).toBe(55.56);
    // บึงกาฬถูกเอาออกจาก B → ตกไปโซน D
    expect((await shippingService.quoteStorefrontDelivery({ province: "บึงกาฬ", productIds: [] })).zone_code).toBe("D");
  });

  it("zone_code ตัวเล็กใช้ได้ · โซนที่ไม่มี → 404", async () => {
    const owner = await sessionFor("owner");
    expect((await patch(owner, "a", { fee: 45 })).body.data).toMatchObject({ zone_code: "A", fee: 45 });
    expect((await patch(owner, "E", { fee: 45 })).status).toBe(404);
  });

  it("จังหวัดที่ไม่อยู่ใน 77 จังหวัด → 400 · fee ติดลบ → 400 · body ว่าง → 400", async () => {
    const owner = await sessionFor("owner");
    expect((await patch(owner, "A", { provinces: ["หนองคาย", "กทม"] })).status).toBe(400);
    expect((await patch(owner, "A", { fee: -1 })).status).toBe(400);
    expect((await patch(owner, "A", {})).status).toBe(400);
  });

  it("จังหวัดซ้ำกับโซนอื่น → 409 บอกโซนเดิม · ข้อมูลไม่เปลี่ยน", async () => {
    const owner = await sessionFor("owner");
    const res = await patch(owner, "A", { provinces: ["หนองคาย", "อุดรธานี"] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("อุดรธานี (โซน B)");
    const zones = await shippingService.getShippingZones();
    expect(zones.find((z) => z.zone_code === "A")?.provinces).toEqual(["หนองคาย"]);
  });

  it("ย้ายจังหวัดข้ามโซนได้เมื่อเอาออกจากโซนเดิมก่อน", async () => {
    const owner = await sessionFor("owner");
    expect((await patch(owner, "B", { provinces: ["บึงกาฬ", "หนองบัวลำภู", "เลย"] })).status).toBe(200);
    expect((await patch(owner, "A", { provinces: ["หนองคาย", "อุดรธานี"] })).status).toBe(200);
  });

  it("โซน D ใส่จังหวัดไม่ได้ (400) แต่แก้ค่าส่งได้", async () => {
    const owner = await sessionFor("owner");
    expect((await patch(owner, "D", { provinces: ["กรุงเทพมหานคร"] })).status).toBe(400);
    expect((await patch(owner, "D", { fee: 120 })).body.data).toMatchObject({ zone_code: "D", fee: 120, provinces: [] });
  });

  it("พนักงาน: มีแค่ store_info.view → 403 · มี update → 200", async () => {
    expect((await patch(await sessionFor("staff", { can_view: true }), "A", { fee: 50 })).status).toBe(403);
    expect((await patch(await sessionFor("staff", { can_view: true, can_update: true }), "A", { fee: 50 })).status).toBe(200);
  });
});

describe("เพิ่ม/ลบโซนค่าส่ง", () => {
  async function create(session: SessionUser, body: unknown) {
    const res = await zonePOST(
      new NextRequest("http://localhost:3000/api/admin/shipping-zones", { method: "POST", headers: headers(session), body: JSON.stringify(body) })
    );
    return { status: res.status, body: await res.json() };
  }
  async function remove(session: SessionUser, code: string) {
    const res = await zoneDELETE(
      new NextRequest(`http://localhost:3000/api/admin/shipping-zones/${code}`, { method: "DELETE", headers: headers(session) }),
      { params: Promise.resolve({ zone_code: code }) }
    );
    return { status: res.status, body: await res.json() };
  }

  it("เพิ่มโซนได้รหัสถัดไป (E) · โซน D อยู่ท้ายรายการ · ค่าส่งใช้โซนใหม่ · จังหวัดซ้ำ = 409", async () => {
    const owner = await sessionFor("owner");
    const res = await create(owner, { zone_label: "ภาคกลาง", fee: 120, provinces: ["กรุงเทพมหานคร"] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ zone_code: "E", fee: 120, provinces: ["กรุงเทพมหานคร"] });
    const zones = await shippingService.getShippingZones();
    expect(zones.map((z) => z.zone_code)).toEqual(["A", "B", "C", "E", "D"]);
    expect(computeShippingFee("กรุงเทพมหานคร", zones)).toBe(120);
    expect((await create(owner, { zone_label: "ซ้ำ", fee: 10, provinces: ["หนองคาย"] })).status).toBe(409);
  });

  it("ลบโซนได้ (จังหวัดกลับไปใช้โซน D) · ลบโซน D ไม่ได้ · ไม่มีสิทธิ์ = 403", async () => {
    const owner = await sessionFor("owner");
    await create(owner, { zone_label: "ใต้", fee: 150, provinces: ["ภูเก็ต"] });
    expect((await remove(await sessionFor("staff", { can_view: true, can_update: true }), "E")).status).toBe(403);
    expect((await remove(owner, "E")).status).toBe(200);
    const zones = await shippingService.getShippingZones();
    expect(computeShippingFee("ภูเก็ต", zones)).toBe(zones.find((z) => z.zone_code === "D")!.fee);
    expect((await remove(owner, "D")).status).toBe(400);
    expect((await remove(owner, "E")).status).toBe(404);
  });
});
