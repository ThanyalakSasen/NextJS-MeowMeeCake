import { describe, it, expect } from "vitest";
import reviewModel from "@/models/reviewModel";
import * as reviewService from "@/services/reviewService";
import { makeUser, makeProduct, oid } from "./helpers";

/** หน้า "รีวิวของฉัน" (ลูกค้า) — GET /api/shop/reviews → reviewService.listReviews({ ownOnly: true }) */
describe("รีวิวของฉัน + คำตอบจากร้าน", () => {
  it("เห็นคำตอบร้าน (ข้อความ + เวลา) + รูปสินค้า · ไม่เห็นผู้ตอบ/ข้อมูลภายใน · เห็นเฉพาะของตัวเอง", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const staff = await makeUser();
    const p = await makeProduct({ product_img: ["/uploads/products/cake.png"] });
    const repliedAt = new Date("2026-10-10T03:00:00Z");
    await reviewModel.create({
      user_id: me._id, product_id: p._id, order_item_id: oid(), rating: 4, review_text: "อร่อย",
      status: "approved", is_visible: true,
      shop_reply: { text: "ขอบคุณค่ะ", replied_at: repliedAt, replied_by: staff._id },
      internal_note: { text: "ลูกค้าประจำ", updated_at: new Date(), updated_by: staff._id },
    });
    await reviewModel.create({ user_id: me._id, product_id: p._id, order_item_id: oid(), rating: 5, status: "approved" });
    await reviewModel.create({ user_id: other._id, product_id: p._id, order_item_id: oid(), rating: 1, status: "approved" });

    const { items } = await reviewService.listReviews({
      pagination: { page: 1, limit: 50, skip: 0 },
      user_id: String(me._id),
      ownOnly: true,
    });
    expect(items).toHaveLength(2);
    const replied = (items as any[]).find((r) => r.review_text === "อร่อย"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(replied.shop_reply).toEqual({ text: "ขอบคุณค่ะ", replied_at: repliedAt });
    expect(replied.product_id.product_img).toEqual(["/uploads/products/cake.png"]);
    expect(replied.internal_note).toBeUndefined();
    const notReplied = (items as any[]).find((r) => r.rating === 5); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(notReplied.shop_reply ?? null).toBeNull();
  });
});
