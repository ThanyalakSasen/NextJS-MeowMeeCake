import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import orderModel from "@/models/orderModel";
import notificationModel from "@/models/notificationModel";
import * as orderService from "@/services/orderService";
import * as paymentService from "@/services/paymentService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import * as ingredientTransactionService from "@/services/ingredientTransactionService";
import { flushBackground } from "@/lib/backgroundTasks";
import { makeUser, makeProduct, makeIngredient } from "./helpers";

/**
 * docs/LINE.md §2 — จำลองเหตุการณ์ตั้งแต่ต้นจนจบ แล้วตรวจข้อความที่ "ยิงออกไปหา LINE จริง" (fetch spy)
 * เสริม customerLineNotify (พรีออเดอร์) / ownerLineNotify (สต็อก · POS) — ไฟล์นี้เน้นออเดอร์หน้าเว็บ/POS,
 * สลิป, วัตถุดิบ, ลิงก์หลังร้าน และกรณี LINE ล่มต้องไม่ทำให้ธุรกรรมหลักล้ม
 */

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const OWNER = "U_OWNER";

let fetchSpy: ReturnType<typeof vi.fn>;

/** ข้อความ LINE ที่ยิงหา `to` เรียงตามลำดับที่ยิง */
function pushedTo(to: string): string[] {
  return fetchSpy.mock.calls
    .filter(([url]) => url === PUSH_URL)
    .map(([, init]) => JSON.parse(init.body))
    .filter((b) => b.to === to)
    .map((b) => b.messages[0].text as string);
}

/** รองานแจ้งเตือนเบื้องหลัง (fire-and-forget) จบจริงก่อนตรวจ */
async function settled(to: string): Promise<string[]> {
  await flushBackground();
  return pushedTo(to);
}

let seq = 0;
async function customer() {
  seq++;
  const lineId = `U_CUS_${seq}_${Date.now()}`;
  const user = await makeUser({ line_user_id: lineId });
  return { user, uid: String(user._id), lineId };
}

async function placeOrder(uid: string, channel: "online" | "instore" = "online") {
  const p = await makeProduct({ product_price: 100, product_stock_quantity: 50 });
  const order = (await orderService.createOrder(uid, {
    order_type: "takeaway",
    channel,
    storefront: channel === "online",
    items: [{ product_id: String(p._id), quantity: 1 }],
  })) as { _id: unknown; order_no: string; total_amount: number };
  // ให้ข้อความ "ได้รับออเดอร์" ยิงเสร็จก่อนเหตุการณ์ถัดไป — งานเบื้องหลังวิ่งพร้อมกัน ลำดับที่ยิงไม่แน่นอน (CI ช้ากว่าเครื่อง)
  await flushBackground();
  return { order, id: String(order._id) };
}

/** ออเดอร์จัดส่ง — สร้างแบบรับเองแล้วสลับประเภท (เทสนี้ดูแค่การแจ้งเตือน ไม่ใช่การคิดค่าส่ง) */
async function placeDeliveryOrder(uid: string) {
  const o = await placeOrder(uid);
  await orderModel.updateOne({ _id: o.id }, { $set: { order_type: "delivery" } });
  return o;
}

beforeEach(() => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "token-test";
  process.env.LINE_TARGET_ID = OWNER;
  fetchSpy = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  await flushBackground();
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.LINE_TARGET_ID;
  delete process.env.ADMIN_APP_URL;
  vi.unstubAllGlobals();
});

