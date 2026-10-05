import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import roleModel from "@/models/roleModel";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import preorderItemModel from "@/models/preorderItemModel";
import reviewModel from "@/models/reviewModel";
import productModel from "@/models/productModel";
import aspectModel from "@/models/aspectModel";
import * as reviewService from "@/services/reviewService";
import * as moderation from "@/services/reviewModerationService";
import * as pointsService from "@/services/pointsService";
import * as orderService from "@/services/orderService";
import { aspectService, listActiveAspects, reorderAspects } from "@/services/sentimentService";
import { parsePagination } from "@/lib/queryParams";
import { runReviewMigration } from "../../scripts/migrate-reviews";
import { makeUser, makeProduct, makePreorder } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** รีวิวพรีออเดอร์ · รีวิวรวม · แง่มุม · หน้าสาธารณะ · จัดการรีวิวหลังร้าน (customer-backend-merge.md §8.20) */

async function customer(name = "สมชาย ใจดี") {
  const role = await roleModel.create({ role_name: `customer-${Math.random()}`, role_type: "customer" });
  const user = await makeUser({ role_id: role._id, user_fullname: name });
  return { user, uid: String(user._id) };
}

async function paidOrder(uid: string, opts: { paid?: boolean; extraItems?: number } = {}) {
  const p = await makeProduct({ product_price: 100, product_stock_quantity: 10 });
  const order = (await orderService.createOrder(uid, {
    order_type: "takeaway",
    items: [{ product_id: String(p._id), quantity: 1 }],
  })) as { _id: unknown };
  await orderModel.updateOne(
    { _id: order._id },
    { $set: { order_status: "completed", payment_status: opts.paid === false ? "pending" : "paid" } }
  );
  const first = await orderItemModel.findOne({ order_id: order._id }).lean<{ _id: unknown }>();
  const itemIds = [String(first!._id)];
  for (let i = 0; i < (opts.extraItems ?? 0); i++) {
    const extra = await orderItemModel.create({
      order_id: order._id,
      product_id: p._id,
      product_snapshot: { product_name_th: "เค้ก", product_name_eng: "Cake" },
      quantity: 1,
      unit_price: 100,
      total_price: 100,
    });
    itemIds.push(String(extra._id));
  }
  return { productId: String(p._id), itemIds, orderId: order._id };
}

async function preorderItems(uid: string, n: number, over: Record<string, unknown> = {}) {
  const p = await makeProduct();
  const pre = await makePreorder(uid, { order_status: "completed", payment_status: "paid", ...over });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const item = await preorderItemModel.create({
      preorder_id: pre._id,
      round_item_id: new Types.ObjectId(),
      product_id: p._id,
      product_snapshot: { product_name_th: "เค้กพรี", product_name_eng: "Pre cake" },
      pickup_date: new Date(),
      quantity: 1,
      unit_price: 100,
      total_price: 100,
    });
    ids.push(String(item._id));
  }
  return { productId: String(p._id), ids, preorderId: pre._id };
}

const page = (q = "") => parsePagination(new URLSearchParams(q));

