import { describe, it, expect, afterAll } from "vitest";
import mongoose from "mongoose";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import paymentModel from "@/models/paymentModel";
import bannerModel from "@/models/bannersModel";
import expenseModel from "@/models/expenseModel";
import * as paymentService from "@/services/paymentService";
import { bannerService } from "@/services/bannerService";
import { expenseService } from "@/services/expenseService";
import { runMigration } from "../../scripts/migrate-upload-files";
import { makeUser } from "./helpers";

/**
 * docs/uploads.md — banner_img / slip_image_url / receipt_url ต้องเป็นไฟล์ในระบบ (public/uploads/<โฟลเดอร์>)
 * + scripts/migrate-upload-files.ts ย้ายแบนเนอร์ base64 เป็นไฟล์ และรายงานสลิป/ใบเสร็จที่ไม่มีไฟล์จริง
 */

const SLIP = "/api/files/slips/1700000000000-aaaaaaaaaaaa.jpg";
const RECEIPT = "/uploads/receipts/1700000000000-bbbbbbbbbbbb.jpg";
const BANNER = "/uploads/banners/1700000000000-cccccccccccc.jpg";

// PNG 1x1 จริง (ผ่าน magic bytes ของ saveImages)
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const createdFiles: string[] = [];
afterAll(() => {
  for (const url of createdFiles) rmSync(join(process.cwd(), "public", ...url.split("/").filter(Boolean)), { force: true });
});

describe("สลิปโอนเงิน (paymentService)", () => {
  async function pendingPayment() {
    const u = await makeUser();
    return paymentModel.create({ user_id: u._id, order_id: new mongoose.Types.ObjectId(), amount: 10000, status: "failed" });
  }

  it("submitSlip: ไฟล์ส่วนตัวในระบบ (/api/files/slips/...) ผ่าน · url ภายนอก / path รุ่นเก่า / public/uploads/slips → 400", async () => {
    const p = await pendingPayment();
    for (const bad of ["https://evil.example/pixel.gif", "/uploads/slip-6a4e-1787718975936.jpg", "/uploads/slips/1700000000000-a.jpg", "data:image/png;base64,AAAA"]) {
      await expect(paymentService.submitSlip(String(p._id), { slip_image_url: bad })).rejects.toThrow(/อัปโหลดผ่านระบบ/);
    }
    const ok = (await paymentService.submitSlip(String(p._id), { slip_image_url: SLIP })) as { slip_image_url: string; status: string };
    expect(ok.slip_image_url).toBe(SLIP);
    expect(ok.status).toBe("pending");
  });
});

describe("ใบเสร็จค่าใช้จ่าย (expenseService)", () => {
  const base = { date: new Date(), description: "ค่าแป้ง", category: "วัตถุดิบ", amount: 100, payment_method: "เงินสด" };

  it("create: ไฟล์ในระบบ / ไม่แนบ ผ่าน · ชื่อไฟล์ลอย ๆ → 400", async () => {
    await expect(expenseService.create({ ...base, receipt_url: "02cae48b.jpg" })).rejects.toThrow(/receipts/);
    const e = (await expenseService.create({ ...base, receipt_url: RECEIPT })) as { receipt_url: string };
    expect(e.receipt_url).toBe(RECEIPT);
    await expect(expenseService.create({ ...base, receipt_url: null })).resolves.toBeTruthy();
  });

  it("update: ค่ารุ่นเก่าส่งกลับซ้ำได้ (แก้ฟิลด์อื่น) · ตั้งค่าใหม่ต้องเป็นไฟล์ในระบบ", async () => {
    const legacy = await expenseModel.create({ ...base, amount: 10000, receipt_url: "legacy-name.jpg" });
    const id = String(legacy._id);
    await expect(expenseService.update(id, { note: "x", receipt_url: "legacy-name.jpg" })).resolves.toBeTruthy();
    await expect(expenseService.update(id, { receipt_url: "other.jpg" })).rejects.toThrow(/receipts/);
    const u = (await expenseService.update(id, { receipt_url: RECEIPT })) as { receipt_url: string };
    expect(u.receipt_url).toBe(RECEIPT);
  });
});

