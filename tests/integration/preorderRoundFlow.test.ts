import { describe, it, expect, afterEach, vi } from "vitest";
import preorderModel from "@/models/preorderModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import paymentModel from "@/models/paymentModel";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { resetQuotaCache } from "@/lib/lineQuota";
import { flushBackground } from "@/lib/backgroundTasks";
import { makeUser, makeProduct } from "./helpers";

/** docs/preorder-round-flow.md — ปัญหา 1, 2, 4, 6, 7 */

const DAY = 24 * 60 * 60 * 1000;

async function preorderProduct(cfg: Partial<{ min_order_qty: number; max_order_qty: number; lead_time_days: number }> = {}) {
  return makeProduct({
    is_preorder: true,
    product_stock_quantity: null,
    product_price: 100,
    preorder_config: { min_order_qty: 1, max_order_qty: 10, lead_time_days: 1, ...cfg },
  });
}

/** รอบเปิดรับอยู่ตอนนี้ · ปิดรับอีก 1 วัน · รับของอีก `gapDays` วันหลังปิด */
async function openRound(products: Array<{ _id: unknown }>, opts: { gapDays?: number; maxQty?: number } = {}) {
  const admin = await makeUser();
  const close = Date.now() + DAY;
  const round = (await preorderRoundService.createRound(
    {
      round_name: `รอบ-${Date.now()}-${Math.random()}`,
      open_date: new Date(Date.now() - 1000),
      close_date: new Date(close),
      pickup_date: new Date(close + (opts.gapDays ?? 2) * DAY),
      items: products.map((p) => ({ product_id: String(p._id), max_qty_total: opts.maxQty ?? 50 })),
    },
    String(admin._id)
  )) as { _id: unknown; items: Array<{ _id: unknown; product_id: { _id: unknown } }> };
  return { round, admin, itemOf: (p: { _id: unknown }) => round.items.find((i) => String(i.product_id._id) === String(p._id))! };
}

function order(userId: unknown, round: { _id: unknown }, roundItemId: unknown, quantity: number) {
  return preorderService.createPreorder(String(userId), {
    round_id: String(round._id),
    order_type: "takeaway",
    items: [{ round_item_id: String(roundItemId), quantity }],
  }) as Promise<{ _id: unknown; preorder_no: string }>;
}

afterEach(() => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  vi.unstubAllGlobals();
});

describe("ปัญหา 1 — ยกเลิกรอบ → ยกเลิกพรีออเดอร์ที่ค้างทั้งหมด", () => {
  it("ยกเลิก + คืนโควตา + คืนเงินรายการที่จ่ายแล้ว · รายการ completed ไม่แตะ · สรุปใน cancel_cascade", async () => {
    const p = await preorderProduct();
    const { round, admin, itemOf } = await openRound([p]);
    const item = itemOf(p);
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    const unpaid = await order(a._id, round, item._id, 2);
    const paid = await order(b._id, round, item._id, 3);
    const done = await order(c._id, round, item._id, 1);

    await paymentModel.create({ user_id: b._id, preorder_id: paid._id, amount: 30000, status: "paid" });
    await preorderModel.updateOne({ _id: paid._id }, { $set: { payment_status: "paid", order_status: "confirmed" } });
    await preorderModel.updateOne({ _id: done._id }, { $set: { order_status: "completed" } });

    const res = (await preorderRoundService.updateRoundStatus(String(round._id), "cancelled", {
      by: String(admin._id),
    })) as { round_status: string; cancel_cascade: { cancelled: string[]; failed: unknown[] } };

    expect(res.round_status).toBe("cancelled");
    expect(res.cancel_cascade.cancelled.sort()).toEqual([unpaid.preorder_no, paid.preorder_no].sort());
    expect(res.cancel_cascade.failed).toEqual([]);

    const statusOf = async (id: unknown) => (await preorderModel.findById(id).lean<{ order_status: string; payment_status: string }>())!;
    expect((await statusOf(unpaid._id)).order_status).toBe("cancelled");
    expect(await statusOf(paid._id)).toMatchObject({ order_status: "cancelled", payment_status: "refunded" });
    expect((await statusOf(done._id)).order_status).toBe("completed");
    expect((await preorderModel.findById(paid._id).lean<{ cancelled_reason: string }>())?.cancelled_reason).toContain("ยกเลิกรอบ");

    // โควตาคืนเฉพาะ 2 รายการที่ยกเลิก (2+3) เหลือ 1 ของรายการ completed
    expect((await preorderRoundItemModel.findById(item._id).lean<{ current_qty: number }>())?.current_qty).toBe(1);
  });

  it("ปิดรอบ (open→closed) ไม่ใช่การยกเลิกรอบ: ไม่มี cancel_cascade · พรีออเดอร์ที่จ่ายแล้วคงอยู่ (คนไม่จ่ายดู preorderLifecycle.test.ts)", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    const u = await makeUser();
    const pre = await order(u._id, round, itemOf(p)._id, 1);
    await preorderModel.updateOne({ _id: pre._id }, { $set: { payment_status: "paid", order_status: "confirmed" } });
    const res = (await preorderRoundService.updateRoundStatus(String(round._id), "closed")) as { cancel_cascade?: unknown };
    expect(res.cancel_cascade).toBeUndefined();
    expect((await preorderModel.findById(pre._id).lean<{ order_status: string }>())?.order_status).toBe("confirmed");
  });
});