describe("รีวิวสินค้าพรีออเดอร์", () => {
  it("รีวิวได้เมื่อ completed + ชำระแล้ว · ได้แต้ม (key แยกจากออเดอร์) · 2 รายการในระบบไม่ชน index · ซ้ำ = 409", async () => {
    const c = await customer();
    const { ids, productId } = await preorderItems(c.uid, 2);
    const r1 = (await reviewService.createReview({ user_id: c.uid, preorder_item_id: ids[0], rating: 5, image: ["/a.png"] })) as any;
    expect(String(r1.preorder_order_item_id)).toBe(ids[0]);
    expect(r1.order_item_id).toBeNull();
    expect(r1.status).toBe("approved");
    await reviewService.createReview({ user_id: c.uid, preorder_item_id: ids[1], rating: 3 });
    expect(await pointsService.getBalance(c.uid)).toBe(20 + 15);
    expect((await productModel.findById(productId).lean<any>()).review_count).toBe(2);

    await expect(reviewService.createReview({ user_id: c.uid, preorder_item_id: ids[0], rating: 4 })).rejects.toMatchObject({ status: 409 });
    // ลบแล้วเขียนใหม่ได้ แต่ไม่ได้แต้มซ้ำ
    await reviewService.deleteReview(String(r1._id), { by_user_id: c.uid });
    await reviewService.createReview({ user_id: c.uid, preorder_item_id: ids[0], rating: 4 });
    expect(await pointsService.getBalance(c.uid)).toBe(35);
  });

  it("ยังไม่ชำระ / ยังไม่ completed = 400 · ของคนอื่น = 403 · ระบุทั้งสองแบบ = 400", async () => {
    const c = await customer();
    const other = await customer();
    const unpaid = await preorderItems(c.uid, 1, { payment_status: "pending" });
    const notDone = await preorderItems(c.uid, 1, { order_status: "ready" });
    const mine = await preorderItems(c.uid, 1);
    await expect(reviewService.createReview({ user_id: c.uid, preorder_item_id: unpaid.ids[0], rating: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(reviewService.createReview({ user_id: c.uid, preorder_item_id: notDone.ids[0], rating: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(reviewService.createReview({ user_id: other.uid, preorder_item_id: mine.ids[0], rating: 5 })).rejects.toMatchObject({ status: 403 });
    const o = await paidOrder(c.uid);
    await expect(
      reviewService.createReview({ user_id: c.uid, preorder_item_id: mine.ids[0], order_item_id: o.itemIds[0], rating: 5 })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("รีวิวรวมหลายชิ้น", () => {
  it("ชิ้นที่ผ่านบันทึก ชิ้นที่ไม่ผ่านคืนใน failed · ไม่ผ่านเลย = error ของชิ้นแรก", async () => {
    const c = await customer();
    const o = await paidOrder(c.uid, { extraItems: 1 });
    await reviewService.createReview({ user_id: c.uid, order_item_id: o.itemIds[1], rating: 4 });
    const res = await reviewService.createReviews(c.uid, "order", [o.itemIds[0], o.itemIds[1], o.itemIds[0]], { rating: 5, review_text: "อร่อย" });
    expect(res.data).toHaveLength(1);
    expect(res.failed).toEqual([{ item_id: o.itemIds[1], message: "รายการนี้ถูกรีวิวไปแล้ว" }]);
    await expect(reviewService.createReviews(c.uid, "order", [o.itemIds[1]], { rating: 5 })).rejects.toMatchObject({ status: 409 });
  });
});

describe("แง่มุมรีวิว (ชอบ / ควรปรับปรุง)", () => {
  it("seed ชุดเริ่มต้น · เก็บเฉพาะแง่มุมที่เปิดใช้งาน ชื่อจาก DB · แก้ชื่อไทย → รีวิวเดิมเปลี่ยนตาม · ชื่อซ้ำ = 409 · จัดลำดับ", async () => {
    const active = await listActiveAspects();
    expect(active.map((a) => a.aspect_name_th)).toEqual(["ราคา", "รสชาติ", "บรรจุภัณฑ์", "อื่นๆ"]);
    expect(active[0].icon).toBe("wallet");
    const [price, taste] = active;
    await aspectModel.updateOne({ _id: taste._id }, { $set: { is_active: false } });

    const c = await customer();
    const o = await paidOrder(c.uid);
    const r = (await reviewService.createReview({
      user_id: c.uid,
      order_item_id: o.itemIds[0],
      rating: 4,
      aspect_feedback: [
        { aspect_id: price._id, sentiment: "positive" },
        { aspect_id: price._id, sentiment: "negative" },
        { aspect_id: taste._id, sentiment: "negative" },
      ],
    })) as any;
    expect(r.aspect_feedback).toEqual([{ aspect_id: expect.anything(), aspect_name_th: "ราคา", sentiment: "positive" }]);

    await aspectService.update(price._id, { aspect_name_th: "ความคุ้มค่า" });
    const saved = await reviewModel.findById(r._id).lean<any>();
    expect(saved.aspect_feedback[0].aspect_name_th).toBe("ความคุ้มค่า");
    await expect(aspectService.create({ aspect_name_th: " ความคุ้มค่า " })).rejects.toMatchObject({ status: 409 });
    const added = await aspectService.create({ aspect_name_th: "บริการ" });
    expect(added.aspect_name_eng).toBe("บริการ");
    expect(added.display_order).toBe(4);

    const ordered = (await reorderAspects([String(added._id), price._id])) as any[];
    expect(ordered.slice(0, 2).map((a) => a.aspect_name_th)).toEqual(["บริการ", "ความคุ้มค่า"]);
  });
});

describe("หน้าสาธารณะ", () => {
  it("ไม่มีข้อมูลภายใน · ชื่อปิดบางส่วน · ปักหมุดก่อน · มีคำตอบร้าน · ซ่อนแล้วไม่แสดง · เอกสารเก่าไม่มี status ยังแสดง", async () => {
    const c = await customer("สมชาย ใจดี");
    const o = await paidOrder(c.uid, { extraItems: 2 });
    const staff = await makeUser();
    const [a, b, hidden] = await Promise.all(
      o.itemIds.map((id, i) => reviewService.createReview({ user_id: c.uid, order_item_id: id, rating: 5 - i }) as Promise<any>)
    );
    await moderation.moderateReview(String(b._id), { is_pinned: true, shop_reply_text: "ขอบคุณค่ะ", internal_note_text: "ลับ", internal_tags: ["#ครัว"] }, String(staff._id));
    await moderation.moderateReview(String(hidden._id), { status: "hidden" }, String(staff._id));
    await reviewModel.collection.updateOne({ _id: a._id }, { $unset: { status: "" } }); // เอกสารเก่าของหลัก

    const { items, meta } = await reviewService.listPublicReviews({ productId: o.productId, pagination: page() });
    expect(meta.total).toBe(2);
    expect(items.map((r) => r._id)).toEqual([String(b._id), String(a._id)]);
    expect(items[0]).toMatchObject({ is_pinned: true, shop_reply: { text: "ขอบคุณค่ะ" }, reviewer_name: "K. สมช***", user_id: { user_fullname: "K. สมช***" } });
    const json = JSON.stringify(items);
    for (const secret of ["ลับ", "#ครัว", "internal", "read_by"]) expect(json).not.toContain(secret);
    expect((await reviewService.getProductReviewSummary(o.productId)).count).toBe(2);
    expect((await productModel.findById(o.productId).lean<any>()).review_count).toBe(2);

    const own = await reviewService.listReviews({ pagination: page(), user_id: c.uid, ownOnly: true });
    expect(JSON.stringify(own.items)).not.toContain("ลับ");
  });
});

describe("จัดการรีวิวหลังร้าน", () => {
  it("ตอบกลับ = อ่านแล้ว · แท็ก/โน้ต · ซ่อน→คำนวณคะแนนใหม่ · อ่านแล้วหลายรายการ · ไม่มีอะไรให้แก้ = 400", async () => {
    const c = await customer();
    const o = await paidOrder(c.uid, { extraItems: 1 });
    const staff = String((await makeUser())._id);
    const r1 = (await reviewService.createReview({ user_id: c.uid, order_item_id: o.itemIds[0], rating: 1 })) as any;
    const r2 = (await reviewService.createReview({ user_id: c.uid, order_item_id: o.itemIds[1], rating: 5 })) as any;

    const replied = await moderation.moderateReview(String(r1._id), { shop_reply_text: "  ขออภัยค่ะ ", internal_tags: ["a", "a", " b "] }, staff);
    expect(replied.shop_reply.text).toBe("ขออภัยค่ะ");
    expect(replied.read_at).toBeTruthy();
    expect(replied.internal_tags).toEqual(["a", "b"]);
    const noted = await moderation.moderateReview(String(r1._id), { internal_note_text: "" }, staff);
    expect(noted.internal_note).toBeNull();

    const hidden = await moderation.moderateReview(String(r2._id), { status: "hidden" }, staff);
    expect(hidden).toMatchObject({ status: "hidden", is_visible: false });
    expect((await productModel.findById(o.productId).lean<any>()).review_count).toBe(1);
    const shown = await reviewService.setReviewVisibility(String(r2._id), true);
    expect(shown).toMatchObject({ status: "approved", is_visible: true });

    await expect(moderation.moderateReview(String(r1._id), {}, staff)).rejects.toMatchObject({ status: 400 });
    await expect(moderation.moderateReview(String(r1._id), { status: "gone" }, staff)).rejects.toMatchObject({ status: 400 });
    expect(await moderation.bulkMarkRead({ ids: [String(r2._id)], action: "mark_read" }, staff)).toEqual({ matched: 1, modified: 1 });
    await expect(moderation.bulkMarkRead({ ids: ["x"], action: "mark_read" }, staff)).rejects.toMatchObject({ status: 400 });
  });

  it("กรอง/เรียง/สรุป: ยังไม่ตอบ · พรีออเดอร์ · ควรตอบก่อน · summary · ค่าผิด = 400 · ตัวเลือกตัวกรอง", async () => {
    const c = await customer();
    const staff = String((await makeUser())._id);
    const o = await paidOrder(c.uid, { extraItems: 2 });
    const pre = await preorderItems(c.uid, 1);
    const good = (await reviewService.createReview({ user_id: c.uid, order_item_id: o.itemIds[0], rating: 5, review_text: "อร่อยมาก" })) as any;
    const badReplied = (await reviewService.createReview({ user_id: c.uid, order_item_id: o.itemIds[1], rating: 1 })) as any;
    const badOpen = (await reviewService.createReview({ user_id: c.uid, order_item_id: o.itemIds[2], rating: 2 })) as any;
    const preR = (await reviewService.createReview({ user_id: c.uid, preorder_item_id: pre.ids[0], rating: 4 })) as any;
    await moderation.moderateReview(String(badReplied._id), { shop_reply_text: "ขออภัย" }, staff);

    const list = (q: string) => moderation.listAdminReviews(new URLSearchParams(q), page(q));
    expect((await list("replied=0")).items.map((r) => String(r._id)).sort()).toEqual([good, badOpen, preR].map((r) => String(r._id)).sort());
    const preList = await list("order_kind=preorder");
    expect(preList.items).toHaveLength(1);
    expect(preList.items[0].preorder_order_item_id.preorder_id.preorder_no).toMatch(/^PRE-TEST/);
    expect((await list("sort=needs_reply")).items.map((r) => String(r._id)).slice(0, 2)).toEqual([String(badOpen._id), String(preR._id)]);
    expect((await list("q=อร่อย")).items).toHaveLength(1);
    const summary = (await list("summary=1&sentiment_group=negative")).summary!;
    expect(summary).toMatchObject({ count: 2, negative_rate: 1, unreplied_negative: 1 });
    for (const q of ["status=x", "rating=6", "sort=x", "replied=maybe", "order_kind=x", "since=nope"]) {
      await expect(list(q)).rejects.toMatchObject({ status: 400 });
    }

    const options = await moderation.getFilterOptions();
    expect(options.products.length).toBe(2);
    expect(options.reply_suggestions).toEqual([{ text: "ขออภัย", used_count: 1, rating_avg: 1 }]);
  });
});

describe("migrate-reviews", () => {
  it("เติม status ให้เอกสารเก่า (hidden ตาม is_visible) · dry-run ไม่เขียน · รันซ้ำได้", async () => {
    const c = await customer();
    const o = await paidOrder(c.uid, { extraItems: 1 });
    const [a, b] = await Promise.all(
      o.itemIds.map((id) => reviewService.createReview({ user_id: c.uid, order_item_id: id, rating: 5 }) as Promise<any>)
    );
    await reviewModel.collection.updateMany({ _id: { $in: [a._id, b._id] } }, { $unset: { status: "" } });
    await reviewModel.collection.updateOne({ _id: b._id }, { $set: { is_visible: false } });

    const dry = await runReviewMigration({ backupDir: "scripts/backups/test" });
    expect(dry).toMatchObject({ dryRun: true, missingStatus: { approved: 1, hidden: 1 }, statusFilled: 0 });
    const applied = await runReviewMigration({ apply: true, backupDir: "scripts/backups/test" });
    expect(applied).toMatchObject({ statusFilled: 2, createdIndexes: true });
    expect((await reviewModel.findById(b._id).lean<any>()).status).toBe("hidden");
    expect((await runReviewMigration({ apply: true, backupDir: "scripts/backups/test" })).statusFilled).toBe(0);
  });
});
