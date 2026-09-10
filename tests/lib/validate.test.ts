import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseBody, parseQuery } from "@/lib/validate";
import { registerBody, loginBody } from "@/schemas/auth";
import { isHttpError } from "@/lib/httpError";

/** จำลอง NextRequest แค่ .json() */
const reqOf = (payload: unknown, bad = false) =>
  ({
    json: async () => {
      if (bad) throw new SyntaxError("bad json");
      return payload;
    },
  }) as unknown as Parameters<typeof parseBody>[0];

describe("parseBody", () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().int() });

  it("คืน data ที่ผ่าน schema", async () => {
    await expect(parseBody(reqOf({ name: "a", age: 3 }), schema)).resolves.toEqual({
      name: "a",
      age: 3,
    });
  });

  it("body ไม่ใช่ JSON → HttpError 400", async () => {
    await expect(parseBody(reqOf(null, true), schema)).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && e.status === 400
    );
  });

  it("ไม่ผ่าน schema → 400 + details.issues", async () => {
    try {
      await parseBody(reqOf({ name: "", age: 1.5 }), schema);
      throw new Error("should have thrown");
    } catch (e) {
      expect(isHttpError(e)).toBe(true);
      const err = e as { status: number; details: { issues: Array<{ path: string }> } };
      expect(err.status).toBe(400);
      const paths = err.details.issues.map((i) => i.path);
      expect(paths).toContain("name");
      expect(paths).toContain("age");
    }
  });
});

describe("parseQuery", () => {
  const schema = z.object({
    page: z.coerce.number().int().positive().default(1),
    active: z.enum(["true", "false"]).optional(),
  });

  it("coerce string → number + default", () => {
    expect(parseQuery(new URLSearchParams("page=4"), schema)).toEqual({ page: 4 });
    expect(parseQuery(new URLSearchParams(""), schema)).toEqual({ page: 1 });
  });

  it("ค่าไม่ถูก enum → 400", () => {
    expect(() => parseQuery(new URLSearchParams("active=maybe"), schema)).toThrowError();
  });
});

describe("schemas/auth", () => {
  it("registerBody: normalize email (trim+lowercase), phone nullish", () => {
    const r = registerBody.parse({
      user_fullname: "  น้อง มีมี่  ",
      email: "  Test@Example.COM ",
      password: "secret12",
      user_phone: "0812345678",
    });
    expect(r.email).toBe("test@example.com");
    expect(r.user_fullname).toBe("น้อง มีมี่");
  });

  it("registerBody: password สั้น → fail", () => {
    expect(registerBody.safeParse({
      user_fullname: "x",
      email: "a@b.co",
      password: "short",
    }).success).toBe(false);
  });

  it("loginBody: อีเมลผิดรูปแบบ → fail", () => {
    expect(loginBody.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});
