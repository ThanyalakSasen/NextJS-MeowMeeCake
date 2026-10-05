import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { rm, utimes } from "node:fs/promises";
import roleModel from "@/models/roleModel";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import * as reviewService from "@/services/reviewService";
import * as reviewMediaService from "@/services/reviewMediaService";
import * as pointsService from "@/services/pointsService";
import * as orderService from "@/services/orderService";
import { makeUser, makeProduct } from "./helpers";

/** รูป/วิดีโอรีวิว + แต้มรีวิว (customer-backend-merge.md §8.18) */

const REVIEW_DIR = join(process.cwd(), "public", "uploads", "reviews");
const dirExistedBefore = existsSync(REVIEW_DIR) && readdirSync(REVIEW_DIR).length > 0;
let created: string[] = [];
afterEach(async () => {
  await Promise.all(created.map((u) => rm(join(process.cwd(), "public", u), { force: true })));
  created = [];
});

const png = () => {
  const b = Buffer.alloc(20);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  return new File([new Uint8Array(b)], "a.png", { type: "image/png" });
};
const mp4 = () => {
  const b = Buffer.alloc(32);
  b.write("ftypisom", 4, "ascii");
  return new File([new Uint8Array(b)], "clip.mp4", { type: "video/mp4" });
};
const webm = () => new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])], "c.webm");

async function upload(userId: string, file: File, type: "image" | "video") {
  const r = await reviewMediaService.uploadReviewMedia(userId, file, type);
  created.push(r.url);
  return r.url;
}

async function completedOrder(paid: boolean) {
  const role = await roleModel.create({ role_name: `customer-${Math.random()}`, role_type: "customer" });
  const user = await makeUser({ role_id: role._id });
  const p = await makeProduct({ product_price: 100, product_stock_quantity: 5 });
  const order = (await orderService.createOrder(String(user._id), {
    order_type: "takeaway",
    items: [{ product_id: String(p._id), quantity: 1 }],
  })) as { _id: unknown };
  await orderModel.updateOne({ _id: order._id }, { $set: { order_status: "completed", payment_status: paid ? "paid" : "pending" } });
  const item = await orderItemModel.findOne({ order_id: order._id }).lean<{ _id: unknown }>();
  return { user, uid: String(user._id), itemId: String(item!._id) };
}

describe("ไฟล์ประกอบรีวิว", () => {
  it("อัปโหลดรูป/วิดีโอ (ตรวจลายเซ็นจริง) · ชื่อไฟล์ขึ้นต้นด้วย user id · ชนิดไม่ตรง = 400", async () => {
    const user = await makeUser();
    const uid = String(user._id);
    const img = await upload(uid, png(), "image");
    expect(img).toMatch(new RegExp(`^/uploads/reviews/${uid}-\\d+-[a-f0-9]+\\.png$`));
    expect(await upload(uid, mp4(), "video")).toMatch(/\.mp4$/);
    expect(await upload(uid, webm(), "video")).toMatch(/\.webm$/);
    await expect(reviewMediaService.uploadReviewMedia(uid, png(), "video")).rejects.toMatchObject({ status: 400 });
    await expect(reviewMediaService.uploadReviewMedia(uid, mp4(), "image")).rejects.toMatchObject({ status: 400 });
    await expect(reviewMediaService.uploadReviewMedia(uid, png(), "pdf")).rejects.toMatchObject({ status: 400 });
  });

  it("ลบไฟล์ค้าง: เฉพาะของตัวเองและยังไม่มีรีวิวอ้างถึง", async () => {
    const { uid, itemId } = await completedOrder(true);
    const other = await makeUser();
    const used = await upload(uid, png(), "image");
    const unused = await upload(uid, png(), "image");
    const othersFile = await upload(String(other._id), png(), "image");
    await reviewService.createReview({ user_id: uid, order_item_id: itemId, rating: 5, image: [used] });

    const res = await reviewMediaService.deleteOwnReviewMedia(uid, [used, unused, othersFile, "/uploads/reviews/../../x"]);
    expect(res.deleted).toEqual([unused]);
    expect(existsSync(join(process.cwd(), "public", unused))).toBe(false);
    expect(existsSync(join(process.cwd(), "public", used))).toBe(true);
    expect(existsSync(join(process.cwd(), "public", othersFile))).toBe(true);
  });

  it.skipIf(dirExistedBefore)("เก็บกวาดไฟล์ค้างเกิน 24 ชม. · ไฟล์ที่ใช้อยู่/ยังใหม่ไม่ลบ", async () => {
    const { uid, itemId } = await completedOrder(true);
    const used = await upload(uid, png(), "image");
    const oldOrphan = await upload(uid, png(), "image");
    const freshOrphan = await upload(uid, png(), "image");
    await reviewService.createReview({ user_id: uid, order_item_id: itemId, rating: 4, image: [used] });
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    for (const u of [used, oldOrphan]) await utimes(join(process.cwd(), "public", u), old, old);

    expect(await reviewMediaService.cleanupOrphanReviewMedia()).toBe(1);
    expect(existsSync(join(process.cwd(), "public", oldOrphan))).toBe(false);
    expect(existsSync(join(process.cwd(), "public", used))).toBe(true);
    expect(existsSync(join(process.cwd(), "public", freshOrphan))).toBe(true);
  });
});

describe("แต้มรีวิว", () => {
  it("ออเดอร์ชำระแล้ว: ไม่มีรูป 15 · มีรูป 20 · ครั้งเดียวต่อรายการ (ลบแล้วเขียนใหม่ไม่ได้ซ้ำ)", async () => {
    const a = await completedOrder(true);
    const r = (await reviewService.createReview({ user_id: a.uid, order_item_id: a.itemId, rating: 5 })) as { _id: unknown };
    expect(await pointsService.getBalance(a.uid)).toBe(15);
    await reviewService.deleteReview(String(r._id), { by_user_id: a.uid });
    await reviewService.createReview({ user_id: a.uid, order_item_id: a.itemId, rating: 5, image: ["/x.png"] });
    expect(await pointsService.getBalance(a.uid)).toBe(15);

    const b = await completedOrder(true);
    await reviewService.createReview({ user_id: b.uid, order_item_id: b.itemId, rating: 4, image: ["/y.png"], video: "/v.mp4" });
    expect(await pointsService.getBalance(b.uid)).toBe(20);
  });

  it("ออเดอร์ยังไม่ชำระ → รีวิวได้แต่ไม่ได้แต้ม", async () => {
    const c = await completedOrder(false);
    const review = (await reviewService.createReview({ user_id: c.uid, order_item_id: c.itemId, rating: 3 })) as { video: unknown };
    expect(review.video).toBeNull();
    expect(await pointsService.getBalance(c.uid)).toBe(0);
  });
});
