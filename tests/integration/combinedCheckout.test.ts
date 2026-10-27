import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import preorderModel from "@/models/preorderModel";
import paymentModel from "@/models/paymentModel";
import * as cartService from "@/services/cartService";
import * as checkoutService from "@/services/checkoutService";
import * as paymentGroupService from "@/services/paymentGroupService";
import * as paymentService from "@/services/paymentService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { checkoutBody } from "@/schemas/checkout";
import { flushBackground } from "@/lib/backgroundTasks";
import { makeUser, makeProduct } from "./helpers";

/**
 * ตะกร้ารวม (2026-10-27) — POST /api/shop/checkout สร้างหลายบิลในครั้งเดียว + ชำระรวมด้วยสลิปเดียว
 * services/checkoutService · services/paymentGroupService · paymentService.verifyPayment (ยืนยันทั้งกลุ่ม)
 */

const DAY = 24 * 60 * 60 * 1000;
const SLIP = "/api/files/slips/group-test.jpg";

async function preorderProduct() {
  return makeProduct({
    is_preorder: true,
    product_stock_quantity: null,
    product_price: 100,
    preorder_config: { min_order_qty: 1, max_order_qty: 10, lead_time_days: 1 },
  });
}

async function openRound(product: { _id: unknown }, maxQty = 50) {
  const admin = await makeUser();
  const close = Date.now() + DAY;
  const round = (await preorderRoundService.createRound(
    {
      round_name: `รอบ-${Math.random()}`,
      open_date: new Date(Date.now() - 1000),
      close_date: new Date(close),
      pickup_date: new Date(close + 2 * DAY),
      items: [{ product_id: String(product._id), max_qty_total: maxQty }],
    },
    String(admin._id)
  )) as { _id: unknown; items: Array<{ _id: unknown }> };
  return { round_id: String(round._id), round_item_id: String(round.items[0]._id) };
}

async function setup() {
  const user = await makeUser();
  const uid = String(user._id);
  const normal = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
  await cartService.addItem(uid, { product_id: String(normal._id), quantity: 2 });
  const r1 = await openRound(await preorderProduct());
  const r2 = await openRound(await preorderProduct(), 3);
  const preorder = (r: { round_id: string; round_item_id: string }, quantity = 1) => ({
    round_id: r.round_id,
    order_type: "takeaway" as const,
    items: [{ round_item_id: r.round_item_id, quantity, selected_options: [] }],
  });
  return { uid, normal, r1, r2, preorder };
}

const body = (raw: unknown) => checkoutBody.parse(raw);

