import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { saveImages, deleteImages } from "@/lib/upload";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);

function pngBuffer(size = 20): Buffer {
  const buf = Buffer.alloc(Math.max(size, PNG_SIG.length + 4));
  PNG_SIG.copy(buf, 0);
  return buf;
}

function makeFile(buf: Buffer, name: string, type = "image/png"): File {
  return new File([new Uint8Array(buf)], name, { type });
}

let usedDirs: string[] = [];
function testDir(): string {
  const dir = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  usedDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    usedDirs.map((d) =>
      rm(join(process.cwd(), "public", "uploads", d), { recursive: true, force: true })
    )
  );
  usedDirs = [];
});

/**
 * BACKLOG §3.13/§3.14 — object storage abstraction (localDisk driver ดีฟอลต์) + ลบไฟล์ที่ไม่ใช้
 * ทดสอบเฉพาะ localDisk (ดีฟอลต์เมื่อไม่ตั้ง env UPLOAD_DRIVER) — s3 driver ต้องมี credential จริง
 * ทดสอบผ่าน integration/manual เท่านั้น ไม่ครอบใน unit test
 */
describe("upload.saveImages — localDisk driver (ดีฟอลต์)", () => {
  it("บันทึกไฟล์รูปที่ถูกต้อง → คืน url ที่ /uploads/<dir>/... และไฟล์มีอยู่จริงบนดิสก์", async () => {
    const dir = testDir();
    const [saved] = await saveImages([makeFile(pngBuffer(), "photo.png")], dir);

    expect(saved.url).toMatch(new RegExp(`^/uploads/${dir}/.+\\.png$`));
    const diskPath = join(process.cwd(), "public", saved.url.replace(/^\//, ""));
    expect(existsSync(diskPath)).toBe(true);
  });

  it("ไฟล์ใหญ่เกิน 5MB → badRequest", async () => {
    const dir = testDir();
    const big = pngBuffer(5 * 1024 * 1024 + 1);
    await expect(saveImages([makeFile(big, "big.png")], dir)).rejects.toThrow(/ใหญ่เกิน/);
  });

  it("นามสกุลไฟล์ไม่รองรับ (.txt) → badRequest แม้เนื้อหาจะเป็นรูปจริง", async () => {
    const dir = testDir();
    await expect(
      saveImages([makeFile(pngBuffer(), "notes.txt")], dir)
    ).rejects.toThrow(/นามสกุลไฟล์ไม่รองรับ/);
  });

  it("นามสกุลถูกแต่เนื้อหาไม่ใช่รูปจริง (magic bytes ไม่ตรง) → badRequest", async () => {
    const dir = testDir();
    const fake = Buffer.alloc(20, 0x00);
    await expect(saveImages([makeFile(fake, "fake.png")], dir)).rejects.toThrow(
      /ไม่ใช่รูปภาพที่รองรับ/
    );
  });

  it("ส่งเกิน 8 ไฟล์ต่อครั้ง → badRequest", async () => {
    const dir = testDir();
    const files = Array.from({ length: 9 }, (_, i) => makeFile(pngBuffer(), `f${i}.png`));
    await expect(saveImages(files, dir)).rejects.toThrow(/สูงสุด/);
  });

  it("รองรับ JPEG ด้วย (ตรวจจากลายเซ็นจริง ไม่ใช่นามสกุล)", async () => {
    const dir = testDir();
    const buf = Buffer.alloc(20);
    JPEG_SIG.copy(buf, 0);
    const [saved] = await saveImages([makeFile(buf, "photo.jpg", "image/jpeg")], dir);
    expect(saved.url).toMatch(/\.jpg$/);
  });
});

describe("upload.deleteImages — best-effort, ไม่ throw", () => {
  it("ลบไฟล์ที่เพิ่งบันทึกไว้ → ไฟล์หายจากดิสก์จริง", async () => {
    const dir = testDir();
    const [saved] = await saveImages([makeFile(pngBuffer(), "to-delete.png")], dir);
    const diskPath = join(process.cwd(), "public", saved.url.replace(/^\//, ""));
    expect(existsSync(diskPath)).toBe(true);

    await deleteImages([saved.url]);
    expect(existsSync(diskPath)).toBe(false);
  });

  it("ลบ url ที่ไฟล์ไม่มีอยู่จริงอยู่แล้ว (ENOENT) → ไม่ throw", async () => {
    await expect(deleteImages(["/uploads/nonexistent-dir/nope.png"])).resolves.toBeUndefined();
  });

  it("url รูปแบบแปลกปลอม (พยายาม path traversal) → ไม่ throw, ไม่ทำอะไร (regex ไม่ match)", async () => {
    await expect(
      deleteImages(["/uploads/../../etc/passwd", "/uploads/a/b/c/d.png", "not-a-path"])
    ).resolves.toBeUndefined();
  });
});
