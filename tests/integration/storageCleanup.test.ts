import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { cleanupUnusedUploads, type CleanupStore, type StoredObject } from "@/services/storageCleanupService";

/** docs/uploads.md §7 — ลบไฟล์ใน R2 ที่ไม่มีข้อมูลใน DB อ้างถึง + เก่ากว่า N วัน */

const BASE = "https://pub-test.r2.dev";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-20T00:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY);

function fakeStore(initial: Record<string, Record<string, Date>>, failKeys: string[] = []) {
  const buckets = new Map(
    Object.entries(initial).map(([b, objs]) => [
      b,
      new Map(Object.entries(objs).map(([key, lastModified]) => [key, { key, lastModified, size: 1024 } as StoredObject])),
    ])
  );
  const store: CleanupStore = {
    async *list(bucket) {
      yield* [...(buckets.get(bucket)?.values() ?? [])];
    },
    async remove(bucket, key) {
      if (failKeys.includes(key)) throw new Error("boom");
      buckets.get(bucket)?.delete(key);
    },
  };
  const keys = (bucket: string) => [...(buckets.get(bucket)?.keys() ?? [])].sort();
  return { store, keys };
}

const col = (name: string) => mongoose.connection.db!.collection(name);
const opts = { bucket: "pub", privateBucket: "priv", now: NOW };

describe("storageCleanupService", () => {
  it("ลบเฉพาะไฟล์ที่ไม่มีใครอ้างถึง + เก่ากว่า 60 วัน · dry-run ไม่ลบ", async () => {
    await col("products").insertOne({ product_img: [`${BASE}/products/used.jpg`], deleted_at: null });
    // soft delete ยังนับว่าใช้อยู่ · โดเมนอื่น (เปลี่ยน custom domain) ก็นับ · sub-document / path รุ่นเก่า
    await col("products").insertOne({ product_img: ["https://img.shop.example/products/soft.webp"], deleted_at: new Date() });
    await col("reviews").insertOne({ media: [{ type: "video", url: `${BASE}/reviews/u1-clip.mp4` }] });
    await col("banners").insertOne({ banner_img: "/uploads/banners/legacy.png" });
    await col("payments").insertOne({ slip_image_url: "/api/files/slips/s1.jpg" });
    // อ้างถึงใน userlogs อย่างเดียว = ไม่ได้ใช้แล้ว
    await col("userlogs").insertOne({ detail: `${BASE}/products/logged.jpg` });

    const { store, keys } = fakeStore({
      pub: {
        "products/used.jpg": ago(400),
        "products/soft.webp": ago(400),
        "reviews/u1-clip.mp4": ago(400),
        "banners/legacy.png": ago(400),
        "products/orphan-old.jpg": ago(61),
        "products/logged.jpg": ago(90),
        "products/orphan-new.jpg": ago(10),
        "notes/readme.txt": ago(400),
      },
      priv: { "private/slips/s1.jpg": ago(400), "private/receipts/r-orphan.jpg": ago(70) },
    });

    const dry = await cleanupUnusedUploads({ ...opts, store });
    expect(dry.dryRun).toBe(true);
    expect(dry.deleted.sort()).toEqual(["priv/private/receipts/r-orphan.jpg", "pub/products/logged.jpg", "pub/products/orphan-old.jpg"]);
    expect(dry).toMatchObject({ scanned: 10, inUse: 5, tooNew: 1, ignored: 1, unused: 3, remaining: 0, deletedBytes: 3072 });
    expect(keys("pub")).toHaveLength(8);

    const res = await cleanupUnusedUploads({ ...opts, store, apply: true });
    expect(res.deleted).toHaveLength(3);
    expect(keys("pub")).toEqual(["banners/legacy.png", "notes/readme.txt", "products/orphan-new.jpg", "products/soft.webp", "products/used.jpg", "reviews/u1-clip.mp4"]);
    expect(keys("priv")).toEqual(["private/slips/s1.jpg"]);

    // ไฟล์ใหม่ครบ 60 วันแล้ว → รอบถัดไปลบ
    const later = await cleanupUnusedUploads({ ...opts, store, apply: true, now: NOW + 51 * DAY });
    expect(later.deleted).toEqual(["pub/products/orphan-new.jpg"]);
  });

  it("ไม่เจอการอ้างถึงเลย → หยุด ไม่ลบอะไร", async () => {
    const { store, keys } = fakeStore({ pub: { "products/a.jpg": ago(400) }, priv: {} });
    const res = await cleanupUnusedUploads({ ...opts, store, apply: true });
    expect(res.skipped).toMatch(/ไม่พบไฟล์ที่ DB อ้างถึง/);
    expect(keys("pub")).toEqual(["products/a.jpg"]);
  });

  it("ลบไม่เกิน maxDelete (เก่าสุดก่อน) · ลบไม่สำเร็จรายงาน ไม่ล้มทั้งรอบ · bucket เดียวกันไม่ไล่ซ้ำ", async () => {
    await col("products").insertOne({ product_img: [`${BASE}/products/used.jpg`] });
    const { store, keys } = fakeStore(
      { pub: { "products/used.jpg": ago(400), "products/a.jpg": ago(100), "products/b.jpg": ago(300), "private/slips/c.jpg": ago(200) } },
      ["private/slips/c.jpg"]
    );
    const res = await cleanupUnusedUploads({ ...opts, privateBucket: "pub", store, apply: true, maxDelete: 2 });
    expect(res.scanned).toBe(4);
    expect(res.unused).toBe(3);
    expect(res.remaining).toBe(1);
    expect(res.deleted).toEqual(["pub/products/b.jpg"]);
    expect(res.failed).toEqual([{ key: "pub/private/slips/c.jpg", error: "boom" }]);
    expect(keys("pub")).toEqual(["private/slips/c.jpg", "products/a.jpg", "products/used.jpg"]);
  });

  it("อายุขั้นต่ำต่ำกว่า 7 วัน → ปฏิเสธ · ไม่ใช่ s3 → ข้าม", async () => {
    await expect(cleanupUnusedUploads({ ...opts, store: fakeStore({}).store, minAgeDays: 1 })).rejects.toThrow(/7/);
    const prev = process.env.UPLOAD_DRIVER;
    delete process.env.UPLOAD_DRIVER;
    try {
      expect((await cleanupUnusedUploads({ apply: true })).skipped).toMatch(/UPLOAD_DRIVER/);
    } finally {
      if (prev !== undefined) process.env.UPLOAD_DRIVER = prev;
    }
  });
});
