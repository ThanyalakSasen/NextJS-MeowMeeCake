import { describe, it, expect, afterEach } from "vitest";
import { isUploadedUrl, UPLOAD_DIRS } from "@/lib/upload";

/** docs/uploads.md — ฟิลด์รูปที่ต้องเป็นไฟล์ของระบบเท่านั้น (banner_img / slip_image_url / receipt_url) */

const ORIGINAL = { driver: process.env.UPLOAD_DRIVER, base: process.env.S3_PUBLIC_URL_BASE };
afterEach(() => {
  if (ORIGINAL.driver === undefined) delete process.env.UPLOAD_DRIVER;
  else process.env.UPLOAD_DRIVER = ORIGINAL.driver;
  if (ORIGINAL.base === undefined) delete process.env.S3_PUBLIC_URL_BASE;
  else process.env.S3_PUBLIC_URL_BASE = ORIGINAL.base;
});

describe("isUploadedUrl — localDisk (ค่าเริ่มต้น)", () => {
  it("รับเฉพาะ /uploads/<dir>/<ไฟล์> ของโฟลเดอร์ที่ถาม", () => {
    delete process.env.UPLOAD_DRIVER;
    expect(isUploadedUrl("/uploads/slips/1700000000000-abcdef012345.jpg", UPLOAD_DIRS.slips)).toBe(true);
    expect(isUploadedUrl("/uploads/banners/1700000000000-abcdef012345.png", UPLOAD_DIRS.banners)).toBe(true);
    expect(isUploadedUrl("/uploads/receipts/x.webp", UPLOAD_DIRS.receipts)).toBe(true);
  });

  it("ปฏิเสธ: โฟลเดอร์อื่น / url ภายนอก / base64 / ชื่อไฟล์ลอย ๆ / path traversal / ค่าที่ไม่ใช่ string", () => {
    delete process.env.UPLOAD_DRIVER;
    const bad = [
      "/uploads/banners/a.jpg", // คนละโฟลเดอร์กับ slips
      "/uploads/slip-6a4e07cbffad32a5a87bba90-1787718975936.jpg", // แบบที่ค้างใน DB จริง (ไม่มีโฟลเดอร์)
      "https://x/slip.jpg",
      "data:image/png;base64,AAAA",
      "02cae48b-7242-4989-bbee-7e7831e007db.jpg", // ใบเสร็จแบบที่ค้างใน DB จริง
      "/uploads/slips/../banners/a.jpg",
      "/uploads/slips/sub/a.jpg",
      "/uploads/slips/",
    ];
    for (const u of bad) expect(isUploadedUrl(u, UPLOAD_DIRS.slips), u).toBe(false);
    expect(isUploadedUrl(null, UPLOAD_DIRS.slips)).toBe(false);
    expect(isUploadedUrl(123, UPLOAD_DIRS.slips)).toBe(false);
  });
});

describe("isUploadedUrl — s3", () => {
  it("รับ <S3_PUBLIC_URL_BASE>/<dir>/<ไฟล์> · ไม่ตั้ง base → false เสมอ", () => {
    process.env.UPLOAD_DRIVER = "s3";
    process.env.S3_PUBLIC_URL_BASE = "https://cdn.example.com/";
    expect(isUploadedUrl("https://cdn.example.com/slips/a.jpg", UPLOAD_DIRS.slips)).toBe(true);
    expect(isUploadedUrl("https://cdn.example.com/banners/a.jpg", UPLOAD_DIRS.slips)).toBe(false);
    expect(isUploadedUrl("https://evil.example.com/slips/a.jpg", UPLOAD_DIRS.slips)).toBe(false);
    expect(isUploadedUrl("/uploads/slips/a.jpg", UPLOAD_DIRS.slips)).toBe(false);
    delete process.env.S3_PUBLIC_URL_BASE;
    expect(isUploadedUrl("https://cdn.example.com/slips/a.jpg", UPLOAD_DIRS.slips)).toBe(false);
  });
});
