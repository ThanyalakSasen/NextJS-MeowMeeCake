import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ไฟล์ส่วนตัว (สลิป · ใบเสร็จ) แยก bucket ได้ด้วย S3_PRIVATE_BUCKET — R2 เปิด public ได้ทั้ง bucket เท่านั้น
 * ไม่ตั้ง = ใช้ S3_BUCKET เดียวกับไฟล์สาธารณะ (พฤติกรรมเดิม)
 */

const sent: Array<{ type: string; input: { Bucket?: string; Key?: string } }> = [];

vi.mock("@aws-sdk/client-s3", () => {
  class Cmd {
    constructor(public input: { Bucket?: string; Key?: string }) {}
  }
  class PutObjectCommand extends Cmd {}
  class GetObjectCommand extends Cmd {}
  class DeleteObjectCommand extends Cmd {}
  class S3Client {
    async send(cmd: Cmd) {
      sent.push({ type: cmd.constructor.name, input: cmd.input });
      return { Body: { transformToByteArray: async () => new Uint8Array([1]) } };
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const ENV_KEYS = ["UPLOAD_DRIVER", "S3_BUCKET", "S3_PRIVATE_BUCKET"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  sent.length = 0;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.UPLOAD_DRIVER = "s3";
  process.env.S3_BUCKET = "shop-public";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("privateFiles — เลือก bucket", () => {
  it("ตั้ง S3_PRIVATE_BUCKET → อัปโหลด/อ่าน/ลบ ใช้ bucket ส่วนตัว (key private/<dir>/…)", async () => {
    process.env.S3_PRIVATE_BUCKET = "shop-private";
    const { savePrivateImage, readPrivateFile, deletePrivateFile } = await import("@/lib/privateFiles");

    const file = await savePrivateImage(new File([new Uint8Array(PNG_1X1)], "r.png"), "receipts");
    expect(file.url).toMatch(/^\/api\/files\/receipts\/[\w-]+\.png$/);
    await readPrivateFile("receipts", file.filename);
    await deletePrivateFile(file.url);

    expect(sent.map((s) => s.type)).toEqual(["PutObjectCommand", "GetObjectCommand", "DeleteObjectCommand"]);
    for (const s of sent) {
      expect(s.input.Bucket).toBe("shop-private");
      expect(s.input.Key).toBe(`private/receipts/${file.filename}`);
    }
  });

  it("ไม่ตั้ง S3_PRIVATE_BUCKET → ใช้ S3_BUCKET (พฤติกรรมเดิม)", async () => {
    delete process.env.S3_PRIVATE_BUCKET;
    const { savePrivateImage } = await import("@/lib/privateFiles");
    await savePrivateImage(new File([new Uint8Array(PNG_1X1)], "s.png"), "slips");
    expect(sent[0].input.Bucket).toBe("shop-public");
  });

  it("S3_PRIVATE_BUCKET เป็นช่องว่าง → ถือว่าไม่ตั้ง", async () => {
    process.env.S3_PRIVATE_BUCKET = "   ";
    const { savePrivateImage } = await import("@/lib/privateFiles");
    await savePrivateImage(new File([new Uint8Array(PNG_1X1)], "s.png"), "slips");
    expect(sent[0].input.Bucket).toBe("shop-public");
  });
});