describe("ลูกค้า — ออเดอร์หน้าเว็บ (ORD-)", () => {
  it("สั่งออเดอร์ → ลูกค้าได้ 'ได้รับออเดอร์' พร้อมยอด · เจ้าของร้านได้ 'ออเดอร์ใหม่'", async () => {
    const c = await customer();
    const { order } = await placeOrder(c.uid);

    const toCustomer = await settled(c.lineId);
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0]).toContain(`ออเดอร์ ${order.order_no}`);
    expect(toCustomer[0]).toContain("ได้รับออเดอร์แล้ว ยอดรวม 100 บาท");

    expect(pushedTo(OWNER).some((t) => t.includes(`ออเดอร์ใหม่ ${order.order_no}`))).toBe(true);
  });

  it("รับเองที่ร้าน: ไล่ confirmed → preparing → ready → completed → LINE แค่ 'พร้อมรับ' (รวมทั้งหมด 2 ข้อความ)", async () => {
    const c = await customer();
    const { id } = await placeOrder(c.uid);
    for (const s of ["confirmed", "preparing", "ready", "completed"] as const) {
      await orderService.updateOrderStatus(id, s);
    }

    const msgs = await settled(c.lineId);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toContain("สินค้าพร้อมรับที่ร้านแล้ว");
  });

  it("จัดส่ง: ready ไม่แจ้ง · เริ่มส่งแจ้งพร้อมขนส่ง+เลขพัสดุ · แก้เลขพัสดุไม่แจ้งซ้ำ · ส่งถึงแจ้ง", async () => {
    const c = await customer();
    const { id } = await placeDeliveryOrder(c.uid);
    for (const s of ["confirmed", "preparing", "ready"] as const) {
      await orderService.updateOrderStatus(id, s);
    }
    expect(await settled(c.lineId)).toHaveLength(1); // มีแค่ 'ได้รับออเดอร์'

    await orderService.updateDelivery(id, { delivery_status: "shipping", tracking_no: "TH111", shipping_carrier: "flash" });
    let msgs = await settled(c.lineId);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toContain("กำลังจัดส่ง");
    expect(msgs[1]).toContain("ขนส่ง: Flash Express");
    expect(msgs[1]).toContain("เลขพัสดุ: TH111");

    await orderService.updateDelivery(id, { delivery_status: "shipping", tracking_no: "TH222" });
    expect(await settled(c.lineId)).toHaveLength(2);

    await orderService.updateDelivery(id, { delivery_status: "delivered" });
    msgs = await settled(c.lineId);
    expect(msgs).toHaveLength(3);
    expect(msgs[2]).toContain("จัดส่งสำเร็จแล้ว");
  });

  it("จัดส่งไม่สำเร็จ → แจ้งว่าร้านจะติดต่อกลับ", async () => {
    const c = await customer();
    const { id } = await placeDeliveryOrder(c.uid);
    await orderService.updateDelivery(id, { delivery_status: "failed" });

    const msgs = await settled(c.lineId);
    expect(msgs.at(-1)).toContain("จัดส่งไม่สำเร็จ ร้านจะติดต่อกลับ");
  });

  it("ร้านยกเลิกพร้อมเหตุผล → แจ้งพร้อมเหตุผล · ลูกค้ายกเลิกเอง → ไม่แจ้งกลับ", async () => {
    const a = await customer();
    const byShop = await placeOrder(a.uid);
    await orderService.updateOrderStatus(byShop.id, "cancelled", { cancelled_reason: "เค้กหมดแล้ว" });
    const msgs = await settled(a.lineId);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toContain("ถูกยกเลิก");
    expect(msgs[1]).toContain("เหตุผล: เค้กหมดแล้ว");

    const b = await customer();
    const bySelf = await placeOrder(b.uid);
    await orderService.cancelOrderByCustomer(bySelf.id, b.uid, "สั่งผิด");
    expect(await settled(b.lineId)).toHaveLength(1);
  });

  it("ชำระเงิน: สำเร็จ → แจ้ง (และเลื่อนเป็นกำลังเตรียมสินค้าอัตโนมัติ) · คืนเงิน → แจ้ง", async () => {
    const c = await customer();
    const { id } = await placeOrder(c.uid);

    await orderService.setPaymentStatus(id, "paid");
    expect((await orderModel.findById(id).lean<{ order_status: string }>())?.order_status).toBe("preparing");
    await flushBackground(); // ให้ "ชำระเงินสำเร็จ" ยิงก่อน "คืนเงิน" — ตรวจตามลำดับด้านล่าง
    await orderService.setPaymentStatus(id, "refunded");

    const msgs = await settled(c.lineId);
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toContain("ชำระเงินสำเร็จ");
    expect(msgs[2]).toContain("คืนเงินเรียบร้อยแล้ว");
  });

  it("สลิปไม่ผ่าน → แจ้งให้แนบสลิปใหม่", async () => {
    const c = await customer();
    const { id } = await placeOrder(c.uid);
    await orderService.setPaymentStatus(id, "failed");

    const msgs = await settled(c.lineId);
    expect(msgs.at(-1)).toContain("การชำระเงินไม่ผ่านการตรวจสอบ");
  });

  it("ลูกค้ายังไม่ผูก LINE → ไม่ยิงหาลูกค้า แต่เจ้าของร้านยังได้ 'ออเดอร์ใหม่'", async () => {
    const user = await makeUser();
    const { order, id } = await placeOrder(String(user._id));
    await orderService.updateOrderStatus(id, "confirmed");
    await orderService.updateOrderStatus(id, "preparing");
    await orderService.updateOrderStatus(id, "ready");
    await flushBackground();

    const targets = fetchSpy.mock.calls.filter(([u]) => u === PUSH_URL).map(([, init]) => JSON.parse(init.body).to);
    expect(new Set(targets)).toEqual(new Set([OWNER]));
    expect(pushedTo(OWNER).some((t) => t.includes(order.order_no))).toBe(true);
  });
});

