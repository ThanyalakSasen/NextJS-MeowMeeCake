import { describe, it, expect, vi, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import * as authService from "@/services/authService";
import { BCRYPT_ROUNDS } from "@/services/userService";

const SECRET_FIELDS = [
  "password",
  "email_verify_token",
  "verification_token_expiry",
  "reset_password_token",
  "reset_password_token_expiry",
] as const;

async function makeCustomerRole(name = "customer") {
  return roleModel.create({ role_name: name, role_type: "customer" });
}

async function makeLocalUser(role: { _id: unknown }, password: string, over: Record<string, unknown> = {}) {
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return userModel.create({
    user_fullname: "ทดสอบ ล็อกอิน",
    email: `login-${Date.now()}-${Math.random()}@test.local`,
    password: hashed,
    auth_provider: "local",
    role_id: role._id,
    ...over,
  });
}

/**
 * BACKLOG3 §4 — authService.login()/loginWithGoogle() เดิม fetch user doc เดิมซ้ำถึง 3 รอบ (query
 * ซ้ำ 2 ครั้งเกินจำเป็น) แก้โดยให้ userService.verifyCredentials()/loginWithGoogle() populate role_id
 * เอง + sync ค่าที่เพิ่ง update ลง object ในหน่วยความจำ แทนที่จะ query ซ้ำ — เทสนี้ยืนยันว่า response
 * ที่คืนยังตรงกับพฤติกรรมเดิมทุกประการ (role populate ครบ, ไม่มี secret รั่ว, ค่าที่เพิ่ง update สดจริง
 * ไม่ใช่ค่าค้างจากก่อน update)
 */
describe("authService.login (BACKLOG3 §4 — ลด query ซ้ำ)", () => {
  it("login สำเร็จ → user.role_id populate ครบ (role_name/role_type), ไม่มี secret field รั่ว", async () => {
    const role = await makeCustomerRole();
    const created = await makeLocalUser(role, "P@ssw0rd123");

    const result = await authService.login(created.email, "P@ssw0rd123");

    expect(result.session.role_type).toBe("customer");
    const user = result.user as Record<string, unknown>;
    expect((user.role_id as { role_type: string }).role_type).toBe("customer");
    expect((user.role_id as { role_name: string }).role_name).toBe(role.role_name);
    for (const f of SECRET_FIELDS) expect(user[f]).toBeUndefined();
  });

  it("login สำเร็จ → last_login_at/failed_login_attempts เป็นค่าที่เพิ่ง update สด ไม่ใช่ค่าค้างก่อน update", async () => {
    const role = await makeCustomerRole();
    const created = await makeLocalUser(role, "P@ssw0rd123", { failed_login_attempts: 3 });

    const result = await authService.login(created.email, "P@ssw0rd123");
    const user = result.user as { last_login_at: unknown; failed_login_attempts: number };

    expect(user.failed_login_attempts).toBe(0); // ไม่ใช่ 3 ที่ตั้งไว้ก่อน login สำเร็จ
    expect(user.last_login_at).toBeTruthy();

    // ยืนยันกับ DB จริงว่าตรงกันด้วย (ไม่ใช่แค่ object ในหน่วยความจำเพี้ยนไปเอง)
    const fromDb = await userModel
      .findById(created._id)
      .lean<{ last_login_at: Date; failed_login_attempts: number }>();
    expect(fromDb!.failed_login_attempts).toBe(0);
    expect(fromDb!.last_login_at).toBeTruthy();
  });

  it("รหัสผ่านผิด → reject, ไม่คืน user", async () => {
    const role = await makeCustomerRole();
    const created = await makeLocalUser(role, "P@ssw0rd123");
    await expect(authService.login(created.email, "wrong-password")).rejects.toThrow();
  });
});

// mock jose.jwtVerify กัน loginWithGoogle ยิง network จริงไปหา Google JWKS ตอนเทส — คุมแค่ path ที่
// authService ใช้ผลลัพธ์ต่อ (payload/claims) ไม่ใช่การตรวจสอบ JWT signature จริง (นอกขอบเขต BACKLOG3 §4)
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, jwtVerify: vi.fn() };
});

describe("authService.loginWithGoogle (BACKLOG3 §4 — ลด query ซ้ำ)", () => {
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
  });

  async function mockClaims(claims: Record<string, unknown>) {
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: claims,
      protectedHeader: {},
      key: {},
    } as never);
  }

  it("ผู้ใช้ใหม่ (ไม่เคยมีบัญชี) → สร้างบัญชี + role_id ผูกกับ role customer (shape ตรงกับ populate เป๊ะ ไม่มี field อื่นของ role หลุดมา)", async () => {
    await makeCustomerRole(); // role_name ต้องเป็น "customer" เป๊ะ — authService หาแบบนี้
    await mockClaims({
      sub: "g-new-1",
      email: "google-new@test.local",
      name: "Google New",
      email_verified: true,
    });

    const result = await authService.loginWithGoogle("dummy-credential");

    expect(result.session.role_type).toBe("customer");
    const user = result.user as Record<string, unknown>;
    expect(user.email).toBe("google-new@test.local");
    expect(user.googleId).toBe("g-new-1");
    expect(Object.keys(user.role_id as object).sort()).toEqual(["_id", "role_name", "role_type"]);
    for (const f of SECRET_FIELDS) expect(user[f]).toBeUndefined();
  });

  it("ผู้ใช้เดิม (local) ผูก googleId ครั้งแรก → googleId/is_email_verified ใน response สดจริง ไม่ใช่ค่าก่อน update", async () => {
    const role = await makeCustomerRole();
    const existing = await makeLocalUser(role, "x", {
      email: "link-google@test.local",
      googleId: null,
      is_email_verified: false,
    });
    await mockClaims({
      sub: "g-existing-1",
      email: existing.email,
      name: "Existing Local",
      email_verified: true,
    });

    const result = await authService.loginWithGoogle("dummy-credential");
    const user = result.user as {
      googleId: string;
      is_email_verified: boolean;
      role_id: { role_type: string };
    };

    expect(user.googleId).toBe("g-existing-1"); // ไม่ใช่ null ที่ตั้งไว้ก่อน update
    expect(user.is_email_verified).toBe(true);
    expect(user.role_id.role_type).toBe("customer");

    const fromDb = await userModel
      .findById(existing._id)
      .lean<{ googleId: string; is_email_verified: boolean }>();
    expect(fromDb!.googleId).toBe("g-existing-1");
    expect(fromDb!.is_email_verified).toBe(true);
  });

  it("อีเมลยังไม่ยืนยันที่ฝั่ง Google → reject (พฤติกรรมเดิม ไม่เกี่ยวกับ §4 แต่ยืนยันว่า refactor ไม่กระทบ)", async () => {
    await mockClaims({
      sub: "g-unverified",
      email: "unverified@test.local",
      name: "Unverified",
      email_verified: false,
    });
    await expect(authService.loginWithGoogle("dummy-credential")).rejects.toThrow(/ยืนยัน/);
  });
});
