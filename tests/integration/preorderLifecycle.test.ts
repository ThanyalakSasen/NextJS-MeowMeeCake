import { describe, it, expect, afterEach } from "vitest";
import preorderModel from "@/models/preorderModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import paymentModel from "@/models/paymentModel";
import productionOrderModel from "@/models/productionOrderModel";
import productionItemModel from "@/models/productionItemModel";
import notificationModel from "@/models/notificationModel";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import {
  cancelUnpaidPreorders,
  computePaymentDueAt,
  onPreorderPaid,
  paymentDeadlineHours,
  runRoundScheduler,
} from "@/services/preorderRoundLifecycleService";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * docs/preorder-round-flow.md §6 — ตัดสินใจ 2026-10-01
 *   ประเด็น 3: ใบผลิตนับเฉพาะที่จ่ายแล้ว · กำหนดชำระ = min(สั่ง + N ชม., ปิดรอบ) · เลยแล้วยกเลิก (ยกเว้นสลิปรอตรวจ)
 *   ประเด็น 5: เปิด/ปิดรอบอัตโนมัติ · ประเด็น 8: เปิดกลับได้ถ้ายังไม่มีใบผลิต
 *   + ปิดรอบ → สร้างใบผลิตอัตโนมัติ (วันผลิต = วันรับ − lead time สูงสุด) · จ่ายช้า → บวกเข้าใบผลิต
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

afterEach(() => {
  delete process.env.PREORDER_PAYMENT_DEADLINE_HOURS;
});

async function preorderProduct(leadDays = 1) {
  const p = await makeProduct({
    is_preorder: true,
    product_stock_quantity: null,
    product_price: 100,
    preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: leadDays },
  });
  await makeRecipe(String(p._id));
  return p;
}

async function openRound(products: Array<{ _id: unknown }>, opts: { closeInMs?: number; pickupAfterCloseDays?: number } = {}) {
  const admin = await makeUser();
  const close = Date.now() + (opts.closeInMs ?? DAY);
  const round = (await preorderRoundService.createRound(
    {
      round_name: `รอบ-${Date.now()}-${Math.random()}`,
      open_date: new Date(Date.now() - 1000),
      close_date: new Date(close),
      pickup_date: new Date(close + (opts.pickupAfterCloseDays ?? 4) * DAY),
      round_status: "open",
      items: products.map((p) => ({ product_id: String(p._id), max_qty_total: 100 })),
    },
    String(admin._id)
  )) as { _id: unknown; close_date: string; pickup_date: string; items: Array<{ _id: unknown; product_id: { _id: unknown } }> };
  const itemOf = (p: { _id: unknown }) => round.items.find((i) => String(i.product_id._id) === String(p._id))!;
  return { round, admin, itemOf };
}

async function order(round: { _id: unknown }, roundItemId: unknown, quantity: number) {
  const u = await makeUser();
  return (await preorderService.createPreorder(String(u._id), {
    round_id: String(round._id),
    order_type: "takeaway",
    items: [{ round_item_id: String(roundItemId), quantity }],
  })) as { _id: unknown; preorder_no: string; user_id: { _id: unknown } };
}

const markPaid = (id: unknown) =>
  preorderModel.updateOne({ _id: id }, { $set: { payment_status: "paid", order_status: "confirmed" } });

const withSlip = async (preorderId: unknown) =>
  paymentModel.create({
    user_id: (await preorderModel.findById(preorderId).lean<{ user_id: unknown }>())!.user_id,
    preorder_id: preorderId,
    amount: 100,
    status: "pending",
    slip_image_url: "/uploads/slips/1700000000000-aaaaaaaaaaaa.jpg",
  });

const statusOf = async (id: unknown) =>
  (await preorderModel.findById(id).lean<{ order_status: string; payment_status: string }>())!;