describe("ลูกค้า — บิลหน้าร้าน (POS-)", () => {
  it("ลูกค้าผูก LINE แล้ว แต่บิล POS → ไม่ส่ง LINE หาลูกค้าทั้งตอนสร้างและตอนพร้อมรับ", async () => {
    const c = await customer();
    const { order, id } = await placeOrder(c.uid, "instore");
    expect(order.order_no.startsWith("POS-")).toBe(true);
    for (const s of ["confirmed", "preparing", "ready"] as const) {
      await orderService.updateOrderStatus(id, s);
    }

    expect(await settled(c.lineId)).toEqual([]);
  });
});

describe("ลูกค้า + เจ้าของร้าน — พรีออเดอร์ใหม่ (PRE-)", () => {
  it("สั่งพรีออเดอร์ → ลูกค้าได้ 'ได้รับพรีออเดอร์' · เจ้าของได้ 'พรีออเดอร์ใหม่' พร้อมชื่อรอบ · สลิปไม่ผ่าน → แจ้งลูกค้า", async () => {
    const c = await customer();
    const product = await makeProduct({ is_preorder: true, product_price: 150 });
    const roundName = `รอบทดสอบ LINE ${Date.now()}`;
    const round = await preorderRoundService.createRound(
      {
        round_name: roundName,
        open_date: new Date(Date.now() - 1000),
        close_date: new Date(Date.now() + 86_400_000),
        pickup_date: new Date(Date.now() + 2 * 86_400_000),
        items: [{ product_id: String(product._id), max_qty_total: 10 }],
      },
      c.uid
    );
    const roundItem = (await preorderRoundService.listRoundItems(String(round._id)))[0] as { _id: unknown };
    const pre = (await preorderService.createPreorder(c.uid, {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: String(roundItem._id), quantity: 2 }],
    })) as { _id: unknown; preorder_no: string };

    const toCustomer = await settled(c.lineId);
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0]).toContain(`พรีออเดอร์ ${pre.preorder_no}`);
    expect(toCustomer[0]).toContain("ได้รับพรีออเดอร์แล้ว ยอดรวม 300 บาท");

    const toOwner = pushedTo(OWNER).find((t) => t.includes(`พรีออเดอร์ใหม่ ${pre.preorder_no}`));
    expect(toOwner).toContain(roundName);

    await preorderService.setPaymentStatus(String(pre._id), "failed");
    expect((await settled(c.lineId)).at(-1)).toContain("การชำระเงินไม่ผ่านการตรวจสอบ");
  });
});

