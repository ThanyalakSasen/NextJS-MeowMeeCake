import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { USER_HEADER } from "@/lib/session";

/** docs/BACKLOG4.md Y6 — ลบแจ้งเตือนได้เฉพาะ owner (staff ได้ 403 ก่อนแตะ DB) */

const remove = vi.fn(async (id: string) => ({ _id: id, deleted: true }));
vi.mock("@/services/notificationService", () => ({
  notificationService: { remove: (id: string) => remove(id), update: vi.fn() },
}));

// unit test ไม่มี DB — ข้ามการตรวจบัญชีกับ DB (เทสแยกใน tests/integration/sessionValidation.test.ts)
vi.mock("@/lib/authGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authGuard")>();
  return { ...actual, authenticate: async (r: NextRequest) => actual.requireAuth(r) };
});

const { DELETE } = await import("@/app/api/admin/notifications/[id]/route");

const req = (role?: "owner" | "staff") =>
  new NextRequest("http://localhost:3000/api/admin/notifications/abc", {
    method: "DELETE",
    headers: role
      ? { [USER_HEADER]: JSON.stringify({ user_id: "u1", role_id: "r1", role_type: role, email: "a@b.c" }) }
      : {},
  });
const ctx = { params: Promise.resolve({ id: "abc" }) };

describe("DELETE /api/admin/notifications/[id]", () => {
  it("staff → 403 และไม่เรียกลบ", async () => {
    const res = await DELETE(req("staff"), ctx);
    expect(res.status).toBe(403);
    expect(remove).not.toHaveBeenCalled();
  });

  it("ไม่ล็อกอิน → 401", async () => {
    expect((await DELETE(req(), ctx)).status).toBe(401);
  });

  it("owner → ลบได้", async () => {
    const res = await DELETE(req("owner"), ctx);
    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith("abc");
  });
});