describe("กำหนดชำระเงิน", () => {
  it("min(สั่ง + N ชม., ปิดรอบ) · ค่าเริ่มต้น 24 ชม. · ตั้งผ่าน env ได้", () => {
    const ordered = new Date("2026-10-01T03:00:00Z");
    expect(paymentDeadlineHours()).toBe(24);
    expect(computePaymentDueAt(ordered, new Date("2026-10-10T00:00:00Z")).toISOString()).toBe("2026-10-02T03:00:00.000Z");
    expect(computePaymentDueAt(ordered, new Date("2026-10-01T11:00:00Z")).toISOString()).toBe("2026-10-01T11:00:00.000Z");
    process.env.PREORDER_PAYMENT_DEADLINE_HOURS = "6";
    expect(computePaymentDueAt(ordered, new Date("2026-10-10T00:00:00Z")).toISOString()).toBe("2026-10-01T09:00:00.000Z");
    process.env.PREORDER_PAYMENT_DEADLINE_HOURS = "-1";
    expect(paymentDeadlineHours()).toBe(24);
  });

  it("createPreorder บันทึก payment_due_at · รอบปิดเร็วกว่า 24 ชม. → กำหนด = เวลาปิดรอบ", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p], { closeInMs: 2 * HOUR });
    const pre = await order(round, itemOf(p)._id, 1);
    const due = (await preorderModel.findById(pre._id).lean<{ payment_due_at: Date }>())!.payment_due_at;
    expect(new Date(due).getTime()).toBe(new Date(round.close_date).getTime());
  });

  it("เลื่อนปิดรอบออกไป → คำนวณกำหนดชำระใหม่ของคนที่ยังไม่จ่าย", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p], { closeInMs: 2 * HOUR });
    const pre = await order(round, itemOf(p)._id, 1);
    const newClose = new Date(Date.now() + 3 * DAY);
    await preorderRoundService.updateRound(String(round._id), {
      close_date: newClose,
      pickup_date: new Date(newClose.getTime() + 4 * DAY),
    });
    const due = new Date((await preorderModel.findById(pre._id).lean<{ payment_due_at: Date }>())!.payment_due_at).getTime();
    expect(due).toBeLessThan(newClose.getTime()); // ตอนนี้ถูกจำกัดด้วย 24 ชม. แทน
    expect(due).toBeGreaterThan(Date.now() + 23 * HOUR);
  });
});

describe("ยกเลิกคนไม่จ่ายภายในกำหนด (cancelUnpaidPreorders)", () => {
  it("เลยกำหนด+ไม่จ่าย → ยกเลิก + คืนโควตา · ยังไม่ถึงกำหนด / จ่ายแล้ว / มีสลิปรอตรวจ → ไม่แตะ", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p], { closeInMs: 3 * DAY });
    const item = itemOf(p)._id;
    const overdue = await order(round, item, 2);
    const notYet = await order(round, item, 1);
    const paid = await order(round, item, 1);
    const slip = await order(round, item, 1);
    const past = new Date(Date.now() - HOUR);
    await preorderModel.updateMany({ _id: { $in: [overdue._id, paid._id, slip._id] } }, { $set: { payment_due_at: past } });
    await markPaid(paid._id);
    await withSlip(slip._id);

    const r = await cancelUnpaidPreorders({ roundId: round._id });
    expect(r.cancelled).toEqual([overdue.preorder_no]);
    expect(r.waitingSlip).toEqual([slip.preorder_no]);
    expect((await statusOf(overdue._id)).order_status).toBe("cancelled");
    expect((await statusOf(notYet._id)).order_status).toBe("pending");
    expect((await statusOf(paid._id)).order_status).toBe("confirmed");
    expect((await statusOf(slip._id)).order_status).toBe("pending");
    const reason = (await preorderModel.findById(overdue._id).lean<{ cancelled_reason: string }>())!.cancelled_reason;
    expect(reason).toContain("ไม่ได้ชำระเงินภายในกำหนด");
  });
});

