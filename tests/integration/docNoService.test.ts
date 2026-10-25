import { describe, it, expect } from "vitest";
import { nextDailyDocNo } from "@/services/docNoService";

// วันที่ปี 2033 กันชนกับตัวนับของวันจริง (DB เทสใช้ร่วมกันทั้ง suite)
const at = (iso: string) => new Date(iso);

describe("nextDailyDocNo — เลขออเดอร์รายวัน ORD-YYYYMMDD-MMCxxx", () => {
  it("เริ่ม MMC001 แล้วเพิ่มทีละ 1 ในวันเดียวกัน", async () => {
    const now = at("2033-03-01T05:00:00Z");
    expect(await nextDailyDocNo("ORD", now)).toBe("ORD-20330301-MMC001");
    expect(await nextDailyDocNo("ORD", now)).toBe("ORD-20330301-MMC002");
  });

  it("แต่ละ prefix นับแยกกัน · วันใหม่เริ่ม MMC001", async () => {
    expect(await nextDailyDocNo("POS", at("2033-03-02T05:00:00Z"))).toBe("POS-20330302-MMC001");
    expect(await nextDailyDocNo("PRE", at("2033-03-02T05:00:00Z"))).toBe("PRE-20330302-MMC001");
    expect(await nextDailyDocNo("ORD", at("2033-03-03T05:00:00Z"))).toBe("ORD-20330303-MMC001");
  });

  it("วันที่ตามเวลาไทย — 18:00 UTC = 01:00 น. ของวันถัดไป", async () => {
    expect(await nextDailyDocNo("ORD", at("2033-03-04T18:00:00Z"))).toBe("ORD-20330305-MMC001");
  });

  it("ขอพร้อมกัน 20 คำขอ (รวมคำขอแรกของวัน) → ไม่ซ้ำ ได้ 001–020 ครบ", async () => {
    const now = at("2033-03-06T05:00:00Z");
    const nos = await Promise.all(Array.from({ length: 20 }, () => nextDailyDocNo("ORD", now)));
    expect(new Set(nos).size).toBe(20);
    expect([...nos].sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `ORD-20330306-MMC${String(i + 1).padStart(3, "0")}`)
    );
  });
});
