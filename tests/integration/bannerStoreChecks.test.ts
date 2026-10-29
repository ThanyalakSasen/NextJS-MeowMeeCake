import { describe, it, expect } from "vitest";
import { bannerService } from "@/services/bannerService";
import * as storeService from "@/services/storeService";

/**
 * แบนเนอร์: วันสิ้นสุดต้องไม่ก่อนวันเริ่ม (PATCH ข้างเดียวเทียบกับค่าเดิม)
 * ข้อมูลร้าน: ชื่อร้าน / ที่อยู่ร้าน ว่างไม่ได้ (หน้าเว็บบังคับอยู่แล้ว · เดิม API ล้างได้)
 */

const BANNER = "/uploads/banners/1700000000000-dddddddddddd.jpg";
const day = (n: number) => new Date(Date.now() + n * 86_400_000);

describe("แบนเนอร์ — ช่วงวันที่", () => {
  it("create/update: end ก่อน start → 400 · ล้างช่วงวัน (null) ได้", async () => {
    const base = { banner_name: "โปร", sort_order: 1, banner_img: BANNER };
    await expect(bannerService.create({ ...base, start_date: day(5), end_date: day(1) })).rejects.toMatchObject({ status: 400 });

    const b = (await bannerService.create({ ...base, start_date: day(1), end_date: day(5) })) as { _id: unknown };
    const id = String(b._id);
    await expect(bannerService.update(id, { end_date: day(0) })).rejects.toMatchObject({ status: 400 });
    await expect(bannerService.update(id, { start_date: day(10) })).rejects.toMatchObject({ status: 400 });
    await bannerService.update(id, { end_date: day(7) });
    await bannerService.update(id, { start_date: null, end_date: null });
  });
});

describe("ข้อมูลร้าน — ห้ามว่าง", () => {
  it("ชื่อร้านว่าง → 400 · ที่อยู่ช่องไหนว่าง → 400", async () => {
    await expect(storeService.updateProfile({ store_name: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(storeService.updateSettings({ province: "" })).rejects.toMatchObject({ status: 400 });
    await expect(storeService.updateSettings({ house_no: "  " })).rejects.toMatchObject({ status: 400 });
  });
});
