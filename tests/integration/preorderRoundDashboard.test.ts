import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import preorderItemModel from "@/models/preorderItemModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { GET as dashboardGET } from "@/app/api/admin/preorder-rounds/dashboard/route";
import { GET as customersGET } from "@/app/api/admin/preorder-rounds/[id]/customers/route";
import { makeUser, makeProduct, makePreorder } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * สรุปรอบพรีออเดอร์ + รายชื่อลูกค้าในรอบ (frontend Q-BE5 · F4 · Q-OWN3)
 *   GET /api/admin/preorder-rounds/dashboard · GET /api/admin/preorder-rounds/:id/customers
 */

async function sessionFor(roleType: "owner" | "staff") {
  const role = await roleModel.create({ role_name: `${roleType}-${Math.random()}`, role_type: roleType });
  const user = await makeUser({ role_id: role._id });
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

const req = (url: string, s: SessionUser) =>
  new NextRequest(`http://localhost:3000${url}`, { headers: { [USER_HEADER]: JSON.stringify(s) } });

async function dashboard(s: SessionUser, qs = "") {
  const res = await dashboardGET(req(`/api/admin/preorder-rounds/dashboard${qs}`, s));
  return { status: res.status, body: await res.json() };
}

async function customers(s: SessionUser, id: unknown, qs = "") {
  const res = await customersGET(req(`/api/admin/preorder-rounds/${id}/customers${qs}`, s), {
    params: Promise.resolve({ id: String(id) }),
  });
  return { status: res.status, body: await res.json() };
}

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

async function makeRound(name: string, status = "open", openDay = 1) {
  return preorderRoundModel.create({
    created_by: (await makeUser())._id,
    round_name: name,
    open_date: day(openDay),
    close_date: day(openDay + 5),
    pickup_date: day(openDay + 7),
    round_status: status,
  });
}

/** รอบที่มีเค้ก (จอง 3/10) + คุกกี้ (จอง 1/5) · ลูกค้า 3 คน: ชำระแล้ว · รอชำระ (ส่งตามที่อยู่) · ยกเลิก */
async function seedRound() {
  const round = await makeRound("รอบวาเลนไทน์");
  const cake = await makeProduct({ product_name_th: "เค้กช็อกโกแลต", is_preorder: true, product_id: "pre-0000001" });
  const cookie = await makeProduct({ product_name_th: "คุกกี้", is_preorder: true, product_id: "pre-0000002" });
  const cakeItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: cake._id, max_qty_total: 10, current_qty: 3 });
  const cookieItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: cookie._id, max_qty_total: 5, current_qty: 1 });

  const somchai = await makeUser({ user_fullname: "สมชาย ใจดี", user_phone: "0811111111" });
  const malee = await makeUser({ user_fullname: "มาลี มีสุข", user_phone: "0822222222" });
  const cancelled = await makeUser({ user_fullname: "ยกเลิก ไปแล้ว" });

  const paid = await makePreorder(String(somchai._id), {
    round_id: round._id, preorder_no: "PRE-PAID", order_status: "confirmed", payment_status: "paid", subtotal: 600, total_amount: 600,
    pickup_point: { point_id: cake._id, point_name: "ตลาดเช้า", address: "หน้าวัด" },
  });
  const pending = await makePreorder(String(malee._id), {
    round_id: round._id, preorder_no: "PRE-PEND", order_type: "delivery", subtotal: 200, total_amount: 250.5,
    delivery_address: {
      recipient_name: "มาลี", recipient_phone: "0822222222", house_no: "9", sub_district: "ในเมือง",
      district: "เมือง", province: "หนองคาย", zip_code: "43000",
    },
  });
  await makePreorder(String(cancelled._id), {
    round_id: round._id, preorder_no: "PRE-CANC", order_status: "cancelled", payment_status: "paid", total_amount: 400,
  });

  const line = (preorderId: unknown, roundItem: any, product: any, qty: number, price: number, extra: Record<string, unknown> = {}) =>
    preorderItemModel.create({
      preorder_id: preorderId, round_item_id: roundItem._id, product_id: product._id,
      product_snapshot: { product_name_th: product.product_name_th, product_name_eng: "x" },
      pickup_date: day(8), quantity: qty, unit_price: price, total_price: qty * price, ...extra,
    });
  await line(paid._id, cakeItem, cake, 3, 200, {
    selected_variants: [{ group_name: "ขนาด", variant_name: "2 ปอนด์" }],
    selected_options: [{ option_name: "ข้อความบนเค้ก", text_value: "HBD" }],
  });
  await line(pending._id, cookieItem, cookie, 1, 200);
  return { round };
}

