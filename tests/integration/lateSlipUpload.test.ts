import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import productModel from "@/models/productModel";
import orderModel from "@/models/orderModel";
import paymentModel from "@/models/paymentModel";
import roleModel from "@/models/roleModel";
import { USER_HEADER } from "@/lib/session";
import * as orderService from "@/services/orderService";
import { makeUser, makeProduct } from "./helpers";

/**
 * TC-CUS-85 — ออเดอร์เว็บถูกยกเลิกเพราะหมดเวลาชำระ โดยลูกค้ายังไม่เคยสร้างรายการชำระเงิน
 * → POST /api/shop/payments แบบ multipart (ไฟล์สลิป + order_id + amount) สร้างรายการพร้อมสลิปและเปิดออเดอร์กลับในคำขอเดียว
 * (เดิมต้องมี slip_image_url ที่อัปโหลดไว้แล้ว แต่ลูกค้าไม่มีทางอัปโหลดสลิปโดยไม่มีรายการชำระเงิน)
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const MIN = 60 * 1000;

let privateDir: string;
let POST: (req: NextRequest, ctx?: unknown) => Promise<Response>;
const ORIGINAL = process.env.PRIVATE_UPLOAD_DIR;

beforeAll(async () => {
  privateDir = mkdtempSync(join(tmpdir(), "late-slips-"));
  process.env.PRIVATE_UPLOAD_DIR = privateDir;
  POST = (await import("@/app/api/shop/payments/route")).POST as typeof POST;
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.PRIVATE_UPLOAD_DIR;
  else process.env.PRIVATE_UPLOAD_DIR = ORIGINAL;
  rmSync(privateDir, { recursive: true, force: true });
});

const stock = async (id: unknown) =>
  (await productModel.findById(id).lean<{ product_stock_quantity: number }>())!.product_stock_quantity;

async function expiredOrder(qty = 2, stockQty = 10) {
  const user = await makeUser();
  // authGuard ตรวจ role กับ DB — makeUser() ใส่ role_id สุ่มที่ไม่มีจริง
  await roleModel.updateOne(
    { _id: user.role_id },
    { $setOnInsert: { role_name: `customer-${String(user.role_id)}`, role_type: "customer", is_active: true } },
    { upsert: true }
  );
  const p = await makeProduct({ product_price: 100, product_stock_quantity: stockQty });
  const order = (await orderService.createOrder(String(user._id), {
    order_type: "takeaway",
    items: [{ product_id: String(p._id), quantity: qty }],
    storefront: true,
  })) as { _id: unknown; total_amount: number };
  await orderService.expireUnpaidOrders({ now: new Date(Date.now() + 31 * MIN) });
  const session = { user_id: String(user._id), role_id: String(user.role_id), role_type: "customer", email: "x@y.z" };
  return { user, p, order, session };
}

function postSlip(session: object, fields: Record<string, string>) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(PNG_1X1)], "slip.png", { type: "image/png" }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return POST(
    new NextRequest("http://localhost:3000/api/shop/payments", {
      method: "POST",
      body: form,
      headers: { [USER_HEADER]: JSON.stringify(session) },
    })
  );
}

const slipFiles = () => readdirSync(privateDir, { recursive: true }).filter((f) => String(f).endsWith(".png"));

describe("POST /api/shop/payments (multipart) — แนบสลิปเปิดออเดอร์ที่หมดเวลากลับ (TC-CUS-85)", () => {
  it("ยังไม่เคยมีรายการชำระเงิน → สร้างรายการพร้อมสลิป · ออเดอร์กลับเป็น pending · ตัดสต็อกใหม่", async () => {
    const { p, order, session } = await expiredOrder(2, 10);
    expect((await orderModel.findById(order._id).lean<{ order_status: string }>())!.order_status).toBe("cancelled");
    expect(await stock(p._id)).toBe(10);

    const res = await postSlip(session, { order_id: String(order._id), amount: String(order.total_amount) });
    expect(res.status).toBe(201);

    const payment = await paymentModel.findOne({ order_id: order._id }).lean<{ status: string; slip_image_url: string }>();
    expect(payment!.status).toBe("pending");
    expect(payment!.slip_image_url).toMatch(/^\/api\/files\/slips\//);
    const reopened = await orderModel.findById(order._id).lean<{ order_status: string; cancelled_reason: unknown }>();
    expect(reopened!.order_status).toBe("pending");
    expect(reopened!.cancelled_reason).toBeNull();
    expect(await stock(p._id)).toBe(8);
  });

  it("ของหมดระหว่างนั้น → 409 · ไม่สร้างรายการ · ลบไฟล์สลิปที่เพิ่งอัปโหลด", async () => {
    const { p, order, session } = await expiredOrder(2, 2);
    await productModel.updateOne({ _id: p._id }, { $set: { product_stock_quantity: 1 } });
    const before = slipFiles().length;

    const res = await postSlip(session, { order_id: String(order._id), amount: String(order.total_amount) });
    expect(res.status).toBe(409);
    expect(await paymentModel.countDocuments({ order_id: order._id })).toBe(0);
    expect((await orderModel.findById(order._id).lean<{ order_status: string }>())!.order_status).toBe("cancelled");
    expect(slipFiles().length).toBe(before);
  });

  it("ออเดอร์ของคนอื่น / ไม่ระบุยอด → 400 ไม่สร้างรายการ", async () => {
    const a = await expiredOrder();
    const b = await expiredOrder();
    expect((await postSlip(b.session, { order_id: String(a.order._id), amount: String(a.order.total_amount) })).status).toBe(400);
    expect((await postSlip(a.session, { order_id: String(a.order._id) })).status).toBe(400);
    expect(await paymentModel.countDocuments({ order_id: a.order._id })).toBe(0);
  });
});
