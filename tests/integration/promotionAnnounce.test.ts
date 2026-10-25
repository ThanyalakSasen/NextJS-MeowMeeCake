import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import customerNotificationModel from "@/models/customerNotificationModel";
import * as promotionService from "@/services/promotionService";
import { flushBackground } from "@/lib/backgroundTasks";
import { makeUser } from "./helpers";

/** สร้างโค้ดส่วนลดใหม่ (ไม่ใช่โปรแลกแต้ม) → กระดิ่งของลูกค้าทุกคนพร้อมรหัส · ลบโค้ด = ซ่อนกระดิ่ง */

const DAY = 24 * 60 * 60 * 1000;

async function customers(n: number) {
  const role = await roleModel.create({ role_name: `customer-${Date.now()}-${Math.random()}`, role_type: "customer" });
  return Promise.all(Array.from({ length: n }, () => makeUser({ role_id: role._id })));
}

function input(over: Record<string, unknown> = {}) {
  return {
    promotion_code: "n" + Math.random().toString(36).slice(2, 8),
    promotion_name: "ลดต้อนรับ",
    discount_type: "Amount" as const,
    discount_value: 30,
    min_order_amount: 200,
    start_date: new Date(Date.now() - DAY),
    end_date: new Date(Date.now() + 10 * DAY),
    ...over,
  };
}

const noticesOf = (filter: Record<string, unknown>) =>
  customerNotificationModel.find({ ref_type: "coupon", ...filter }).lean<Array<Record<string, any>>>(); // eslint-disable-line @typescript-eslint/no-explicit-any

describe("แจ้งโค้ดส่วนลดใหม่ในกระดิ่งของลูกค้า", () => {
  it("แจ้งลูกค้าทุกคน (ไม่แจ้งพนักงาน) พร้อมรหัสตัวพิมพ์ใหญ่ · ลบโค้ด = ซ่อนกระดิ่ง", async () => {
    const custs = await customers(3);
    const staff = await makeUser();
    const promo = (await promotionService.createPromotion(input(), String(staff._id))) as { _id: unknown; promotion_code: string };
    await flushBackground();

    const notices = await noticesOf({ ref_id: promo._id });
    const ids = notices.map((n) => String(n.user_id));
    for (const c of custs) expect(ids).toContain(String(c._id));
    expect(ids).not.toContain(String(staff._id));
    expect(notices[0]).toMatchObject({ coupon_code: promo.promotion_code, type: "success", link: "/customer/product" });
    expect(notices[0].coupon_code).toBe(notices[0].coupon_code.toUpperCase());
    expect(notices[0].message).toContain("ลด 30 บาท");
    expect(notices[0].message).toContain("ขั้นต่ำ 200 บาท");

    await promotionService.deletePromotion(String(promo._id));
    expect(await customerNotificationModel.countDocuments({ ref_type: "coupon", ref_id: promo._id, deleted_at: null })).toBe(0);
  });

  it("ไม่แจ้ง: โปรแลกแต้ม · ใช้ได้เฉพาะหน้าร้าน · ปิดใช้งาน", async () => {
    await customers(1);
    const staff = await makeUser();
    for (const over of [{ points_cost: 100 }, { applicable_channels: ["instore"] }, { is_active: false }]) {
      const promo = (await promotionService.createPromotion(input(over) as never, String(staff._id))) as { _id: unknown };
      await flushBackground();
      expect(await noticesOf({ ref_id: promo._id })).toHaveLength(0);
    }
  });

  it("ยังไม่ถึงวันเริ่มใช้ → บันทึกล่วงหน้า แสดงเมื่อถึงวันเริ่ม", async () => {
    await customers(1);
    const start = new Date(Date.now() + 2 * DAY);
    const promo = (await promotionService.createPromotion(input({ start_date: start }), String((await makeUser())._id))) as { _id: unknown };
    await flushBackground();
    const [n] = await noticesOf({ ref_id: promo._id });
    expect(new Date(n.visible_at).getTime()).toBe(start.getTime());
  });
});