describe("ปัญหา 2 — ใช้ preorder_config ของสินค้า", () => {
  it("min_order_qty ของสินค้าสูงกว่าของรายการในรอบ → ใช้ค่าที่มากกว่า", async () => {
    const p = await preorderProduct({ min_order_qty: 2 });
    const { round, itemOf } = await openRound([p]);
    const u = await makeUser();
    await expect(order(u._id, round, itemOf(p)._id, 1)).rejects.toThrow(/ขั้นต่ำ 2/);
    await expect(order(u._id, round, itemOf(p)._id, 2)).resolves.toBeTruthy();
  });

  it("max_order_qty ต่อคนต่อรอบ รวมพรีออเดอร์เดิม · คนอื่นไม่เกี่ยว · ยกเลิกแล้วคืนสิทธิ์", async () => {
    const p = await preorderProduct({ max_order_qty: 3 });
    const { round, itemOf } = await openRound([p]);
    const item = itemOf(p);
    const [a, b] = [await makeUser(), await makeUser()];

    await expect(order(a._id, round, item._id, 4)).rejects.toThrow(/สูงสุด 3/);
    const first = await order(a._id, round, item._id, 2);
    await expect(order(a._id, round, item._id, 2)).rejects.toThrow(/สั่งไว้แล้ว 2 ชิ้น เหลือสั่งได้อีก 1/);
    await expect(order(b._id, round, item._id, 3)).resolves.toBeTruthy();

    await preorderService.cancelPreorder(String(first._id));
    await expect(order(a._id, round, item._id, 3)).resolves.toBeTruthy();
  });

  it("lead_time_days: ใส่สินค้าเข้ารอบที่ช่วงผลิตสั้นเกิน → 400 (createRound / addRoundItem / เลื่อนวันรับ)", async () => {
    const slow = await preorderProduct({ lead_time_days: 3 });
    const fast = await preorderProduct({ lead_time_days: 1 });

    await expect(openRound([slow], { gapDays: 2 })).rejects.toThrow(/ต้องใช้เวลาผลิต 3 วัน/);

    const { round } = await openRound([fast], { gapDays: 2 });
    await expect(
      preorderRoundService.addRoundItem(String(round._id), { product_id: String(slow._id), max_qty_total: 5 })
    ).rejects.toThrow(/ต้องใช้เวลาผลิต 3 วัน/);

    const { round: r2 } = await openRound([slow], { gapDays: 4 });
    const close = new Date((r2 as unknown as { close_date: string }).close_date).getTime();
    await expect(
      preorderRoundService.updateRound(String(r2._id), { pickup_date: new Date(close + 2 * DAY) })
    ).rejects.toThrow(/ต้องใช้เวลาผลิต 3 วัน/);
    await expect(
      preorderRoundService.updateRound(String(r2._id), { pickup_date: new Date(close + 3 * DAY) })
    ).resolves.toBeTruthy();
  });
});

