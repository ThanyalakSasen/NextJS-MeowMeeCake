import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import userModel from "@/models/userModel";
import * as preorderService from "@/services/preorderService";
import * as userService from "@/services/userService";
import { customerMessages, notifyCustomer } from "@/services/customerNotifyService";
import { makeUser, makePreorder } from "./helpers";

/** LINE push ที่ถูกยิงหา `to` นี้ (อ่านจาก fetch spy) */
function pushedTo(fetchSpy: ReturnType<typeof vi.fn>, to: string): string[] {
  return fetchSpy.mock.calls
    .filter(([url]) => url === "https://api.line.me/v2/bot/message/push")
    .map(([, init]) => JSON.parse(init.body))
    .filter((b) => b.to === to)
    .map((b) => b.messages[0].text as string);
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "token-test";
  fetchSpy = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  vi.unstubAllGlobals();
});

describe("customerNotifyService.notifyCustomer", () => {
  it("ลูกค้าผูก LINE แล้ว → push หา line_user_id ของเขา", async () => {
    const u = await makeUser({ line_user_id: "U_A" });
    expect(await notifyCustomer(String(u._id), "hello")).toBe(true);
    expect(pushedTo(fetchSpy, "U_A")).toEqual(["hello"]);
  });

  it("ยังไม่ผูก LINE → ไม่ยิง LINE", async () => {
    const u = await makeUser();
    expect(await notifyCustomer(String(u._id), "hello")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ไม่ตั้ง token → ข้ามโดยไม่ query/ไม่ยิง", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const u = await makeUser({ line_user_id: "U_A" });
    expect(await notifyCustomer(String(u._id), "hello")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("LINE ล้มเหลว → คืน false ไม่ throw", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 400, text: async () => "not a friend" });
    const u = await makeUser({ line_user_id: "U_A" });
    expect(await notifyCustomer(String(u._id), "hello")).toBe(false);
  });
});

describe("hook เข้า lifecycle ของพรีออเดอร์", () => {
  it("ไล่สถานะ pending→completed (รับเอง) → แจ้งแค่ ready ครั้งเดียว (ประหยัดโควตา — LINE.md §9.6 ข้อ ก)", async () => {
    const u = await makeUser({ line_user_id: "U_B" });
    const pre = await makePreorder(String(u._id));

    for (const s of ["confirmed", "preparing", "ready", "completed"] as const) {
      await preorderService.updatePreorderStatus(String(pre._id), s);
    }

    await vi.waitFor(() => expect(pushedTo(fetchSpy, "U_B")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(pushedTo(fetchSpy, "U_B")).toHaveLength(1);
    expect(pushedTo(fetchSpy, "U_B")[0]).toContain("พร้อมรับที่ร้าน");
    expect(pushedTo(fetchSpy, "U_B")[0]).toContain(pre.preorder_no);
  });

  it("ยกเลิก → แจ้งพร้อมเหตุผล", async () => {
    const u = await makeUser({ line_user_id: "U_B2" });
    const pre = await makePreorder(String(u._id));

    await preorderService.updatePreorderStatus(String(pre._id), "cancelled", { cancelled_reason: "วัตถุดิบหมด" });

    await vi.waitFor(() => expect(pushedTo(fetchSpy, "U_B2")).toHaveLength(1));
    expect(pushedTo(fetchSpy, "U_B2")[0]).toContain("วัตถุดิบหมด");
  });

  it("จัดส่ง: แจ้งเมื่อสถานะเปลี่ยน แต่แก้แค่ tracking_no ไม่แจ้งซ้ำ", async () => {
    const u = await makeUser({ line_user_id: "U_C" });
    const pre = await makePreorder(String(u._id), { order_type: "delivery" });

    await preorderService.updateDelivery(String(pre._id), { delivery_status: "shipping", tracking_no: "TH1" });
    await vi.waitFor(() => expect(pushedTo(fetchSpy, "U_C")).toHaveLength(1));
    expect(pushedTo(fetchSpy, "U_C")[0]).toContain("TH1");

    await preorderService.updateDelivery(String(pre._id), { delivery_status: "shipping", tracking_no: "TH2" });
    await new Promise((r) => setTimeout(r, 100));
    expect(pushedTo(fetchSpy, "U_C")).toHaveLength(1);
  });

  it("ชำระเงินสำเร็จ → แจ้งลูกค้า", async () => {
    const u = await makeUser({ line_user_id: "U_D" });
    const pre = await makePreorder(String(u._id));

    await preorderService.setPaymentStatus(String(pre._id), "paid");

    await vi.waitFor(() => expect(pushedTo(fetchSpy, "U_D")).toHaveLength(1));
    expect(pushedTo(fetchSpy, "U_D")[0]).toContain("ชำระเงินสำเร็จ");
  });
});

describe("userService.linkLineAccount", () => {
  it("LINE เดียวผูกซ้ำอีกบัญชี → ย้ายมาบัญชีใหม่ บัญชีเก่าถูกล้าง", async () => {
    const oldAcc = await makeUser({ line_user_id: "U_E" });
    const newAcc = await makeUser();

    await userService.linkLineAccount(String(newAcc._id), "U_E");

    expect((await userModel.findById(oldAcc._id).lean<{ line_user_id: string | null }>())?.line_user_id).toBeNull();
    expect((await userModel.findById(newAcc._id).lean<{ line_user_id: string | null }>())?.line_user_id).toBe("U_E");
  });

  it("unlink → line_user_id เป็น null", async () => {
    const u = await makeUser({ line_user_id: "U_F" });
    await userService.unlinkLineAccount(String(u._id));
    expect((await userModel.findById(u._id).lean<{ line_user_id: string | null }>())?.line_user_id).toBeNull();
  });
});

describe("customerMessages", () => {
  it("ยกเลิกพร้อมเหตุผล → ใส่เหตุผลในข้อความ", () => {
    expect(customerMessages.orderStatus("order", "ORD-1", "cancelled", { reason: "ของหมด" })).toContain("ของหมด");
  });
  it("สถานะที่ไม่แจ้งแล้ว (pending/confirmed/preparing/completed) → null · ready ของออเดอร์จัดส่ง → null", () => {
    for (const s of ["pending", "confirmed", "preparing", "completed"]) {
      expect(customerMessages.orderStatus("order", "ORD-1", s)).toBeNull();
    }
    expect(customerMessages.orderStatus("order", "ORD-1", "ready", { orderType: "delivery" })).toBeNull();
    expect(customerMessages.orderStatus("order", "ORD-1", "ready", { orderType: "takeaway" })).toContain("พร้อมรับ");
  });
  it("สถานะที่ไม่แจ้ง (pending payment) → null", () => {
    expect(customerMessages.paymentStatus("order", "ORD-1", "pending")).toBeNull();
  });
});