describe("ปิดรอบ → ยกเลิกคนไม่จ่าย + สร้างใบสั่งผลิตอัตโนมัติ", () => {
  it("ใบผลิตนับเฉพาะที่จ่ายแล้ว · สลิปรอตรวจไม่ยกเลิก+ไม่นับ · วันผลิต = วันรับ − lead time สูงสุด · แจ้งร้าน", async () => {
    const fast = await preorderProduct(1);
    const slow = await preorderProduct(3);
    const { round, itemOf } = await openRound([fast, slow], { pickupAfterCloseDays: 5 });
    const paidA = await order(round, itemOf(fast)._id, 4);
    const paidB = await order(round, itemOf(slow)._id, 2);
    const unpaid = await order(round, itemOf(fast)._id, 7);
    const slipWaiting = await order(round, itemOf(fast)._id, 5);
    await markPaid(paidA._id);
    await markPaid(paidB._id);
    await withSlip(slipWaiting._id);

    const res = (await preorderRoundService.updateRoundStatus(String(round._id), "closed")) as {
      close_result: { unpaid: { cancelled: string[]; waitingSlip: string[] }; production: { created: boolean; production_no: string } };
    };

    expect(res.close_result.unpaid.cancelled).toEqual([unpaid.preorder_no]); // ปิดรอบ = หมดเวลาจ่ายทุกคน
    expect(res.close_result.unpaid.waitingSlip).toEqual([slipWaiting.preorder_no]);
    expect(res.close_result.production.created).toBe(true);

    const po = await productionOrderModel.findOne({ round_id: round._id }).lean<{ _id: unknown; production_date: Date; production_status: string }>();
    expect(po?.production_status).toBe("planned");
    const expectedDate = new Date(round.pickup_date).getTime() - 3 * DAY; // lead time สูงสุด = 3
    expect(new Date(po!.production_date).getTime()).toBe(expectedDate);

    const items = await productionItemModel.find({ production_order_id: po!._id }).lean<Array<{ product_id: unknown; planned_qty: number }>>();
    const qty = new Map(items.map((i) => [String(i.product_id), i.planned_qty]));
    expect(qty.get(String(fast._id))).toBe(4); // ไม่นับ unpaid 7 และสลิปรอตรวจ 5
    expect(qty.get(String(slow._id))).toBe(2);

    expect(await notificationModel.findOne({ title: new RegExp(`ปิดรอบพรีออเดอร์`), message: /สลิปรอตรวจ 1 รายการ/ })).toBeTruthy();
  });

  it("ไม่มีใครจ่ายเลย → ไม่สร้างใบผลิต (บอกเหตุผล) รอบยังปิด", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    await order(round, itemOf(p)._id, 1);
    const res = (await preorderRoundService.updateRoundStatus(String(round._id), "closed")) as {
      round_status: string;
      close_result: { production: { created: boolean; reason: string } };
    };
    expect(res.round_status).toBe("closed");
    expect(res.close_result.production.created).toBe(false);
    expect(res.close_result.production.reason).toMatch(/ชำระเงินแล้ว/);
  });
});

describe("จ่ายหลังสร้างใบผลิต → บวกเข้าใบผลิต", () => {
  async function closedWithProduction() {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    const paid = await order(round, itemOf(p)._id, 3);
    const late = await order(round, itemOf(p)._id, 2);
    await markPaid(paid._id);
    await withSlip(late._id);
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");
    const po = (await productionOrderModel.findOne({ round_id: round._id }).lean<{ _id: unknown }>())!;
    return { p, round, late, po };
  }
  const plannedQty = async (poId: unknown) =>
    (await productionItemModel.find({ production_order_id: poId }).lean<Array<{ planned_qty: number }>>()).reduce((s, i) => s + i.planned_qty, 0);

  it("ใบผลิตยัง planned → บวก planned_qty · เรียกซ้ำไม่บวกซ้ำ", async () => {
    const { late, po } = await closedWithProduction();
    expect(await plannedQty(po._id)).toBe(3);

    await markPaid(late._id);
    expect(await onPreorderPaid(String(late._id))).toBe("added");
    expect(await plannedQty(po._id)).toBe(5);
    expect(await onPreorderPaid(String(late._id))).toBe("skipped");
    expect(await plannedQty(po._id)).toBe(5);
  });

  it("ใบผลิตเริ่มผลิตแล้ว (in_progress) → ไม่แตะ แจ้งร้าน", async () => {
    const { late, po } = await closedWithProduction();
    await productionOrderModel.updateOne({ _id: po._id }, { $set: { production_status: "in_progress" } });
    await markPaid(late._id);
    expect(await onPreorderPaid(String(late._id))).toBe("production-started");
    expect(await plannedQty(po._id)).toBe(3);
  });

  it("ตอนปิดไม่มีใครจ่าย (ไม่มีใบผลิต) → จ่ายทีหลังแล้วสร้างใบผลิตให้", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    const late = await order(round, itemOf(p)._id, 2);
    await withSlip(late._id);
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");
    expect(await productionOrderModel.countDocuments({ round_id: round._id })).toBe(0);

    await markPaid(late._id);
    expect(await onPreorderPaid(String(late._id))).toBe("created-production");
    const po = (await productionOrderModel.findOne({ round_id: round._id }).lean<{ _id: unknown }>())!;
    expect(await plannedQty(po._id)).toBe(2);
  });

  it("รอบยังไม่ปิด → ไม่ทำอะไร (ตอนปิดรอบจะนับเอง)", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    const pre = await order(round, itemOf(p)._id, 1);
    await markPaid(pre._id);
    expect(await onPreorderPaid(String(pre._id))).toBe("not-closed");
  });
});

