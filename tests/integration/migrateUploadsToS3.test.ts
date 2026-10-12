import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUploadsToS3, type ObjectStore } from "../../scripts/migrate-uploads-to-s3";

/** docs/DEPLOY-RENDER.md §2.1 — ย้ายไฟล์ localDisk ขึ้น S3/R2 + เปลี่ยน URL ใน DB */

const BASE = "https://pub-test.r2.dev";
let root: string | null = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

function setupDisk() {
  root = mkdtempSync(join(tmpdir(), "up-s3-"));
  const pub = join(root, "public");
  const priv = join(root, "private");
  const put = (dir: string, file: string) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), Buffer.from(file));
  };
  put(pub, "products/a.jpg");
  put(pub, "banners/b.png");
  put(pub, "reviews/v.mp4");
  put(priv, "slips/s.jpg");
  return { publicRoot: pub, privateRoot: priv, backupDir: join(root, "backups") };
}

function fakeStore() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const store: ObjectStore = {
    exists: async (bucket, key) => objects.has(`${bucket}/${key}`),
    put: async (bucket, key, body, contentType) => {
      objects.set(`${bucket}/${key}`, { body, contentType });
    },
  };
  return { store, objects };
}

const col = (name: string) => mongoose.connection.db!.collection(name);
const opts = { bucket: "pub", privateBucket: "priv", publicUrlBase: `${BASE}/` };

describe("scripts/migrate-uploads-to-s3", () => {
  it("dry-run ไม่เขียน · --apply อัปโหลด + เปลี่ยน URL สาธารณะ · ไฟล์ส่วนตัวไม่เปลี่ยน URL · รันซ้ำไม่มีงาน", async () => {
    const disk = setupDisk();
    const { store, objects } = fakeStore();
    const updated = new Date("2026-09-01T00:00:00Z");
    const product = await col("products").insertOne({
      product_img: ["/uploads/products/a.jpg", "/uploads/products/missing.jpg", "https://cdn.example.com/x.jpg"],
      updated_at: updated,
    });
    const banner = await col("banners").insertOne({ banner_img: "/uploads/banners/b.png" });
    const review = await col("reviews").insertOne({ media: [{ type: "video", url: "/uploads/reviews/v.mp4" }] });
    const payment = await col("payments").insertOne({ slip_image_url: "/api/files/slips/s.jpg" });
    const expense = await col("expenses").insertOne({ receipt_url: "/uploads/receipts/r.jpg" });
    await col("userlogs").insertOne({ detail: "/uploads/products/a.jpg" });

    const dry = await runUploadsToS3({ ...opts, ...disk, store });
    expect(dry.publicFiles).toBe(3);
    expect(dry.privateFiles).toBe(1);
    expect(dry.rewritten).toBe(3);
    expect(dry.missingLocal.map((m) => m.value)).toEqual(["/uploads/products/missing.jpg"]);
    expect(dry.needsPrivateMigration.map((m) => m._id)).toEqual([String(expense.insertedId)]);
    expect(objects.size).toBe(0);
    expect((await col("banners").findOne({ _id: banner.insertedId }))!.banner_img).toBe("/uploads/banners/b.png");

    const res = await runUploadsToS3({ ...opts, ...disk, store, apply: true });
    expect(res.uploaded.sort()).toEqual(["priv/private/slips/s.jpg", "pub/banners/b.png", "pub/products/a.jpg", "pub/reviews/v.mp4"]);
    expect(objects.get("pub/reviews/v.mp4")!.contentType).toBe("video/mp4");
    expect(objects.get("pub/products/a.jpg")!.contentType).toBe("image/jpeg");
    expect(res.rewritten).toBe(3);
    expect(res.backupFile && existsSync(res.backupFile)).toBe(true);

    const p = (await col("products").findOne({ _id: product.insertedId }))!;
    expect(p.product_img).toEqual([`${BASE}/products/a.jpg`, "/uploads/products/missing.jpg", "https://cdn.example.com/x.jpg"]);
    expect((p.updated_at as Date).toISOString()).toBe(updated.toISOString());
    expect((await col("banners").findOne({ _id: banner.insertedId }))!.banner_img).toBe(`${BASE}/banners/b.png`);
    expect((await col("reviews").findOne({ _id: review.insertedId }))!.media[0].url).toBe(`${BASE}/reviews/v.mp4`);
    expect((await col("payments").findOne({ _id: payment.insertedId }))!.slip_image_url).toBe("/api/files/slips/s.jpg");
    expect((await col("expenses").findOne({ _id: expense.insertedId }))!.receipt_url).toBe("/uploads/receipts/r.jpg");
    expect((await col("userlogs").findOne({}))!.detail).toBe("/uploads/products/a.jpg");

    // รันซ้ำ = ไม่อัปโหลด ไม่เปลี่ยนอะไร (ไฟล์ส่วนตัวมีใน bucket แล้ว)
    const again = await runUploadsToS3({ ...opts, ...disk, store, apply: true });
    expect(again.uploaded).toEqual([]);
    expect(again.alreadyInBucket).toEqual(["priv/private/slips/s.jpg"]);
    expect(again.rewritten).toBe(0);
  });

  it("อัปโหลดไม่สำเร็จ → ไม่เปลี่ยน URL ของไฟล์นั้น", async () => {
    const disk = setupDisk();
    const { store } = fakeStore();
    const failing: ObjectStore = {
      exists: store.exists,
      put: async (bucket, key, body, ct) => {
        if (key === "products/a.jpg") throw new Error("boom");
        return store.put(bucket, key, body, ct);
      },
    };
    const product = await col("products").insertOne({ product_img: ["/uploads/products/a.jpg"] });
    const banner = await col("banners").insertOne({ banner_img: "/uploads/banners/b.png" });

    const res = await runUploadsToS3({ ...opts, ...disk, store: failing, apply: true });
    expect(res.failed).toEqual([{ key: "pub/products/a.jpg", error: "boom" }]);
    expect((await col("products").findOne({ _id: product.insertedId }))!.product_img).toEqual(["/uploads/products/a.jpg"]);
    expect((await col("banners").findOne({ _id: banner.insertedId }))!.banner_img).toBe(`${BASE}/banners/b.png`);
  });
});
