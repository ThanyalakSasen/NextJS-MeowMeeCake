/* eslint-disable @typescript-eslint/no-explicit-any */
// แจ้งเตือนบนเครื่องลูกค้า (Web Push) — pushService + customerNotifyService.notifyCustomer
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import pushSubscriptionModel from "@/models/pushSubscriptionModel";
import customerNotificationModel from "@/models/customerNotificationModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderModel from "@/models/preorderModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import paymentModel from "@/models/paymentModel";
import { webPushSender } from "@/lib/webPush";
import { pushConfig, pushToUser, subscribe, unsubscribe } from "@/services/pushService";
import { notifyCustomer } from "@/services/customerNotifyService";
import { editPreorderItems } from "@/services/preorderEditService";
import { flushBackground } from "@/lib/backgroundTasks";
import { pushSubscribe } from "@/schemas/push";
import { makePreorder, makeProduct, makeUser } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const sub = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: `p256-${n}`, auth: `auth-${n}` } });

beforeEach(() => {
  process.env.WEB_PUSH_PUBLIC_KEY = "test-public";
  process.env.WEB_PUSH_PRIVATE_KEY = "test-private";
});
afterEach(() => {
  delete process.env.WEB_PUSH_PUBLIC_KEY;
  delete process.env.WEB_PUSH_PRIVATE_KEY;
  vi.restoreAllMocks();
});

describe("web push", () => {
  it("ตั้ง key แล้ว = enabled + public key · ไม่ตั้ง = ปิด ไม่ส่ง", async () => {
    expect(pushConfig()).toEqual({ enabled: true, public_key: "test-public" });
    const user = await makeUser();
    await subscribe(String(user._id), sub());
    delete process.env.WEB_PUSH_PRIVATE_KEY;
    const send = vi.spyOn(webPushSender, "send");
    expect(pushConfig().enabled).toBe(false);
    expect(await pushToUser(String(user._id), { title: "t", body: "b", url: "/" })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("schema รับเฉพาะ endpoint https", () => {
    expect(pushSubscribe.safeParse(sub()).success).toBe(true);
    expect(pushSubscribe.safeParse({ ...sub(), endpoint: "http://evil.test/x" }).success).toBe(false);
  });

  it("สมัครซ้ำ endpoint เดิม = แถวเดียว · สลับบัญชีบนเครื่องเดียวกันย้ายเป็นของคนใหม่ · ปิดได้เฉพาะของตัวเอง", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await subscribe(String(a._id), sub());
    await subscribe(String(a._id), sub());
    expect(await pushSubscriptionModel.countDocuments({ user_id: a._id })).toBe(1);
    await subscribe(String(b._id), sub());
    expect(await pushSubscriptionModel.countDocuments({ user_id: a._id })).toBe(0);
    await unsubscribe(String(a._id), sub().endpoint);
    expect(await pushSubscriptionModel.countDocuments({ user_id: b._id })).toBe(1);
    await unsubscribe(String(b._id), sub().endpoint);
    expect(await pushSubscriptionModel.countDocuments({})).toBe(0);
  });

  it("กระดิ่งใหม่ → ส่งขึ้นทุกเครื่อง (หัวข้อ/ข้อความ/ลิงก์เดียวกับกระดิ่ง) · เครื่องที่หมดอายุ (410) ลบทิ้ง", async () => {
    const user = await makeUser();
    await subscribe(String(user._id), sub(1));
    await subscribe(String(user._id), sub(2));
    const send = vi.spyOn(webPushSender, "send").mockImplementation(async (target) =>
      target.endpoint.endsWith("device-2") ? { ok: false, gone: true, error: "HTTP 410" } : { ok: true }
    );
    const refId = "6710aa00000000000000abcd";
    await notifyCustomer(user._id, null, {
      title: "พรีออเดอร์ #PRE-1", message: "สวัสดี", type: "info",
      link: `/customer/account/preorders/${refId}`, ref_type: "preorder", ref_id: refId,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1]).toEqual({
      title: "พรีออเดอร์ #PRE-1", body: "สวัสดี", url: `/customer/account/preorders/${refId}`, tag: `preorder:${refId}`,
    });
    const left = await pushSubscriptionModel.find({ user_id: user._id }).lean<any[]>();
    expect(left.map((s) => s.endpoint)).toEqual([sub(1).endpoint]);
    expect(left[0].last_success_at).toBeInstanceOf(Date);
  });

  it("ส่งไม่สำเร็จ ไม่ทำให้บันทึกกระดิ่งล้ม", async () => {
    const user = await makeUser();
    await subscribe(String(user._id), sub());
    vi.spyOn(webPushSender, "send").mockRejectedValue(new Error("network"));
    await notifyCustomer(user._id, null, { title: "x", message: "y", type: "info", link: null, ref_type: null, ref_id: null });
    expect(await customerNotificationModel.countDocuments({ user_id: user._id })).toBe(1);
  });

  it("เปลี่ยนสินค้าจนต้องชำระเพิ่ม → แจ้งเตือนบอกยอด · กดแล้วไปส่วนชำระเงินของหน้ารายละเอียด", async () => {
    const customer = await makeUser();
    const admin = await makeUser();
    const round = await preorderRoundModel.create({
      round_name: "รอบแจ้งเตือน", round_status: "open", created_by: admin._id,
      open_date: new Date(Date.now() - DAY), close_date: new Date(Date.now() + DAY), pickup_date: new Date(Date.now() + 3 * DAY),
    });
    const cake = await makeProduct({ product_name_th: "เค้ก", product_price: 150 });
    const bread = await makeProduct({ product_name_th: "ขนมปัง", product_price: 100 });
    const cakeItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: cake._id, max_qty_total: 50, current_qty: 1 });
    const breadItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: bread._id, max_qty_total: 50, current_qty: 0 });
    const p = await makePreorder(String(customer._id), {
      round_id: round._id, order_type: "takeaway", order_status: "preparing", payment_status: "paid",
      subtotal: 150, discount_amount: 0, delivery_fee: 0, total_amount: 150,
    });
    const line = await preorderItemModel.create({
      preorder_id: p._id, round_item_id: cakeItem._id, product_id: cake._id,
      product_snapshot: { product_name_th: "เค้ก", product_name_eng: "cake" },
      pickup_date: new Date(Date.now() + 3 * DAY), quantity: 1, unit_price: 150, total_price: 150,
    });
    const main = await paymentModel.create({ preorder_id: p._id, user_id: customer._id, amount: 150, status: "paid" });
    await preorderModel.updateOne({ _id: p._id }, { $set: { payment_id: main._id } });
    await subscribe(String(customer._id), sub());
    const send = vi.spyOn(webPushSender, "send").mockResolvedValue({ ok: true });

    await editPreorderItems(String(p._id), {
      keep: [{ item_id: String(line._id), quantity: 1 }],
      add: [{ round_item_id: String(breadItem._id), quantity: 1 }],
      allow_extra_payment: true,
    });
    await flushBackground();

    const link = `/customer/account/preorders/${String(p._id)}#payment`;
    const notice = await customerNotificationModel.findOne({ user_id: customer._id }).lean<any>();
    expect(notice).toMatchObject({ link, ref_type: "preorder" });
    expect(notice.title).toContain("ชำระเงินเพิ่ม 100 บาท");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toMatchObject({ url: link, title: notice.title });
    expect(send.mock.calls[0][1].body).toContain("กรุณาชำระเงินเพิ่ม 100 บาท");
  });
});