describe("เจ้าของร้าน", () => {
  it("ลูกค้าแนบสลิป → LINE เจ้าของร้าน 'รอตรวจสอบสลิป' พร้อมเลขออเดอร์", async () => {
    const c = await customer();
    const { order } = await placeOrder(c.uid);
    const payment = (await paymentService.createPayment({
      user_id: c.uid,
      order_id: String(order._id),
      amount: order.total_amount,
    })) as { _id: unknown };

    await paymentService.submitSlip(String(payment._id), { slip_image_url: "/api/files/slips/line-test.jpg" });

    const slipMsg = (await settled(OWNER)).find((t) => t.includes("รอตรวจสอบสลิป"));
    expect(slipMsg).toBeTruthy();
    expect(slipMsg).toContain(order.order_no);
  });

  it("วัตถุดิบเพิ่งข้ามจุดสั่งซื้อ → แจ้ง 1 ครั้ง · เบิกต่อตอนต่ำอยู่แล้ว → ไม่แจ้งซ้ำ", async () => {
    const staff = await makeUser();
    const ing = await makeIngredient({ current_stock: 8, reorder_point: 5 });
    const use = (qty: number) =>
      ingredientTransactionService.createTransaction({
        ingredient_id: String(ing._id),
        type: "use",
        qty,
        performed_by: String(staff._id),
      });

    await use(2); // 8 → 6 ยังไม่ถึง
    await use(2); // 6 → 4 ข้ามเกณฑ์
    await use(1); // 4 → 3 ต่ำอยู่แล้ว

    const notes = (await settled(OWNER)).filter((t) => t.includes(`วัตถุดิบใกล้จะหมด: ${ing.ingredient_name}`));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("คงเหลือ 4 (จุดสั่งซื้อ 5)");
  });

  it("ตั้ง ADMIN_APP_URL → ข้อความถึงเจ้าของร้านแนบลิงก์ 🔗 ไปหน้าออเดอร์ในเว็บหลังร้าน", async () => {
    process.env.ADMIN_APP_URL = "https://admin.example/";
    const c = await customer();
    const { order } = await placeOrder(c.uid);

    const msg = (await settled(OWNER)).find((t) => t.includes(`ออเดอร์ใหม่ ${order.order_no}`));
    expect(msg).toMatch(/\n🔗 https:\/\/admin\.example\/owner\//);
    expect(msg).toContain(String(order._id));
  });
});

describe("LINE ล่ม / ตอบ error — ธุรกรรมหลักต้องไม่ล้ม", () => {
  it("network error ทุกครั้ง → สร้างออเดอร์สำเร็จ · notification บันทึก line_error ไว้ · line_sent = false", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    const c = await customer();
    const { order, id } = await placeOrder(c.uid);
    await flushBackground();

    expect(await orderModel.exists({ _id: id })).toBeTruthy();
    const note = await notificationModel
      .findOne({ title: `ออเดอร์ใหม่ ${order.order_no}` })
      .lean<{ line_sent?: boolean; line_error?: string | null }>();
    expect(note?.line_sent).not.toBe(true);
    expect(note?.line_error).toContain("ECONNRESET");
  });

  it("LINE ตอบ 500 → เปลี่ยนสถานะ/จ่ายเงินยังสำเร็จตามปกติ", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => "internal error" });
    const c = await customer();
    const { id } = await placeOrder(c.uid);

    await orderService.setPaymentStatus(id, "paid");
    await orderService.updateOrderStatus(id, "preparing");
    await orderService.updateOrderStatus(id, "ready");
    await flushBackground();

    const saved = await orderModel.findById(id).lean<{ order_status: string; payment_status: string }>();
    expect(saved).toMatchObject({ order_status: "ready", payment_status: "paid" });
    expect(pushedTo(c.lineId).length).toBeGreaterThan(0); // ยังพยายามยิงอยู่ แค่ไม่สำเร็จ
  });

  it("ลูกค้าบล็อก OA (LINE ตอบ 400) → ข้ามเงียบ ๆ ไม่กระทบเจ้าของร้าน", async () => {
    const c = await customer();
    fetchSpy.mockImplementation(async (url: string, init: { body: string }) => {
      if (url === PUSH_URL && JSON.parse(init.body).to === c.lineId) {
        return { ok: false, status: 400, text: async () => "The user hasn't added the LINE Official Account as a friend." };
      }
      return { ok: true };
    });
    const { order } = await placeOrder(c.uid);
    await flushBackground();

    const note = await notificationModel.findOne({ title: `ออเดอร์ใหม่ ${order.order_no}` }).lean<{ line_sent?: boolean }>();
    expect(note?.line_sent).toBe(true);
  });
});