describe("เปิดรอบที่ปิดแล้วกลับ (ประเด็น 8)", () => {
  it("ยังไม่มีใบผลิต + ส่ง close_date ใหม่ → เปิดได้ · close_date ผ่านแล้วไม่ส่งใหม่ → 409", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    await order(round, itemOf(p)._id, 1); // ไม่จ่าย → ปิดแล้วไม่มีใบผลิต
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");
    await preorderRoundModel.updateOne({ _id: round._id }, { $set: { close_date: new Date(Date.now() - HOUR) } });

    await expect(preorderRoundService.updateRoundStatus(String(round._id), "open")).rejects.toThrow(/close_date ผ่านไปแล้ว/);
    const reopened = (await preorderRoundService.updateRoundStatus(String(round._id), "open", {
      close_date: new Date(Date.now() + DAY),
    })) as { round_status: string };
    expect(reopened.round_status).toBe("open");
  });

  it("มีใบผลิตแล้ว → เปิดกลับไม่ได้ (409)", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    const pre = await order(round, itemOf(p)._id, 1);
    await markPaid(pre._id);
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");
    await expect(
      preorderRoundService.updateRoundStatus(String(round._id), "open", { close_date: new Date(Date.now() + DAY) })
    ).rejects.toThrow(/มีใบสั่งผลิตแล้ว/);
  });
});

describe("ตัวตั้งเวลา (runRoundScheduler)", () => {
  it("scheduled ถึงเวลา → open · open เลยเวลาปิด → closed + ใบผลิต · รันซ้ำไม่ทำซ้ำ", async () => {
    const p = await preorderProduct();
    const admin = await makeUser();
    const now = Date.now();
    const toOpen = (await preorderRoundService.createRound(
      {
        round_name: `จะเปิด-${now}`,
        open_date: new Date(now + HOUR),
        close_date: new Date(now + 2 * DAY),
        pickup_date: new Date(now + 6 * DAY),
        items: [{ product_id: String(p._id), max_qty_total: 10 }],
      },
      String(admin._id)
    )) as { _id: unknown; round_status: string };
    expect(toOpen.round_status).toBe("scheduled");

    const { round: toClose, itemOf } = await openRound([p]);
    const pre = await order(toClose, itemOf(p)._id, 2);
    await markPaid(pre._id);

    // เดินเวลา: ผ่าน open_date ของรอบแรก และ close_date ของรอบที่สอง
    const later = new Date(now + 1.5 * DAY);
    const r1 = await runRoundScheduler({ now: later });
    expect(r1.opened.length).toBeGreaterThanOrEqual(1);
    expect(r1.closed.find((c) => c.production.created)).toBeTruthy();
    expect((await preorderRoundModel.findById(toOpen._id).lean<{ round_status: string }>())!.round_status).toBe("open");
    expect((await preorderRoundModel.findById(toClose._id).lean<{ round_status: string }>())!.round_status).toBe("closed");
    expect(await productionOrderModel.countDocuments({ round_id: toClose._id })).toBe(1);

    const r2 = await runRoundScheduler({ now: later });
    expect(r2.opened.map(String)).not.toContain(expect.stringContaining(`จะเปิด-${now}`));
    expect(r2.closed).toHaveLength(0);
    expect(await productionOrderModel.countDocuments({ round_id: toClose._id })).toBe(1);
  });
});
