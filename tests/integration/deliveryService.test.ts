import { describe, it, expect } from "vitest";
import { calcDeliveryFee, listZones } from "@/services/deliveryService";
import { deliveryZoneService } from "@/services/deliveryZoneService";

/**
 * BACKLOG §3.15 — delivery zone เป็น DB (ย้ายมาจาก tests/lib/deliveryService.test.ts เดิม เพราะ
 * calcDeliveryFee ตอนนี้ต้องเช็คโซนจาก DB ก่อนเสมอ ไม่ใช่ pure function แล้ว — ต้องใช้ integration
 * project (mongodb-memory-server) ทดสอบ ไม่ใช่ unit)
 */
describe("calcDeliveryFee — fallback env (ยังไม่มีโซนไหนตั้งไว้ใน DB เลย)", () => {
  it("กทม./ปริมณฑล → 40 (ค่าเริ่มต้นจาก env)", async () => {
    const q = await calcDeliveryFee({ province: "กรุงเทพมหานคร", subtotal: 500 });
    expect(q.fee).toBe(40);
    expect(q.free).toBe(false);
    expect(q.zone).toMatch(/กรุงเทพ/);
  });

  it("ต่างจังหวัด → 80", async () => {
    const q = await calcDeliveryFee({ province: "เชียงใหม่", subtotal: 500 });
    expect(q.fee).toBe(80);
    expect(q.zone).toBe("ต่างจังหวัด");
  });

  it("ยอด ≥ 1500 → ส่งฟรี ไม่ว่าจังหวัดไหน", async () => {
    expect((await calcDeliveryFee({ province: "เชียงใหม่", subtotal: 1500 })).fee).toBe(0);
    expect((await calcDeliveryFee({ province: "เชียงใหม่", subtotal: 1500 })).free).toBe(true);
    expect((await calcDeliveryFee({ province: "กรุงเทพมหานคร", subtotal: 2000 })).fee).toBe(0);
  });

  it("normalize คำนำหน้า 'จังหวัด' / 'จ.'", async () => {
    expect((await calcDeliveryFee({ province: "จังหวัดนนทบุรี", subtotal: 100 })).fee).toBe(40);
    expect((await calcDeliveryFee({ province: "จ. ปทุมธานี", subtotal: 100 })).fee).toBe(40);
  });

  it("ไม่ระบุจังหวัด → ต่างจังหวัด (catch-all)", async () => {
    expect((await calcDeliveryFee({ province: null, subtotal: 100 })).fee).toBe(80);
  });

  it("listZones() บอก source เป็น env-fallback เมื่อยังไม่มีโซนใน DB", async () => {
    const z = await listZones();
    expect(z.source).toBe("env-fallback");
    expect(z.zones.length).toBeGreaterThan(0);
  });
});

describe("calcDeliveryFee — ใช้โซนจาก DB เมื่อแอดมินตั้งไว้แล้ว (BACKLOG §3.15)", () => {
  it("มีโซนเฉพาะจังหวัด match → ใช้ค่าจาก DB แทน env", async () => {
    await deliveryZoneService.create({
      zone_name: "โซนทดสอบภาคเหนือ",
      provinces: ["เชียงใหม่", "เชียงราย"],
      fee: 120,
      sort_order: 0,
      is_active: true,
    });

    const q = await calcDeliveryFee({ province: "เชียงใหม่", subtotal: 100 });
    expect(q.fee).toBe(120);
    expect(q.zone).toBe("โซนทดสอบภาคเหนือ");
  });

  it("จังหวัดไม่ตรงโซนไหนเลย + มีโซน catch-all → ใช้ catch-all", async () => {
    await deliveryZoneService.create({
      zone_name: "โซนเฉพาะกิจ",
      provinces: ["ภูเก็ต"],
      fee: 200,
      sort_order: 0,
      is_active: true,
    });
    await deliveryZoneService.create({
      zone_name: "ทั่วไทย",
      is_catch_all: true,
      provinces: [],
      fee: 60,
      sort_order: 1,
      is_active: true,
    });

    const q = await calcDeliveryFee({ province: "ขอนแก่น", subtotal: 100 });
    expect(q.fee).toBe(60);
    expect(q.zone).toBe("ทั่วไทย");
  });

  it("จังหวัดไม่ตรงโซนไหนเลย และไม่มี catch-all → fallback env (กันคิดค่าส่งไม่ได้)", async () => {
    await deliveryZoneService.create({
      zone_name: "โซนเฉพาะกิจ",
      provinces: ["ภูเก็ต"],
      fee: 200,
      sort_order: 0,
      is_active: true,
    });

    const q = await calcDeliveryFee({ province: "ขอนแก่น", subtotal: 100 });
    expect(q.fee).toBe(80); // ตกไป FALLBACK_ZONES ต่างจังหวัด
    expect(q.zone).toBe("ต่างจังหวัด");
  });

  it("ตั้ง is_catch_all: true ที่โซนใหม่ → ปลดโซน catch-all เดิมให้อัตโนมัติ", async () => {
    const first = await deliveryZoneService.create({
      zone_name: "แรก",
      is_catch_all: true,
      fee: 50,
      sort_order: 0,
    });
    await deliveryZoneService.create({
      zone_name: "ที่สอง",
      is_catch_all: true,
      fee: 70,
      sort_order: 1,
    });

    const firstAfter = (await deliveryZoneService.getById(String(first._id))) as {
      is_catch_all: boolean;
    };
    expect(firstAfter.is_catch_all).toBe(false);

    const q = await calcDeliveryFee({ province: "ไม่มีในรายการ", subtotal: 100 });
    expect(q.fee).toBe(70); // ใช้ catch-all ล่าสุด ("ที่สอง")
  });

  it("ปิด is_active ของโซน → calcDeliveryFee มองไม่เห็นโซนนั้นอีก", async () => {
    const zone = await deliveryZoneService.create({
      zone_name: "ปิดใช้งาน",
      provinces: ["ตรัง"],
      fee: 99,
      sort_order: 0,
    });
    await deliveryZoneService.update(String(zone._id), { is_active: false });

    const q = await calcDeliveryFee({ province: "ตรัง", subtotal: 100 });
    expect(q.fee).not.toBe(99); // ตกไป fallback env แทน (ไม่มีโซน active ไหน match)
  });

  it("ลบโซน (soft delete) → calcDeliveryFee กลับไปใช้ fallback ทันที ไม่ต้องรอ cache หมดอายุ", async () => {
    const zone = await deliveryZoneService.create({
      zone_name: "จะลบ",
      provinces: ["ระยอง"],
      fee: 111,
      sort_order: 0,
    });
    expect((await calcDeliveryFee({ province: "ระยอง", subtotal: 100 })).fee).toBe(111);

    await deliveryZoneService.remove(String(zone._id));

    const q = await calcDeliveryFee({ province: "ระยอง", subtotal: 100 });
    expect(q.fee).not.toBe(111);
  });

  it("listZones() บอก source เป็น db เมื่อมีโซนตั้งไว้แล้ว", async () => {
    await deliveryZoneService.create({ zone_name: "โซน A", fee: 10, sort_order: 0 });
    const z = await listZones();
    expect(z.source).toBe("db");
  });
});
