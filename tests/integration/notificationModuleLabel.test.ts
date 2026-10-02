import { describe, it, expect, vi, afterEach } from "vitest";
import notificationModel from "@/models/notificationModel";
import {
  notificationService,
  notificationModuleLabel,
  notificationLineUrl,
  parseNotificationModule,
} from "@/services/notificationService";

/**
 * module เก็บใน DB เป็นภาษาอังกฤษ (enum ของ notificationModel / ใช้กรอง) — แสดงผลเป็นภาษาไทยผ่าน
 * module_label ใน response และหัวข้อความ LINE
 */

vi.mock("@/lib/line", () => ({ pushLineMessage: vi.fn(async () => ({ ok: true })) }));
import { pushLineMessage } from "@/lib/line";

afterEach(() => {
  vi.mocked(pushLineMessage).mockClear();
  delete process.env.ADMIN_APP_URL;
});

describe("notification module → ป้ายภาษาไทยตอนแสดงผล", () => {
  it("notify: DB เก็บ key อังกฤษ · response มี module_label · LINE ขึ้นป้ายไทย", async () => {
    const res = (await notificationService.notify({
      title: "ทดสอบ",
      message: "ข้อความ",
      module: "order",
      type: "info",
    })) as { _id: unknown; module: string; module_label: string };

    expect(res.module).toBe("order");
    expect(res.module_label).toBe("คำสั่งซื้อ");
    expect((await notificationModel.findById(res._id).lean<{ module: string }>())!.module).toBe("order");
    expect(vi.mocked(pushLineMessage).mock.calls[0][0]).toMatch(/^\[คำสั่งซื้อ\] ทดสอบ/);
  });

  it("list / getById คืน module_label ทุกแถว", async () => {
    await notificationService.notify({ title: "a", message: "m", module: "production", type: "info", line: false });
    await notificationService.notify({ title: "b", message: "m", module: "finance", type: "info", line: false });
    const { items } = (await notificationService.list({
      pagination: { page: 1, limit: 20, skip: 0 },
    } as Parameters<typeof notificationService.list>[0])) as { items: Array<{ _id: unknown; module_label: string }> };
    expect(items.map((i) => i.module_label).sort()).toEqual(["การผลิต", "การเงิน"].sort());
    const one = (await notificationService.getById(String(items[0]._id))) as { module_label: string };
    expect(one.module_label).toBeTruthy();
  });

  it("เอกสารเก่าที่ module = employee (เลิกใช้แล้ว) → ยังอ่าน/ทำเครื่องหมายอ่านได้ และแสดงป้ายไทย", async () => {
    const legacy = await notificationModel.collection.insertOne({
      title: "เก่า", message: "m", module: "employee", type: "info", is_read: false, deleted_at: null, created_at: new Date(),
    });
    const id = String(legacy.insertedId);
    expect(((await notificationService.getById(id)) as { module_label: string }).module_label).toBe("พนักงาน");
    const updated = (await notificationService.update(id, { is_read: true })) as { is_read: boolean };
    expect(updated.is_read).toBe(true);
    await expect(
      notificationService.notify({ title: "x", message: "m", module: "employee" as never, type: "info", line: false })
    ).rejects.toThrow();
  });

  it("ตัวช่วยแปลง: key ↔ ป้ายไทย", () => {
    expect(notificationModuleLabel("system")).toBe("อื่น ๆ");
    expect(notificationModuleLabel("unknown")).toBe("unknown");
    expect(notificationModuleLabel("employee")).toBe("พนักงาน"); // ค่าเลิกใช้ในเอกสารเก่า
    expect(parseNotificationModule("คำสั่งซื้อ")).toBe("order");
    expect(parseNotificationModule("ingredient")).toBe("ingredient");
    expect(parseNotificationModule("ไม่มี")).toBeNull();
  });

  it("ADMIN_APP_URL ตั้งไว้ → ข้อความ LINE แนบลิงก์เต็มไปหน้าที่เกี่ยวข้อง (LINE.md §9.12)", async () => {
    process.env.ADMIN_APP_URL = "https://app.example.com/";
    await notificationService.notify({
      title: "ออเดอร์ใหม่ ORD-20261002-AAAAAA",
      message: "ยอดรวม 105 บาท",
      module: "order",
      type: "info",
      link: "/owner/orders/manageOrders?id=abc123",
    });
    expect(vi.mocked(pushLineMessage).mock.calls[0][0]).toBe(
      "[คำสั่งซื้อ] ออเดอร์ใหม่ ORD-20261002-AAAAAA\nยอดรวม 105 บาท\n🔗 https://app.example.com/owner/orders/manageOrders?id=abc123"
    );
  });

  it("ไม่ตั้ง ADMIN_APP_URL / ไม่มี link → ข้อความเหมือนเดิม · sub-path ของ base ไม่หาย · http(s) ใช้ตรง ๆ", async () => {
    await notificationService.notify({ title: "t", message: "m", module: "order", type: "info", link: "/owner/x" });
    expect(vi.mocked(pushLineMessage).mock.calls[0][0]).not.toContain("🔗");

    process.env.ADMIN_APP_URL = "https://shop.example.com/admin";
    expect(notificationLineUrl(null)).toBeNull();
    expect(notificationLineUrl("/owner/products")).toBe("https://shop.example.com/admin/owner/products");
    expect(notificationLineUrl("https://other.example.com/x")).toBe("https://other.example.com/x");
    expect(notificationLineUrl("owner/no-slash")).toBeNull();
  });
});
