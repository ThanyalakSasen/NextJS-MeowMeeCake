import { describe, it, expect } from "vitest";
import { calcDeliveryFee } from "@/services/deliveryService";

// ไม่ตั้ง env → ใช้ default: METRO=40, UPCOUNTRY=80, FREE_MIN=1500

describe("calcDeliveryFee", () => {
  it("กทม./ปริมณฑล → 40", () => {
    const q = calcDeliveryFee({ province: "กรุงเทพมหานคร", subtotal: 500 });
    expect(q.fee).toBe(40);
    expect(q.free).toBe(false);
    expect(q.zone).toMatch(/กรุงเทพ/);
  });

  it("ต่างจังหวัด → 80", () => {
    const q = calcDeliveryFee({ province: "เชียงใหม่", subtotal: 500 });
    expect(q.fee).toBe(80);
    expect(q.zone).toBe("ต่างจังหวัด");
  });

  it("ยอด ≥ 1500 → ส่งฟรี ไม่ว่าจังหวัดไหน", () => {
    expect(calcDeliveryFee({ province: "เชียงใหม่", subtotal: 1500 }).fee).toBe(0);
    expect(calcDeliveryFee({ province: "เชียงใหม่", subtotal: 1500 }).free).toBe(true);
    expect(calcDeliveryFee({ province: "กรุงเทพมหานคร", subtotal: 2000 }).fee).toBe(0);
  });

  it("normalize คำนำหน้า 'จังหวัด' / 'จ.'", () => {
    expect(calcDeliveryFee({ province: "จังหวัดนนทบุรี", subtotal: 100 }).fee).toBe(40);
    expect(calcDeliveryFee({ province: "จ. ปทุมธานี", subtotal: 100 }).fee).toBe(40);
  });

  it("ไม่ระบุจังหวัด → ต่างจังหวัด (catch-all)", () => {
    expect(calcDeliveryFee({ province: null, subtotal: 100 }).fee).toBe(80);
  });
});
