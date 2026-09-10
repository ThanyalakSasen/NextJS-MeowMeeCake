import { describe, it, expect } from "vitest";
import { ok, okList, created } from "@/lib/apiResponse";
import { buildMeta } from "@/lib/queryParams";

async function bodyOf(res: Response) {
  return res.json();
}

describe("apiResponse envelope", () => {
  it("ok → { success: true, data }", async () => {
    const res = ok({ x: 1 });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ success: true, data: { x: 1 } });
  });

  it("created → 201", async () => {
    const res = created({ id: "a" });
    expect(res.status).toBe(201);
  });

  it("okList → { success: true, data: { items, meta } } · meta default null", async () => {
    const res = okList([1, 2, 3]);
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ success: true, data: { items: [1, 2, 3], meta: null } });
  });

  it("okList with meta", async () => {
    const meta = buildMeta(25, { page: 2, limit: 10, skip: 10 });
    const res = okList(["a"], meta);
    const body = await bodyOf(res);
    expect(body.data.items).toEqual(["a"]);
    expect(body.data.meta).toMatchObject({ page: 2, total: 25, totalPages: 3, hasNextPage: true });
  });

  it("okList([]) ยังคืน items เป็น array ว่าง (ไม่ใช่ null)", async () => {
    const body = await bodyOf(okList([]));
    expect(body.data.items).toEqual([]);
  });
});