describe("สั่งซื้อรวม (checkoutService.checkout)", () => {
  it("สินค้าปกติ + พรีออเดอร์ 2 รอบ → 3 บิล + กลุ่มชำระรวม · ตะกร้าว่าง · ยอดรวม = ผลรวมทุกบิล", async () => {
    const { uid, r1, r2, preorder } = await setup();
    const res = await checkoutService.checkout(
      uid,
      body({ order: { order_type: "takeaway" }, preorders: [preorder(r1, 2), preorder(r2, 1)] })
    );
    expect(res.bills.map((b) => b.kind)).toEqual(["order", "preorder", "preorder"]);
    expect(res.group_id).toBeTruthy();
    expect((await cartService.getCartDetail(uid)).items).toHaveLength(0);

    const page = await paymentGroupService.getGroupPaymentPage(res.group_id!, uid);
    expect(page.total_amount).toBe(100 + 200 + 100);
    expect(page).toMatchObject({ status: "awaiting_payment", can_pay_together: true });
    expect(page.bills).toHaveLength(3);
    // หน้าชำระรายบิลรู้ว่าอยู่ในกลุ่มไหน
    expect((await paymentService.getPaymentPage("order", res.bills[0]._id, uid)).group_id).toBe(res.group_id);
  });

  it("บิลเดียว → ไม่สร้างกลุ่ม", async () => {
    const { uid } = await setup();
    const res = await checkoutService.checkout(uid, body({ order: { order_type: "takeaway" } }));
    expect(res.group_id).toBeNull();
    expect(res.bills).toHaveLength(1);
  });

  it("พรีออเดอร์ใบที่สองไม่ผ่าน (เกินโควตา) → ยกเลิกใบแรก · ไม่สร้างออเดอร์ · ตะกร้ายังอยู่", async () => {
    const { uid, r1, r2, preorder } = await setup();
    await expect(
      checkoutService.checkout(uid, body({ order: { order_type: "takeaway" }, preorders: [preorder(r1, 1), preorder(r2, 5)] }))
    ).rejects.toMatchObject({ status: expect.any(Number) });

    const pres = await preorderModel.find({ user_id: uid }).lean<{ order_status: string }[]>();
    expect(pres).toHaveLength(1);
    expect(pres[0].order_status).toBe("cancelled");
    expect(await orderModel.countDocuments({ user_id: uid })).toBe(0);
    expect((await cartService.getCartDetail(uid)).items).toHaveLength(1);
  });

  it("ออเดอร์จากตะกร้าไม่ผ่าน (ตะกร้าว่าง) → ยกเลิกพรีออเดอร์ที่สร้างไปแล้ว", async () => {
    const { uid, r1, preorder } = await setup();
    await cartService.clearCart(uid);
    await expect(
      checkoutService.checkout(uid, body({ order: { order_type: "takeaway" }, preorders: [preorder(r1, 1)] }))
    ).rejects.toBeTruthy();
    const pre = await preorderModel.findOne({ user_id: uid }).lean<{ order_status: string }>();
    expect(pre!.order_status).toBe("cancelled");
  });

  it("schema: คูปอง/โค้ดได้บิลเดียว · รอบซ้ำ · ไม่มีบิล → ไม่ผ่าน", () => {
    const pre = (round_id: string, extra: object = {}) => ({
      round_id,
      order_type: "takeaway",
      items: [{ round_item_id: "6a0000000000000000000001", quantity: 1 }],
      ...extra,
    });
    const R1 = "6a0000000000000000000011";
    const R2 = "6a0000000000000000000012";
    expect(checkoutBody.safeParse({}).success).toBe(false);
    expect(checkoutBody.safeParse({ preorders: [pre(R1), pre(R1)] }).success).toBe(false);
    expect(
      checkoutBody.safeParse({
        order: { order_type: "takeaway", promotion_code: "SAVE" },
        preorders: [pre(R1, { user_coupon_id: "6a0000000000000000000099" })],
      }).success
    ).toBe(false);
    expect(checkoutBody.safeParse({ order: { order_type: "takeaway", promotion_code: "SAVE" }, preorders: [pre(R1), pre(R2)] }).success).toBe(true);
  });
});

