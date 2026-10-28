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

  it("จัดส่งเรียบร้อย (delivered) → delivered_at + สำเร็จทันที · ส่งของออกก่อนกดสินค้าพร้อม = ready ให้", async () => {
    const customer = await makeUser();
    const preorder = await makePreorder(String(customer._id), { order_type: "delivery", order_status: "preparing", payment_status: "paid" });

    expect((await updateDelivery(String(preorder._id), { delivery_status: "shipping" })) as unknown as { order_status: string }).toMatchObject({ order_status: "ready" });
    const done = (await updateDelivery(String(preorder._id), { delivery_status: "delivered", tracking_no: "TH555" })) as unknown as DeliveryResult & { order_status: string };
    expect(done).toMatchObject({ delivery_status: "delivered", order_status: "completed", tracking_no: "TH555" });
    expect(done.delivered_at).toBeTruthy();
    const fromDb = await preorderModel.findById(preorder._id).lean<{ order_status: string }>();
    expect(fromDb!.order_status).toBe("completed");
  });

  it("จัดส่งเรียบร้อยต้องมีเลขพัสดุ (400) · ยังไม่ชำระ = 409 · ลบเลขพัสดุทีหลังไม่ได้ · สำเร็จแล้วถอยสถานะจัดส่งไม่ได้", async () => {
    const uid = String((await makeUser())._id);
    const pre = await makePreorder(uid, { order_type: "delivery", order_status: "ready", payment_status: "paid" });
    await expect(updateDelivery(String(pre._id), { delivery_status: "delivered" })).rejects.toMatchObject({ status: 400 });
    await expect(updateDelivery(String(pre._id), { delivery_status: "delivered", tracking_no: "  " })).rejects.toMatchObject({ status: 400 });
    // ใช้เลขพัสดุที่บันทึกไว้ตอนกำลังจัดส่งได้
    await updateDelivery(String(pre._id), { delivery_status: "shipping", tracking_no: "TH777" });
    await expect(updateDelivery(String(pre._id), { delivery_status: "delivered" })).resolves.toMatchObject({ delivery_status: "delivered" });
    await expect(updateDelivery(String(pre._id), { tracking_no: null })).rejects.toMatchObject({ status: 400 });
    await expect(updateDelivery(String(pre._id), { delivery_status: "shipping" })).rejects.toMatchObject({ status: 409 });
    await expect(updateDelivery(String(pre._id), { tracking_no: "TH778" })).resolves.toMatchObject({ tracking_no: "TH778" });

    const unpaid = await makePreorder(uid, { order_type: "delivery", order_status: "pending", payment_status: "pending" });
    await expect(updateDelivery(String(unpaid._id), { delivery_status: "delivered", tracking_no: "TH1" })).rejects.toMatchObject({ status: 409 });
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

describe("assertShopMayComplete — จัดส่งปิดงานผ่านจัดส่งเรียบร้อยเท่านั้น (route หลังร้าน)", () => {
  it("แบบจัดส่งกดสำเร็จตรง ๆ = 409 จนกว่าจะจัดส่งเรียบร้อย · รับเองปิดได้", async () => {
    const { assertShopMayComplete } = await import("@/lib/orderLifecycle");
    const web = { order_no: "ORD-20261028-MMC001", order_type: "delivery", delivery_status: "shipping" };
    expect(() => assertShopMayComplete(web, { order_status: "completed" }, "ออเดอร์")).toThrow(/จัดส่งเรียบร้อย/);
    expect(() => assertShopMayComplete(web, { order_status: "ready" }, "ออเดอร์")).not.toThrow();
    expect(() => assertShopMayComplete({ ...web, delivery_status: "delivered" }, { order_status: "completed" }, "ออเดอร์")).not.toThrow();
    expect(() => assertShopMayComplete({ preorder_no: "PRE-1", order_type: "delivery" }, { order_status: "completed" }, "พรีออเดอร์")).toThrow();
    expect(() => assertShopMayComplete({ order_no: "ORD-1", order_type: "takeaway" }, { order_status: "completed" }, "ออเดอร์")).not.toThrow();
  });
});
