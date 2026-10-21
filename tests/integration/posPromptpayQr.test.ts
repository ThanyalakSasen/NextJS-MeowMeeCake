import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import storeProfileModel from "@/models/storeProfileModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { createPermission } from "@/services/permissionService";
import { GET as qrGET } from "@/app/api/admin/pos/promptpay-qr/route";
import { makeUser } from "./helpers";

/**
 * GET /api/admin/pos/promptpay-qr — QR พร้อมเพย์จริงของร้านให้ POS (เดิม POS แสดง QR จำลองที่สแกนจ่ายไม่ได้)
 * พนักงานหน้าร้านใช้สิทธิ์ orders.view — ไม่ต้องเป็นเจ้าของร้าน (store-profile เป็นของ owner เท่านั้น)
 */

async function staff(perms: Record<string, Record<string, boolean>>) {
  const role = await roleModel.create({ role_name: `pos-qr-${Math.random()}`, role_type: "staff" });
  const user = await makeUser({ role_id: role._id });
  for (const [menu_key, flags] of Object.entries(perms)) {
    await createPermission({ role_id: String(role._id), menu_key: menu_key as never, granted_by: String(user._id), ...flags });
  }
  const session: SessionUser = {
    user_id: String(user._id), role_id: String(role._id), role_type: "staff",
    email: user.email, source: "jwt", auth_time: Date.now(),
  };
  return session;
}

async function call(session: SessionUser, qs: string) {
  const req = new NextRequest(`http://localhost:3000/api/admin/pos/promptpay-qr?${qs}`, {
    headers: { [USER_HEADER]: JSON.stringify(session) },
  });
  const res = await (qrGET as unknown as (r: NextRequest) => Promise<Response>)(req);
  return { status: res.status, body: await res.json() };
}

const savedEnv = process.env.PROMPTPAY_ID;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.PROMPTPAY_ID;
  else process.env.PROMPTPAY_ID = savedEnv;
});

describe("GET /api/admin/pos/promptpay-qr", () => {
  it("พนักงานที่มี orders.view ได้ QR + ชื่อบัญชี + เลขพร้อมเพย์จากข้อมูลร้าน", async () => {
    await storeProfileModel.create({ store_name: "MeowMee", promptpay_id: "0812345678", promptpay_account_name: "ร้านเหมียว" });
    const { status, body } = await call(await staff({ pos: { can_view: true } }), "amount=150.5");
    expect(status).toBe(200);
    expect(body.data.qr_image.startsWith("data:image/png;base64,")).toBe(true);
    expect(body.data.account_name).toBe("ร้านเหมียว");
    expect(body.data.promptpay_id).toBe("0812345678");
    expect(body.data.amount).toBe(150.5);
  });

  it("ไม่มี orders.view = 403", async () => {
    await storeProfileModel.create({ store_name: "MeowMee", promptpay_id: "0812345678" });
    expect((await call(await staff({ products: { can_view: true } }), "amount=100")).status).toBe(403);
  });

  it("ยอดเงินไม่ถูกต้อง (ไม่ส่ง · ≤ 0 · ทศนิยมเกิน 2 ตำแหน่ง) = 400", async () => {
    await storeProfileModel.create({ store_name: "MeowMee", promptpay_id: "0812345678" });
    const session = await staff({ pos: { can_view: true } });
    expect((await call(session, "")).status).toBe(400);
    expect((await call(session, "amount=0")).status).toBe(400);
    expect((await call(session, "amount=10.555")).status).toBe(400);
    expect((await call(session, "amount=abc")).status).toBe(400);
  });

  it("ร้านยังไม่ตั้งเลขพร้อมเพย์ และไม่มี env PROMPTPAY_ID = 422", async () => {
    delete process.env.PROMPTPAY_ID;
    await storeProfileModel.create({ store_name: "MeowMee", promptpay_id: "" });
    const { status, body } = await call(await staff({ pos: { can_view: true } }), "amount=100");
    expect(status).toBe(422);
    expect(body.error.message).toContain("พร้อมเพย์");
  });
});