describe("ชำระรวม (paymentGroupService)", () => {
  it("สลิปเดียว → ทุกบิลได้ Payment รอตรวจ (สลิปเดียวกัน) · ยืนยันใบเดียว = ทุกบิลชำระแล้ว", async () => {
    const { uid, r1, preorder } = await setup();
    const res = await checkoutService.checkout(uid, body({ order: { order_type: "takeaway" }, preorders: [preorder(r1, 1)] }));
    await paymentGroupService.submitGroupSlip(res.group_id!, uid, SLIP);
    await flushBackground();

    const payments = await paymentModel.find({ group_id: res.group_id }).lean<{ status: string; slip_image_url: string; amount: number }[]>();
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.status === "pending" && p.slip_image_url === SLIP)).toBe(true);
    expect((await paymentGroupService.getGroupPaymentPage(res.group_id!, uid)).status).toBe("awaiting_review");
    // ส่งซ้ำระหว่างรอตรวจ = 409
    await expect(paymentGroupService.submitGroupSlip(res.group_id!, uid, SLIP)).rejects.toMatchObject({ status: 409 });

    // หลังร้านเห็นว่าสลิปนี้ครอบคลุมบิลไหน + ยอดรวม
    const list = await paymentService.listPayments({ pagination: { page: 1, limit: 20, skip: 0 }, order_id: res.bills[0]._id });
    expect((list.items[0] as { group: { bill_count: number; total_amount: number } }).group).toMatchObject({ bill_count: 2, total_amount: 200 });

    const admin = await makeUser();
    const first = (await paymentModel.findOne({ order_id: res.bills[0]._id }).lean<{ _id: unknown }>())!;
    await paymentService.verifyPayment(String(first._id), { verified_by: String(admin._id), approved: true });

    expect((await orderModel.findById(res.bills[0]._id).lean<{ payment_status: string }>())!.payment_status).toBe("paid");
    expect((await preorderModel.findById(res.bills[1]._id).lean<{ payment_status: string }>())!.payment_status).toBe("paid");
    expect((await paymentGroupService.getGroupPaymentPage(res.group_id!, uid)).status).toBe("paid");
  });

  it("ปฏิเสธใบเดียว = ทุกบิลถูกปฏิเสธ → ส่งสลิปรวมใหม่ได้ (แนบกับใบเดิม)", async () => {
    const { uid, r1, preorder } = await setup();
    const res = await checkoutService.checkout(uid, body({ order: { order_type: "takeaway" }, preorders: [preorder(r1, 1)] }));
    await paymentGroupService.submitGroupSlip(res.group_id!, uid, SLIP);
    const admin = await makeUser();
    const pre = (await paymentModel.findOne({ preorder_id: res.bills[1]._id }).lean<{ _id: unknown }>())!;
    await paymentService.verifyPayment(String(pre._id), { verified_by: String(admin._id), approved: false });
    expect(await paymentModel.countDocuments({ group_id: res.group_id, status: "failed" })).toBe(2);

    await paymentGroupService.submitGroupSlip(res.group_id!, uid, "/api/files/slips/group-test-2.jpg");
    expect(await paymentModel.countDocuments({ group_id: res.group_id })).toBe(2); // ใช้ใบเดิม ไม่สร้างใหม่
    expect(await paymentModel.countDocuments({ group_id: res.group_id, status: "pending" })).toBe(2);
  });

  it("มีบิลถูกยกเลิก → ชำระรวมไม่ได้ (split) · ของคนอื่น = 404", async () => {
    const { uid, r1, preorder } = await setup();
    const res = await checkoutService.checkout(uid, body({ order: { order_type: "takeaway" }, preorders: [preorder(r1, 1)] }));
    await preorderService.cancelPreorder(res.bills[1]._id, { cancelled_by: uid });
    const page = await paymentGroupService.getGroupPaymentPage(res.group_id!, uid);
    expect(page).toMatchObject({ status: "split", can_pay_together: false, qr_image: null });
    await expect(paymentGroupService.submitGroupSlip(res.group_id!, uid, SLIP)).rejects.toMatchObject({ status: 409 });

    const other = await makeUser();
    await expect(paymentGroupService.getGroupPaymentPage(res.group_id!, String(other._id))).rejects.toMatchObject({ status: 404 });
  });
});

