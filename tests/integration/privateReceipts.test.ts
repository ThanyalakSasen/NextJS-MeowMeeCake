import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import expenseModel from "@/models/expenseModel";
import roleModel from "@/models/roleModel";
import permissionModel from "@/models/permissionModel";
import { USER_HEADER } from "@/lib/session";
import { savePrivateImage } from "@/lib/privateFiles";
import { runMigration } from "../../scripts/migrate-upload-files";
import { makeUser } from "./helpers";

/**
 * ใบเสร็จค่าใช้จ่ายเป็นไฟล์ส่วนตัว (เอกสารการเงินภายในร้าน) — เดิมอยู่ใน public/uploads/receipts ใครรู้ URL ก็เปิดได้
 * อัปโหลดผ่าน POST /api/admin/expenses/receipts → /api/files/receipts/<ไฟล์> · เปิดผ่าน GET ที่ตรวจสิทธิ์ reports.view
 * · migrate-upload-files ย้ายใบเสร็จเดิมใน public/uploads/receipts
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

type Session = { user_id: string; role_id: string; role_type: string; email: string };
type Handler = (req: NextRequest, ctx: { params: Promise<{ filename: string }> }) => Promise<Response>;

let privateDir: string;
let GET: Handler;
let UPLOAD: (req: NextRequest, ctx?: unknown) => Promise<Response>;
const ORIGINAL = process.env.PRIVATE_UPLOAD_DIR;

beforeAll(async () => {
  privateDir = mkdtempSync(join(tmpdir(), "private-receipts-"));
  process.env.PRIVATE_UPLOAD_DIR = privateDir;
  GET = (await import("@/app/api/files/receipts/[filename]/route")).GET as Handler;
  UPLOAD = (await import("@/app/api/admin/expenses/receipts/route")).POST as typeof UPLOAD;
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.PRIVATE_UPLOAD_DIR;
  else process.env.PRIVATE_UPLOAD_DIR = ORIGINAL;
  rmSync(privateDir, { recursive: true, force: true });
});

async function sessionOf(user: { _id: unknown; role_id: unknown }, roleType: "owner" | "staff" | "customer"): Promise<Session> {
  // authGuard ตรวจ role กับ DB (docs/BACKLOG5.md Y1) — makeUser() ใส่ role_id สุ่มที่ไม่มีจริง → สร้าง role ตามประเภทที่เทสอ้าง
  await roleModel.updateOne(
    { _id: user.role_id },
    { $setOnInsert: { role_name: `${roleType}-${String(user.role_id)}`, role_type: roleType, is_active: true } },
    { upsert: true }
  );
  return { user_id: String(user._id), role_id: String(user.role_id), role_type: roleType, email: "x@y.z" };
}

async function open(session: Session | null, filename: string) {
  const headers: Record<string, string> = session ? { [USER_HEADER]: JSON.stringify(session) } : {};
  return GET(new NextRequest(`http://localhost:3000/api/files/receipts/${filename}`, { headers }), {
    params: Promise.resolve({ filename }),
  });
}

const savedReceipt = () => savePrivateImage(new File([new Uint8Array(PNG_1X1)], "receipt.png"), "receipts");

describe("POST /api/admin/expenses/receipts — เก็บเป็นไฟล์ส่วนตัว", () => {
  it("คืน /api/files/receipts/… · ไฟล์อยู่นอก public/", async () => {
    const owner = await makeUser();
    const form = new FormData();
    form.append("file", new File([new Uint8Array(PNG_1X1)], "r.png", { type: "image/png" }));
    const res = await UPLOAD(
      new NextRequest("http://localhost:3000/api/admin/expenses/receipts", {
        method: "POST",
        body: form,
        headers: { [USER_HEADER]: JSON.stringify(await sessionOf(owner, "owner")) },
      })
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { url: string; filename: string } };
    expect(data.url).toMatch(/^\/api\/files\/receipts\/[\w-]+\.png$/);
    expect(existsSync(join(privateDir, "receipts", data.filename))).toBe(true);
    expect(existsSync(join(process.cwd(), "public", "uploads", "receipts", data.filename))).toBe(false);
  });
});

describe("GET /api/files/receipts/[filename] — ตรวจสิทธิ์ reports.view", () => {
  it("เจ้าของร้าน → 200 รูป + no-store · ลูกค้า → 403 · ไม่ล็อกอิน → 401", async () => {
    const saved = await savedReceipt();
    const ok = await open(await sessionOf(await makeUser(), "owner"), saved.filename);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await ok.arrayBuffer()).equals(PNG_1X1)).toBe(true);

    expect((await open(await sessionOf(await makeUser(), "customer"), saved.filename)).status).toBe(403);
    expect((await open(null, saved.filename)).status).toBe(401);
  });

  it("staff ไม่มีสิทธิ์ reports.view → 403 · มีสิทธิ์ → 200", async () => {
    const saved = await savedReceipt();
    const owner = await makeUser();
    const role = await roleModel.create({ role_name: `staff-${Date.now()}`, role_type: "staff", is_active: true });
    const staff = await makeUser({ role_id: role._id });
    const session = await sessionOf(staff, "staff");
    expect((await open(session, saved.filename)).status).toBe(403);

    await permissionModel.create({ role_id: role._id, menu_key: "reports", can_view: true, granted_by: owner._id });
    expect((await open(session, saved.filename)).status).toBe(200);
  });

  it("ไม่มีสิทธิ์ → 403 แม้ไฟล์ไม่มีจริง (ไม่บอกว่าไฟล์มีไหม) · มีสิทธิ์ → traversal / ไฟล์ไม่มี = 404", async () => {
    expect((await open(await sessionOf(await makeUser(), "customer"), "1700000000000-nope.png")).status).toBe(403);
    const owner = await sessionOf(await makeUser(), "owner");
    expect((await open(owner, "..%2Fsecret.png")).status).toBe(404);
    expect((await open(owner, "1700000000000-nope.png")).status).toBe(404);
  });
});

describe("migrate-upload-files: ใบเสร็จใน public/uploads/receipts → ไฟล์ส่วนตัว", () => {
  it("dry-run รายงาน · --apply ย้ายไฟล์ + เปลี่ยน receipt_url · ใบเสร็จส่วนตัวที่ไฟล์หายถูกรายงาน", async () => {
    const name = `1700000000002-${Date.now()}.png`;
    const publicDir = join(process.cwd(), "public", "uploads", "receipts");
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, name), PNG_1X1);
    const base = { date: new Date(), description: "x", category: "อื่นๆ", amount: 1, payment_method: "เงินสด" };
    const exp = await expenseModel.create({ ...base, receipt_url: `/uploads/receipts/${name}` });
    await expenseModel.create({ ...base, receipt_url: "/api/files/receipts/1700000000003-gone.png" });

    try {
      const dry = await runMigration();
      expect(dry.receiptsToPrivate.map((r) => r.from)).toEqual([`/uploads/receipts/${name}`]);
      expect(dry.receipts.map((r) => r.problem)).toEqual(["missing-file"]);
      expect(existsSync(join(publicDir, name))).toBe(true);

      await runMigration({ apply: true, backupDir: mkdtempSync(join(tmpdir(), "ur-")) });
      const after = (await expenseModel.findById(exp._id).lean<{ receipt_url: string }>())!.receipt_url;
      expect(after).toBe(`/api/files/receipts/${name}`);
      expect(existsSync(join(privateDir, "receipts", name))).toBe(true);
      expect(existsSync(join(publicDir, name))).toBe(false);
    } finally {
      rmSync(join(publicDir, name), { force: true });
    }
  });
});