describe("GET /api/admin/preorder-rounds/dashboard", () => {
  it("สรุปต่อรอบ: จอง/โควตา (รวม + ต่อสินค้า) · ยอดแยกสถานะชำระเงิน · ยอดขายไม่รวมยกเลิก", async () => {
    const { round } = await seedRound();
    const { status, body } = await dashboard(await sessionFor("owner"));
    expect(status).toBe(200);
    const r = body.data.items.find((x: any) => x._id === String(round._id));
    expect(r).toMatchObject({
      round_name: "รอบวาเลนไทน์",
      product_count: 2,
      total_quota: 15,
      total_ordered_qty: 4,
      fill_rate: 27,
      total_orders: 3,
      customer_count: 2,
      total_revenue: 850.5,
      payment: { paid: { count: 1, amount: 600 }, pending: { count: 1, amount: 250.5 }, cancelled: { count: 1, amount: 400 } },
    });
    expect(r.products).toEqual([
      expect.objectContaining({ product_name_th: "เค้กช็อกโกแลต", ordered_qty: 3, quota: 10 }),
      expect.objectContaining({ product_name_th: "คุกกี้", ordered_qty: 1, quota: 5 }),
    ]);
  });

  it("รอบที่ยังไม่มีสินค้า/พรีออเดอร์ = ศูนย์ทั้งหมด · กรองสถานะ · เรียงรอบล่าสุดก่อน · ไม่รวมรอบที่ลบ", async () => {
    await makeRound("รอบเก่า", "closed", 1);
    await makeRound("รอบใหม่", "open", 10);
    const removed = await makeRound("รอบที่ลบ", "open", 12);
    await preorderRoundModel.updateOne({ _id: removed._id }, { deleted_at: new Date() });
    const owner = await sessionFor("owner");

    const all = (await dashboard(owner)).body.data;
    expect(all.items.map((r: any) => r.round_name)).toEqual(["รอบใหม่", "รอบเก่า"]);
    expect(all.items[0]).toMatchObject({ product_count: 0, fill_rate: 0, total_orders: 0, total_revenue: 0 });
    expect((await dashboard(owner, "?status=closed")).body.data.items.map((r: any) => r.round_name)).toEqual(["รอบเก่า"]);
    expect((await dashboard(owner, "?status=bogus")).status).toBe(400);
  });

  it("พนักงานไม่มีสิทธิ์ preorder → 403", async () => {
    expect((await dashboard(await sessionFor("staff"))).status).toBe(403);
  });
});

describe("GET /api/admin/preorder-rounds/:id/customers", () => {
  it("รายชื่อจัดกลุ่มตามลูกค้า · รายการ + ตัวเลือก · วิธีรับ · สถานะ · ยอดไม่รวมยกเลิก", async () => {
    const { round } = await seedRound();
    const { status, body } = await customers(await sessionFor("owner"), round._id);
    expect(status).toBe(200);
    const data = body.data;
    expect(data).toMatchObject({ round: { round_name: "รอบวาเลนไทน์" }, total_customers: 3, total_orders: 3 });

    const somchai = data.customers.find((c: any) => c.user_fullname === "สมชาย ใจดี");
    expect(somchai).toMatchObject({ user_phone: "0811111111", order_count: 1, total_spent: 600 });
    expect(somchai.orders[0]).toMatchObject({
      preorder_no: "PRE-PAID", order_type: "takeaway", payment_group: "paid",
      pickup_point: { point_name: "ตลาดเช้า", address: "หน้าวัด" },
    });
    expect(somchai.orders[0].items[0]).toMatchObject({
      product_name_th: "เค้กช็อกโกแลต", quantity: 3, total_price: 600,
      selected_variants: [{ group_name: "ขนาด", variant_name: "2 ปอนด์" }],
      selected_options: [{ option_name: "ข้อความบนเค้ก", text_value: "HBD" }],
    });

    const malee = data.customers.find((c: any) => c.user_fullname === "มาลี มีสุข");
    expect(malee.orders[0]).toMatchObject({ order_type: "delivery", payment_group: "pending", delivery_address: { province: "หนองคาย" } });

    const gone = data.customers.find((c: any) => c.user_fullname === "ยกเลิก ไปแล้ว");
    expect(gone).toMatchObject({ order_count: 1, total_spent: 0 });
    expect(gone.orders[0].payment_group).toBe("cancelled");
  });

  it("กรอง payment / order_type · ค้นหาชื่อ เบอร์ เลขพรีออเดอร์ · ค่าผิด → 400", async () => {
    const { round } = await seedRound();
    const owner = await sessionFor("owner");
    const names = async (qs: string) =>
      (await customers(owner, round._id, qs)).body.data.customers.map((c: any) => c.user_fullname).sort();

    expect(await names("?payment=paid")).toEqual(["สมชาย ใจดี"]);
    expect(await names("?payment=pending")).toEqual(["มาลี มีสุข"]);
    expect(await names("?payment=cancelled")).toEqual(["ยกเลิก ไปแล้ว"]);
    expect(await names("?order_type=delivery")).toEqual(["มาลี มีสุข"]);
    expect(await names("?search=สมชาย")).toEqual(["สมชาย ใจดี"]);
    expect(await names("?search=0822")).toEqual(["มาลี มีสุข"]);
    expect(await names("?search=pre-canc")).toEqual(["ยกเลิก ไปแล้ว"]);
    expect((await customers(owner, round._id, "?payment=refunded")).status).toBe(400);
    expect((await customers(owner, round._id, "?order_type=pickup")).status).toBe(400);
  });

  it("รอบที่ไม่มี → 404 · id ผิดรูปแบบ → 400 · พนักงานไม่มีสิทธิ์ → 403", async () => {
    const { round } = await seedRound();
    const owner = await sessionFor("owner");
    expect((await customers(owner, "6501f0f0f0f0f0f0f0f0f0f0")).status).toBe(404);
    expect((await customers(owner, "abc")).status).toBe(400);
    expect((await customers(await sessionFor("staff"), round._id)).status).toBe(403);
  });
});
