import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as productService from "@/services/productService";
import { saveImages } from "@/lib/upload";
import { makeProduct } from "./helpers";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngBuffer(): Buffer {
  const buf = Buffer.alloc(20);
  PNG_SIG.copy(buf, 0);
  return buf;
}
function makeFile(name: string): File {
  return new File([new Uint8Array(pngBuffer())], name, { type: "image/png" });
}
function diskPathOf(url: string): string {
  return join(process.cwd(), "public", url.replace(/^\//, ""));
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
 * BACKLOG §3.14 — ลบรูปสินค้าที่ไม่ใช้แล้วตอน updateProduct/hardDeleteProduct
 * (ก่อนแก้ ไฟล์เหล่านี้ค้างอยู่บนดิสก์ตลอดไป ไม่มีกลไกเก็บกวาดเลย)
 */
describe("productService.updateProduct — ลบไฟล์รูปที่ถูกเอาออก (BACKLOG §3.14)", () => {
  it("แทนที่ product_img ด้วยชุดใหม่ที่มีน้อยกว่าเดิม → ไฟล์ที่หายไปถูกลบจากดิสก์ ที่เหลือยังอยู่", async () => {
    const dir = testDir();
    const [img1, img2] = await saveImages([makeFile("a.png"), makeFile("b.png")], dir);
    const product = await makeProduct({ product_img: [img1.url, img2.url] });

    expect(existsSync(diskPathOf(img1.url))).toBe(true);
    expect(existsSync(diskPathOf(img2.url))).toBe(true);

    await productService.updateProduct(String(product._id), { product_img: [img1.url] });

    expect(existsSync(diskPathOf(img1.url))).toBe(true); // ยังอยู่ในชุดใหม่ — ไม่ลบ
    expect(existsSync(diskPathOf(img2.url))).toBe(false); // ถูกเอาออก — ลบไฟล์จริง
  });

  it("อัปเดตฟิลด์อื่นโดยไม่แตะ product_img เลย → ไฟล์เดิมไม่ถูกลบ", async () => {
    const dir = testDir();
    const [img1] = await saveImages([makeFile("keep.png")], dir);
    const product = await makeProduct({ product_img: [img1.url] });

    await productService.updateProduct(String(product._id), { product_price: 999 });

    expect(existsSync(diskPathOf(img1.url))).toBe(true);
  });

  it("แทนที่ด้วย [] (ลบรูปทั้งหมด) → ไฟล์เดิมทุกไฟล์ถูกลบ", async () => {
    const dir = testDir();
    const [img1, img2] = await saveImages([makeFile("x.png"), makeFile("y.png")], dir);
    const product = await makeProduct({ product_img: [img1.url, img2.url] });

    await productService.updateProduct(String(product._id), { product_img: [] });

    expect(existsSync(diskPathOf(img1.url))).toBe(false);
    expect(existsSync(diskPathOf(img2.url))).toBe(false);
  });
});

describe("productService.hardDeleteProduct — ลบไฟล์รูปทั้งหมดของสินค้า (BACKLOG §3.14)", () => {
  it("ลบสินค้าถาวร → ไฟล์รูปทุกไฟล์ถูกลบตามไปด้วย", async () => {
    const dir = testDir();
    const [img1, img2] = await saveImages([makeFile("p.png"), makeFile("q.png")], dir);
    const product = await makeProduct({ product_img: [img1.url, img2.url] });

    await productService.hardDeleteProduct(String(product._id));

    expect(existsSync(diskPathOf(img1.url))).toBe(false);
    expect(existsSync(diskPathOf(img2.url))).toBe(false);
  });

  it("ลบสินค้าที่ไม่มีรูปเลย (product_img: []) → ไม่ error", async () => {
    const product = await makeProduct({ product_img: [] });
    await expect(productService.hardDeleteProduct(String(product._id))).resolves.toBeTruthy();
  });
});
