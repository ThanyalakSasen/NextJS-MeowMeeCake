import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import storeProfileModel from "@/models/storeProfileModel";
import * as storeService from "@/services/storeService";
import { getActivePickupLocations } from "@/services/shippingService";
import type { SessionUser } from "@/lib/session";
import { makeUser } from "./helpers";

/** หน้าร้านหลัก (is_main) — ไม่หายเมื่อบันทึก · อยู่ลำดับแรกเสมอ · ข้อมูลเก่าที่ไม่มีธงเดาให้ */

const m = (name: string, over: Record<string, unknown> = {}) => ({
  name, location: "", days: ["mon"], open_time: "09:00", close_time: "18:00", map_url: "", is_active: true, ...over,
});

async function owner(): Promise<SessionUser> {
  const role = await roleModel.create({ role_name: `owner-${Math.random()}`, role_type: "owner" });
  const u = await makeUser({ role_id: role._id });
  return { user_id: String(u._id), role_id: String(role._id), role_type: "owner", email: u.email, source: "jwt", auth_time: Date.now() };
}

describe("หน้าร้านหลัก", () => {
  it("ข้อมูลเก่าไม่มีธง: รายการชื่อ 'หน้าร้าน…' ถูกตั้งเป็นหลักและย้ายมาลำดับแรก", async () => {
    await storeProfileModel.create({ business_hours_migrated: true, weekly_markets: [m("ถนนคนเดิน"), m("หน้าร้าน เหมียวมีเค้ก")] });
    const info = await storeService.getPublicStoreInfo();
    expect(info.weekly_markets.map((x) => [x.name, x.is_main])).toEqual([["หน้าร้าน เหมียวมีเค้ก", true], ["ถนนคนเดิน", false]]);
    expect((await getActivePickupLocations())[0].name).toBe("หน้าร้าน เหมียวมีเค้ก");
  });

  it("บันทึกจากหน้าที่ไม่ส่ง is_main → ธงเดิมไม่หาย · วัน-เวลาที่แก้ติด · ตั้งหลักใหม่ได้ (หลักเดียว อยู่ลำดับแรก)", async () => {
    const session = await owner();
    await storeProfileModel.create({ business_hours_migrated: true, weekly_markets: [m("หน้าร้านใหญ่", { is_main: true }), m("ตลาดเช้า")] });
    const { weekly_markets: saved } = await storeService.getWeeklyMarkets();
    const ids = saved.map((x: { _id: unknown }) => String(x._id));

    // ไม่ส่ง is_main (client รุ่นเก่า — m() ไม่มี field นี้) + สลับลำดับ + แก้เวลา
    const res = await storeService.updateWeeklyMarkets(session, {
      weekly_markets: [
        { _id: ids[1], ...m("ตลาดเช้า") },
        { _id: ids[0], ...m("หน้าร้านใหญ่", { days: ["tue", "wed"], open_time: "10:00", close_time: "19:00" }) },
      ],
    });
    expect(res.weekly_markets[0]).toMatchObject({ name: "หน้าร้านใหญ่", is_main: true, days: ["tue", "wed"], open_time: "10:00", close_time: "19:00" });
    expect(res.weekly_markets[1]).toMatchObject({ name: "ตลาดเช้า", is_main: false });

    // ตั้งตลาดเช้าเป็นหลัก (ส่งธงซ้ำ 2 แห่ง = ใช้แห่งแรกที่ติดธง)
    const res2 = await storeService.updateWeeklyMarkets(session, {
      weekly_markets: [
        { _id: ids[0], ...m("หน้าร้านใหญ่", { is_main: false }) },
        { _id: ids[1], ...m("ตลาดเช้า", { is_main: true }) },
      ],
    });
    expect(res2.weekly_markets.map((x: { name: string; is_main: boolean }) => [x.name, x.is_main])).toEqual([["ตลาดเช้า", true], ["หน้าร้านใหญ่", false]]);
  });
});
