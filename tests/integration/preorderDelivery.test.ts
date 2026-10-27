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

  it("ร้านตั้ง delivered เองไม่ได้ (409) · ลูกค้ากดได้รับสินค้า → delivered + delivered_at + completed", async () => {
    const customer = await makeUser();
    const preorder = await makePreorder(String(customer._id), { order_type: "delivery", order_status: "preparing", payment_status: "paid" });

    await expect(updateDelivery(String(preorder._id), { delivery_status: "delivered" })).rejects.toMatchObject({ status: 409 });
    // ส่งของออก = สินค้าพร้อม → ready ให้เอง
    expect((await updateDelivery(String(preorder._id), { delivery_status: "shipping" })) as unknown as { order_status: string }).toMatchObject({ order_status: "ready" });

    await preorderService.confirmReceivedByCustomer(String(preorder._id), String(customer._id));
    const fromDb = await preorderModel.findById(preorder._id).lean<{ delivery_status: string; delivered_at: Date | null; order_status: string }>();
    expect(fromDb).toMatchObject({ delivery_status: "delivered", order_status: "completed" });
    expect(fromDb!.delivered_at).toBeTruthy();
  });

  it("ลูกค้ากดได้รับสินค้า: ยังไม่จัดส่ง = 409 · ของคนอื่น = 404 · รับเอง = 400 · กดซ้ำได้", async () => {
    const customer = await makeUser();
    const other = await makeUser();
    const uid = String(customer._id);
    const pre = await makePreorder(uid, { order_type: "delivery", order_status: "preparing", payment_status: "paid" });
    await expect(preorderService.confirmReceivedByCustomer(String(pre._id), uid)).rejects.toMatchObject({ status: 409 });
    await updateDelivery(String(pre._id), { delivery_status: "shipping" });
    await expect(preorderService.confirmReceivedByCustomer(String(pre._id), String(other._id))).rejects.toMatchObject({ status: 404 });
    await preorderService.confirmReceivedByCustomer(String(pre._id), uid);
    await expect(preorderService.confirmReceivedByCustomer(String(pre._id), uid)).resolves.toBeTruthy();

    const takeaway = await makePreorder(uid, { order_type: "takeaway", order_status: "ready", payment_status: "paid" });
    await expect(preorderService.confirmReceivedByCustomer(String(takeaway._id), uid)).rejects.toMatchObject({ status: 400 });
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
      delivery_status: "shipping",
      delivered_note: "ฝากไว้หน้าบ้าน",
    });

    const fromDb = await preorderModel
      .findById(preorder._id)
      .lean<{ delivery_status: string; delivered_note: string | null } | null>();
    expect(fromDb!.delivery_status).toBe("shipping");
    expect(fromDb!.delivered_note).toBe("ฝากไว้หน้าบ้าน");
  });
});

describe("assertShopMayClose — ร้านอัปเดตได้ถึงกำลังจัดส่ง (route หลังร้าน)", () => {
  it("ออเดอร์เว็บ/พรีออเดอร์แบบจัดส่ง: completed / delivered = 409 · หน้าร้าน (POS-) และรับเอง ปิดเองได้", async () => {
    const { assertShopMayClose } = await import("@/lib/orderLifecycle");
    const web = { order_no: "ORD-20261028-MMC001", order_type: "delivery" };
    expect(() => assertShopMayClose(web, { order_status: "completed" }, "ออเดอร์")).toThrow(/ได้รับสินค้าแล้ว/);
    expect(() => assertShopMayClose(web, { delivery_status: "delivered" }, "ออเดอร์")).toThrow();
    expect(() => assertShopMayClose(web, { order_status: "ready" }, "ออเดอร์")).not.toThrow();
    expect(() => assertShopMayClose(web, { delivery_status: "failed" }, "ออเดอร์")).not.toThrow();
    expect(() => assertShopMayClose({ preorder_no: "PRE-1", order_type: "delivery" }, { order_status: "completed" }, "พรีออเดอร์")).toThrow();
    expect(() => assertShopMayClose({ order_no: "POS-20261028-MMC001", order_type: "delivery" }, { order_status: "completed" }, "ออเดอร์")).not.toThrow();
    expect(() => assertShopMayClose({ order_no: "ORD-1", order_type: "takeaway" }, { order_status: "completed" }, "ออเดอร์")).not.toThrow();
  });
});