describe("เลือกสั่งบางรายการในตะกร้า (cart_item_ids)", () => {
  it("สั่งเฉพาะที่เลือก · ที่ไม่ได้เลือกยังอยู่ในตะกร้า · id ที่ไม่มีในตะกร้า = 400", async () => {
    const { uid, normal } = await setup();
    const other = await makeProduct({ product_price: 30, product_stock_quantity: 10 });
    await cartService.addItem(uid, { product_id: String(other._id), quantity: 1 });
    const cart = await cartService.getCartDetail(uid);
    const pick = (cart.items as Array<{ _id: unknown; product_id: { _id: unknown } }>).find((it) => String(it.product_id._id) === String(normal._id))!;

    const res = await checkoutService.checkout(uid, body({ order: { order_type: "takeaway", cart_item_ids: [String(pick._id)] } }));
    expect(res.bills[0].total_amount).toBe(100);
    const left = (await cartService.getCartDetail(uid)).items as Array<{ product_id: { _id: unknown } }>;
    expect(left.map((it) => String(it.product_id._id))).toEqual([String(other._id)]);

    await expect(
      checkoutService.checkout(uid, body({ order: { order_type: "takeaway", cart_item_ids: ["6a0000000000000000000abc"] } }))
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("รวมค่าส่ง — ที่อยู่เดียวกัน วันรับห่างไม่เกิน 7 วัน เก็บค่าส่งครั้งเดียว", () => {
  const A = { house_no: "74 หมู่1", sub_district: "หนองแวง", district: "บ้านใหม่", province: "เชียงใหม่", zip_code: "50000" };
  const B = { ...A, house_no: "99" };

  it("combinedShippingWaivers: บิลแรก (รับเร็วสุด) เก็บ · ภายใน 7 วันไม่เก็บ · เกิน 7 วัน = กลุ่มใหม่ · คนละที่อยู่ = แยกกัน", () => {
    const w = checkoutService.combinedShippingWaivers([
      { key: "order", address: A, date: "2026-11-01" },
      { key: "r1", address: { ...A, house_no: " 74  หมู่1 " }, date: "2026-11-08" }, // ห่าง 7 วันพอดี + เว้นวรรคต่างกัน = ที่เดียวกัน
      { key: "r2", address: A, date: "2026-11-09" }, // ห่าง 8 วัน → เก็บใหม่
      { key: "r3", address: A, date: "2026-11-12" }, // ห่างจาก r2 3 วัน → ไม่เก็บ
      { key: "r4", address: B, date: "2026-11-01" }, // คนละที่อยู่ → เก็บ
    ]);
    expect([...w].sort()).toEqual(["r1", "r3"]);
  });

  it("ลำดับที่ส่งมาไม่มีผล — วันรับเร็วสุดเป็นบิลที่เก็บ · วันเดียวกัน = ใบแรกที่ส่งมา", () => {
    expect([...checkoutService.combinedShippingWaivers([
      { key: "late", address: A, date: "2026-11-05" },
      { key: "early", address: A, date: "2026-11-02" },
    ])]).toEqual(["late"]);
    expect([...checkoutService.combinedShippingWaivers([
      { key: "order", address: A, date: "2026-11-02" },
      { key: "r1", address: A, date: "2026-11-02" },
    ])]).toEqual(["r1"]);
  });

  it("checkout: สินค้าปกติ + พรีออเดอร์ (รับใน 3 วัน) จัดส่งที่เดียวกัน → ค่าส่งเฉพาะบิลสินค้าปกติ", async () => {
    const { uid, r1 } = await setup();
    const address = { recipient_name: "ทดสอบ", recipient_phone: "0812345678", ...A };
    const res = await checkoutService.checkout(
      uid,
      body({
        order: { order_type: "delivery", delivery_address: address },
        preorders: [{ round_id: r1.round_id, order_type: "delivery", delivery_address: address, items: [{ round_item_id: r1.round_item_id, quantity: 1, selected_options: [] }] }],
      })
    );
    const order = await orderModel.findById(res.bills[0]._id).lean<{ delivery_fee: number }>();
    const pre = await preorderModel.findById(res.bills[1]._id).lean<{ delivery_fee: number; total_amount: number }>();
    expect(order!.delivery_fee).toBeGreaterThan(0);
    expect(pre!.delivery_fee).toBe(0);
    expect(pre!.total_amount).toBe(100);
  });

  it("checkout: คนละที่อยู่ → เก็บค่าส่งทั้งสองบิล", async () => {
    const { uid, r1 } = await setup();
    const res = await checkoutService.checkout(
      uid,
      body({
        order: { order_type: "delivery", delivery_address: { recipient_name: "ก", recipient_phone: "0812345678", ...A } },
        preorders: [{
          round_id: r1.round_id, order_type: "delivery",
          delivery_address: { recipient_name: "ก", recipient_phone: "0812345678", ...B },
          items: [{ round_item_id: r1.round_item_id, quantity: 1, selected_options: [] }],
        }],
      })
    );
    const pre = await preorderModel.findById(res.bills[1]._id).lean<{ delivery_fee: number; total_amount: number }>();
    expect(pre!.delivery_fee).toBeGreaterThan(0);
  });
});
