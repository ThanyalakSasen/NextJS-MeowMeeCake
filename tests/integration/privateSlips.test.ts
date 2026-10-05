import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import paymentModel from "@/models/paymentModel";
import roleModel from "@/models/roleModel";
import permissionModel from "@/models/permissionModel";
import { USER_HEADER } from "@/lib/session";
import { savePrivateImage } from "@/lib/privateFiles";
import { runMigration } from "../../scripts/migrate-upload-files";
import { makeUser } from "./helpers";

/**
 * docs/BACKLOG4.md Y3 (ตัดสินใจ 2026-10-01: เปิดดูได้เฉพาะผู้ได้รับสิทธิ์) — สลิปเป็นไฟล์ส่วนตัว
 * นอก public/ · เปิดผ่าน GET /api/files/slips/[filename] ที่ตรวจสิทธิ์ · ย้ายสลิปเดิมใน public/uploads/slips
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

let privateDir: string;
let GET: (req: NextRequest, ctx: { params: Promise<{ filename: string }> }) => Promise<Response>;
const ORIGINAL = process.env.PRIVATE_UPLOAD_DIR;

beforeAll(async () => {
  privateDir = mkdtempSync(join(tmpdir(), "private-slips-"));
  process.env.PRIVATE_UPLOAD_DIR = privateDir;
  GET = (await import("@/app/api/files/slips/[filename]/route")).GET as typeof GET;
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.PRIVATE_UPLOAD_DIR;
  else process.env.PRIVATE_UPLOAD_DIR = ORIGINAL;
  rmSync(privateDir, { recursive: true, force: true });
});

async function as(user: { _id: unknown; role_id: unknown }, roleType: "owner" | "staff" | "customer", filename: string) {
  // authGuard ตรวจ role กับ DB (docs/BACKLOG5.md Y1) — makeUser() ใส่ role_id สุ่มที่ไม่มีจริง → สร้าง role ตามประเภทที่เทสอ้าง
  await roleModel.updateOne(
    { _id: user.role_id },
    { $setOnInsert: { role_name: `${roleType}-${String(user.role_id)}`, role_type: roleType, is_active: true } },
    { upsert: true }
  );
  const session = { user_id: String(user._id), role_id: String(user.role_id), role_type: roleType, email: "x@y.z" };
  return GET(
    new NextRequest(`http://localhost:3000/api/files/slips/${filename}`, { headers: { [USER_HEADER]: JSON.stringify(session) } }),
    { params: Promise.resolve({ filename }) }
  );
}

async function slipOwnedBy(user: { _id: unknown }) {
  const saved = await savePrivateImage(new File([new Uint8Array(PNG_1X1)], "slip.png"), "slips");
  await paymentModel.create({
    user_id: user._id,
    order_id: new mongoose.Types.ObjectId(),
    amount: 100,
    status: "pending",
    slip_image_url: saved.url,
  });
  return saved;
}

describe("เก็บสลิปเป็นไฟล์ส่วนตัว", () => {
  it("savePrivateImage เขียนนอก public/ · url เป็น /api/files/slips/…", async () => {
    const saved = await savePrivateImage(new File([new Uint8Array(PNG_1X1)], "s.png"), "slips");
    expect(saved.url).toMatch(/^\/api\/files\/slips\/[\w-]+\.png$/);
    expect(existsSync(join(privateDir, "slips", saved.filename))).toBe(true);
    expect(existsSync(join(process.cwd(), "public", "uploads", "slips", saved.filename))).toBe(false);
  });
});

describe("GET /api/files/slips/[filename] — ตรวจสิทธิ์", () => {
  it("เจ้าของรายการ → 200 รูป + no-store · ลูกค้าคนอื่น → 403 · ไม่ล็อกอิน → 401", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const saved = await slipOwnedBy(owner);

    const ok = await as(owner, "customer", saved.filename);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await ok.arrayBuffer()).equals(PNG_1X1)).toBe(true);

    expect((await as(other, "customer", saved.filename)).status).toBe(403);

    const anon = await GET(new NextRequest(`http://localhost:3000/api/files/slips/${saved.filename}`), {
      params: Promise.resolve({ filename: saved.filename }),
    });
    expect(anon.status).toBe(401);
  });

  it("เจ้าของร้าน → 200 · staff ไม่มีสิทธิ์ payments.view → 403 · มีสิทธิ์ → 200", async () => {
    const customer = await makeUser();
    const saved = await slipOwnedBy(customer);
    const owner = await makeUser();
    expect((await as(owner, "owner", saved.filename)).status).toBe(200);

    const role = await roleModel.create({ role_name: `staff-${Date.now()}`, role_type: "staff", is_active: true });
    const staff = await makeUser({ role_id: role._id });
    expect((await as(staff, "staff", saved.filename)).status).toBe(403);

    await permissionModel.create({ role_id: role._id, menu_key: "payments", can_view: true, granted_by: owner._id });
    expect((await as(staff, "staff", saved.filename)).status).toBe(200);
  });

  it("ชื่อไฟล์แปลก (traversal) / ไฟล์ไม่มีจริง → 404 สำหรับคนมีสิทธิ์", async () => {
    const owner = await makeUser();
    expect((await as(owner, "owner", "..%2Fsecret.png")).status).toBe(404);
    expect((await as(owner, "owner", "1700000000000-nope.png")).status).toBe(404);
  });
});

describe("migrate-upload-files: สลิปใน public/uploads/slips → ไฟล์ส่วนตัว", () => {
  it("dry-run รายงาน · --apply ย้ายไฟล์ + เปลี่ยน url ในรายการชำระเงิน", async () => {
    const name = `1700000000001-${Date.now()}.png`;
    const publicDir = join(process.cwd(), "public", "uploads", "slips");
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, name), PNG_1X1);
    const u = await makeUser();
    const pay = await paymentModel.create({
      user_id: u._id,
      order_id: new mongoose.Types.ObjectId(),
      amount: 1,
      status: "pending",
      slip_image_url: `/uploads/slips/${name}`,
    });

    try {
      const dry = await runMigration();
      expect(dry.slipsToPrivate.map((s) => s.from)).toContain(`/uploads/slips/${name}`);

      await runMigration({ apply: true, backupDir: mkdtempSync(join(tmpdir(), "uf-")) });
      const after = (await paymentModel.findById(pay._id).lean<{ slip_image_url: string }>())!.slip_image_url;
      expect(after).toBe(`/api/files/slips/${name}`);
      expect(existsSync(join(privateDir, "slips", name))).toBe(true);
      expect(existsSync(join(publicDir, name))).toBe(false);
    } finally {
      rmSync(join(publicDir, name), { force: true });
    }
  });
});