describe("ปัญหา 4 — กู้คืนรอบได้รายการสินค้ากลับมาด้วย", () => {
  it("รายการที่ลบพร้อมรอบกลับมา · รายการที่ลบเองก่อนหน้ายังถูกลบอยู่", async () => {
    const [p1, p2] = [await preorderProduct(), await preorderProduct()];
    const { round, itemOf } = await openRound([p1, p2]);
    await preorderRoundService.removeRoundItem(String(itemOf(p2)._id)); // ลบเองก่อน
    await new Promise((r) => setTimeout(r, 20));

    await preorderRoundService.deleteRound(String(round._id));
    const restored = (await preorderRoundService.restoreRound(String(round._id))) as { restored_items: number };

    expect(restored.restored_items).toBe(1);
    const active = await preorderRoundItemModel.find({ round_id: round._id, deleted_at: null }).lean<Array<{ product_id: unknown }>>();
    expect(active.map((i) => String(i.product_id))).toEqual([String(p1._id)]);
  });
});

describe("ปัญหา 6 — เลื่อนวันรับ", () => {
  it("อัปเดต pickup_date ในรายการพรีออเดอร์ · ล้างสถานะเตือนแล้ว · แจ้งลูกค้าทาง LINE", async () => {
    resetQuotaCache();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "token-test";
    const fetchSpy = vi.fn(async (url: string, _init?: { body: string }) =>
      url.endsWith("/message/push") ? { ok: true } : { ok: false, status: 500, json: async () => ({}) }
    );
    vi.stubGlobal("fetch", fetchSpy);

    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p], { gapDays: 2 });
    const u = await makeUser({ line_user_id: "U_PICKUP" });
    const pre = await order(u._id, round, itemOf(p)._id, 1);
    await preorderModel.updateOne({ _id: pre._id }, { $set: { pickup_reminded_at: new Date() } });

    const close = new Date((round as unknown as { close_date: string }).close_date).getTime();
    const newPickup = new Date(close + 5 * DAY);
    await preorderRoundService.updateRound(String(round._id), { pickup_date: newPickup });

    const items = await preorderItemModel.find({ preorder_id: pre._id }).lean<Array<{ pickup_date: Date }>>();
    expect(items.every((i) => new Date(i.pickup_date).getTime() === newPickup.getTime())).toBe(true);
    expect((await preorderModel.findById(pre._id).lean<{ pickup_reminded_at: Date | null }>())?.pickup_reminded_at).toBeNull();

    await vi.waitFor(() => {
      const pushed = fetchSpy.mock.calls
        .filter(([url]) => String(url).endsWith("/message/push"))
        .map(([, init]) => JSON.parse(init!.body))
        .filter((b) => b.to === "U_PICKUP" && String(b.messages[0].text).includes("เปลี่ยน"));
      expect(pushed).toHaveLength(1);
      expect(pushed[0].messages[0].text).toContain("เปลี่ยนวันรับสินค้า");
    });
  });

  it("แก้ชื่อรอบอย่างเดียว → ไม่แจ้งลูกค้า", async () => {
    resetQuotaCache();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "token-test";
    const fetchSpy = vi.fn(async (_url: string, _init?: { body: string }) => ({ ok: true }));
    vi.stubGlobal("fetch", fetchSpy);
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    const u = await makeUser({ line_user_id: "U_NAME" });
    await order(u._id, round, itemOf(p)._id, 1);
    // แจ้งเตือนตอนสั่ง (ร้าน + ลูกค้า) วิ่งเบื้องหลัง — รอให้จบก่อนล้างตัวนับ ไม่งั้น CI ที่ช้ากว่านับข้อความพวกนั้นเข้ามาด้วย
    await flushBackground();
    fetchSpy.mockClear();

    await preorderRoundService.updateRound(String(round._id), { round_name: "ชื่อใหม่" });
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/message/push"))).toHaveLength(0);
  });
});

describe("ปัญหา 7 — แก้รายการในรอบที่ปิด/ยกเลิกแล้วไม่ได้", () => {
  it("updateRoundItem ของรอบ closed → 409 · รอบ open ยังแก้ได้", async () => {
    const p = await preorderProduct();
    const { round, itemOf } = await openRound([p]);
    const itemId = String(itemOf(p)._id);
    await expect(preorderRoundService.updateRoundItem(itemId, { max_qty_total: 60 })).resolves.toBeTruthy();
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");
    await expect(preorderRoundService.updateRoundItem(itemId, { max_qty_total: 70 })).rejects.toThrow(/แก้ไขรายการสินค้าไม่ได้/);
  });
});
