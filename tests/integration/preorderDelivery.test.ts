import { describe, it, expect } from "vitest";
import preorderModel from "@/models/preorderModel";
import * as preorderService from "@/services/preorderService";
import { makeUser, makePreorder, oid } from "./helpers";

// BACKLOG3 §10 — updateDelivery() คืน Record<string, unknown> | null (เดิม any) — cast ให้ property
// access ในเทสไม่ต้องเช็ค null ทุกจุด (รู้อยู่แล้วว่าไม่ null ในทุกเคสที่ไม่ได้เช็ค .rejects)
type DeliveryResult = {
  delivery_status: string;
  tracking_no: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
};
async function updateDelivery(
  id: string,
  input: Parameters<typeof preorderService.updateDelivery>[1]
): Promise<DeliveryResult> {
  return (await preorderService.updateDelivery(id, input)) as unknown as DeliveryResult;
}

/**
 * BACKLOG2 §4 — preorderService ไม่เคยมี updateDelivery() เหมือน orderService เลย ทั้งที่
 * preorderModel มีฟิลด์ delivery_status/shipped_at/delivered_at/tracking_no/delivered_note
 * ครบเหมือนกัน เทสนี้ยืนยันว่าฟังก์ชันใหม่ทำงานเทียบเท่า orderService.updateDelivery() ทุกจุด
 */
describe("preorderService.updateDelivery (BACKLOG2 §4)", () => {
  it("เปลี่ยน delivery_status เป็น shipping → auto-set shipped_at ถ้ายังไม่มี", async () => {
    const customer = await makeUser();
    const preorder = await makePreorder(String(customer._id), { order_type: "delivery" });

    const updated = await updateDelivery(String(preorder._id), {
      delivery_status: "shipping",
      tracking_no: "TH1234567890",
    });

    expect(updated.delivery_status).toBe("shipping");
    expect(updated.tracking_no).toBe("TH1234567890");
    expect(updated.shipped_at).toBeTruthy();
    expect(updated.delivered_at).toBeFalsy();
  });

  it("เปลี่ยน delivery_status เป็น delivered → auto-set delivered_at ถ้ายังไม่มี", async () => {
    const customer = await makeUser();
    const preorder = await makePreorder(String(customer._id), { order_type: "delivery" });

    const updated = await updateDelivery(String(preorder._id), {
      delivery_status: "delivered",
    });

    expect(updated.delivery_status).toBe("delivered");
    expect(updated.delivered_at).toBeTruthy();
  });

  it("ไม่ทับ shipped_at เดิมถ้ามีอยู่แล้ว", async () => {
    const customer = await makeUser();
    const already = new Date("2026-01-01T00:00:00Z");
    const preorder = await makePreorder(String(customer._id), {
      order_type: "delivery",
      delivery_status: "shipping",
      shipped_at: already,
    });

    const updated = await updateDelivery(String(preorder._id), {
      delivery_status: "shipping",
      tracking_no: "TH999",
    });

    expect(new Date(updated.shipped_at!).getTime()).toBe(already.getTime());
  });

  it("พรีออเดอร์ order_type = takeaway → ปฏิเสธ (ไม่ใช่ประเภทจัดส่ง)", async () => {
    const customer = await makeUser();
    const preorder = await makePreorder(String(customer._id), { order_type: "takeaway" });

    await expect(
      preorderService.updateDelivery(String(preorder._id), { delivery_status: "shipping" })
    ).rejects.toThrow(/ไม่ใช่ประเภทจัดส่ง/);
  });

  it("ไม่พบพรีออเดอร์ → 404", async () => {
    await expect(
      preorderService.updateDelivery(String(oid()), { delivery_status: "shipping" })
    ).rejects.toThrow(/ไม่พบพรีออเดอร์/);
  });

  it("บันทึกจริงลง DB (persist)", async () => {
    const customer = await makeUser();
    const preorder = await makePreorder(String(customer._id), { order_type: "delivery" });

    await preorderService.updateDelivery(String(preorder._id), {
      delivery_status: "delivered",
      delivered_note: "ฝากไว้หน้าบ้าน",
    });

    const fromDb = await preorderModel
      .findById(preorder._id)
      .lean<{ delivery_status: string; delivered_note: string | null } | null>();
    expect(fromDb!.delivery_status).toBe("delivered");
    expect(fromDb!.delivered_note).toBe("ฝากไว้หน้าบ้าน");
  });
});
