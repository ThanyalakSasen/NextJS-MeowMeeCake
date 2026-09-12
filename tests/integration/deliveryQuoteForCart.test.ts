import { describe, it, expect } from "vitest";
import * as deliveryService from "@/services/deliveryService";
import * as cartService from "@/services/cartService";
import { makeUser, makeProduct } from "./helpers";

/**
 * BACKLOG §3.4 — integration tests เพิ่ม: deliveryService.quoteForCart
 * ต่างจาก calcDeliveryFee (มีเทส unit อยู่แล้วน่าจะเป็นไปได้) ตรงที่ subtotal ไม่ได้รับมาตรง ๆ
 * แต่ดึงจากตะกร้าจริงของ user ผ่าน cartService.getCartDetail — เทสนี้ยืนยัน wiring ตรงนั้น
 */
describe("deliveryService.quoteForCart", () => {
  it("ตะกร้าว่าง + จังหวัดต่างจังหวัด → คิดค่าส่งจาก subtotal=0 (ไม่ถึงฟรีส่ง)", async () => {
    const user = await makeUser();

    const quote = await deliveryService.quoteForCart(String(user._id), { province: "เชียงใหม่" });

    expect(quote.free).toBe(false);
    expect(quote.zone).toBe("ต่างจังหวัด");
    expect(quote.fee).toBeGreaterThan(0);
  });

  it("มีของในตะกร้า ยอดไม่ถึงเกณฑ์ฟรีส่ง + จังหวัดกรุงเทพฯ → โซนเมโทร", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100 });
    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 2 });

    const quote = await deliveryService.quoteForCart(String(user._id), {
      province: "กรุงเทพมหานคร",
    });

    expect(quote.free).toBe(false);
    expect(quote.zone).toBe("กรุงเทพฯ และปริมณฑล");
  });

  it("subtotal ในตะกร้าถึงเกณฑ์ฟรีส่ง (FREE_SHIPPING_MIN) → free=true, fee=0 ไม่ว่าจังหวัดไหน", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: deliveryService.FREE_SHIPPING_MIN });
    await cartService.addItem(String(user._id), { product_id: String(p._id), quantity: 1 });

    const quote = await deliveryService.quoteForCart(String(user._id), { province: "เชียงใหม่" });

    expect(quote.free).toBe(true);
    expect(quote.fee).toBe(0);
  });

  it("ไม่ระบุ province (null) → ตกโซน catch-all ต่างจังหวัด ไม่ throw", async () => {
    const user = await makeUser();

    const quote = await deliveryService.quoteForCart(String(user._id), { province: null });

    expect(quote.zone).toBe("ต่างจังหวัด");
  });
});
