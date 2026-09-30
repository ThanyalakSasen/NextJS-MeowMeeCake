import { describe, it, expect, vi, afterEach } from "vitest";
import notificationModel from "@/models/notificationModel";
import {
  notificationService,
  notificationModuleLabel,
  parseNotificationModule,
} from "@/services/notificationService";

/**
 * module เก็บใน DB เป็นภาษาอังกฤษ (enum ของ notificationModel / ใช้กรอง) — แสดงผลเป็นภาษาไทยผ่าน
 * module_label ใน response และหัวข้อความ LINE
 */

vi.mock("@/lib/line", () => ({ pushLineMessage: vi.fn(async () => ({ ok: true })) }));
import { pushLineMessage } from "@/lib/line";

afterEach(() => vi.mocked(pushLineMessage).mockClear());

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

  it("ตัวช่วยแปลง: key ↔ ป้ายไทย", () => {
    expect(notificationModuleLabel("system")).toBe("อื่น ๆ");
    expect(notificationModuleLabel("unknown")).toBe("unknown");
    expect(parseNotificationModule("คำสั่งซื้อ")).toBe("order");
    expect(parseNotificationModule("ingredient")).toBe("ingredient");
    expect(parseNotificationModule("ไม่มี")).toBeNull();
  });
});