describe("แบนเนอร์ (bannerService)", () => {
  const base = { banner_name: "โปร", sort_order: 1 };

  it("create: ต้องเป็นไฟล์ใน /uploads/banners · base64 / url ภายนอก → 400", async () => {
    await expect(bannerService.create({ ...base, banner_img: "data:image/png;base64,AAAA" })).rejects.toThrow(/banners/);
    await expect(bannerService.create({ ...base, banner_img: "https://images.unsplash.com/x" })).rejects.toThrow(/banners/);
    const b = (await bannerService.create({ ...base, banner_img: BANNER })) as { banner_img: string };
    expect(b.banner_img).toBe(BANNER);
  });

  it("update: ค่ารุ่นเก่าส่งกลับซ้ำได้ · เปลี่ยนเป็นค่าภายนอก → 400", async () => {
    const legacy = await bannerModel.create({ ...base, banner_img: "https://images.unsplash.com/old" });
    const id = String(legacy._id);
    await expect(bannerService.update(id, { banner_name: "ใหม่", banner_img: "https://images.unsplash.com/old" })).resolves.toBeTruthy();
    await expect(bannerService.update(id, { banner_img: "https://images.unsplash.com/new" })).rejects.toThrow(/banners/);
  });
});

describe("scripts/migrate-upload-files", () => {
  it("dry-run ไม่แตะ · --apply เขียนแบนเนอร์ base64 เป็นไฟล์จริง + backup · รูปเสียข้าม · รายงานสลิป/ใบเสร็จที่ไม่มีไฟล์", async () => {
    await bannerModel.deleteMany({});
    await paymentModel.deleteMany({});
    await expenseModel.deleteMany({});
    const u = await makeUser();
    const good = await bannerModel.create({ banner_name: "a", sort_order: 1, banner_img: `data:image/png;base64,${PNG_1X1}` });
    const broken = await bannerModel.create({ banner_name: "b", sort_order: 2, banner_img: "data:image/png;base64,bm90LWFuLWltYWdl" });
    await bannerModel.create({ banner_name: "c", sort_order: 3, banner_img: BANNER }); // ไฟล์ในระบบแต่ไม่มีบนดิสก์
    await paymentModel.create({ user_id: u._id, order_id: new mongoose.Types.ObjectId(), amount: 1, slip_image_url: "/uploads/slip-old.jpg" });
    await paymentModel.create({ user_id: u._id, order_id: new mongoose.Types.ObjectId(), amount: 1, slip_image_url: SLIP, status: "paid" });
    await expenseModel.create({ date: new Date(), description: "x", category: "อื่นๆ", amount: 1, payment_method: "เงินสด", receipt_url: "legacy.jpg" });

    const dry = await runMigration();
    expect(dry.banners.planned).toHaveLength(2);
    expect(dry.banners.missingFile.map((m) => m.url)).toEqual([BANNER]);
    expect(dry.slips.map((s) => s.problem).sort()).toEqual(["missing-file", "not-uploaded"]);
    expect(dry.receipts.map((r) => r.problem)).toEqual(["not-uploaded"]);
    expect((await bannerModel.findById(good._id).lean<{ banner_img: string }>())?.banner_img).toMatch(/^data:/);

    const backupDir = mkdtempSync(join(tmpdir(), "upload-files-"));
    const r = await runMigration({ apply: true, backupDir });
    expect(r.banners.converted).toHaveLength(1);
    expect(r.banners.failed.map((f) => f._id)).toEqual([String(broken._id)]);
    expect(r.backupFile && existsSync(r.backupFile)).toBe(true);

    const url = r.banners.converted[0].url;
    createdFiles.push(url);
    expect(url).toMatch(/^\/uploads\/banners\/[\w-]+\.png$/);
    expect(existsSync(join(process.cwd(), "public", ...url.split("/").filter(Boolean)))).toBe(true);
    expect((await bannerModel.findById(good._id).lean<{ banner_img: string }>())?.banner_img).toBe(url);
    expect((await bannerModel.findById(broken._id).lean<{ banner_img: string }>())?.banner_img).toMatch(/^data:/);

    const again = await runMigration({ apply: true, backupDir });
    expect(again.banners.converted).toHaveLength(0);
  });
});
