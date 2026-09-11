import { describe, it, expect } from "vitest";
import {
  parsePagination,
  parseSort,
  parseBool,
  parseNumber,
  buildMeta,
  escapeRegExp,
} from "@/lib/queryParams";

const sp = (q: string) => new URLSearchParams(q);

describe("parsePagination", () => {
  it("แกะ page/limit ปกติ + คิด skip", () => {
    expect(parsePagination(sp("page=3&limit=10"))).toEqual({ page: 3, limit: 10, skip: 20 });
  });

  it("clamp: page ต่ำสุด 1, limit เกิน max → maxLimit, limit=0 → default", () => {
    expect(parsePagination(sp("page=0")).page).toBe(1);
    expect(parsePagination(sp("limit=9999")).limit).toBe(100);
    expect(parsePagination(sp("limit=0"), 20).limit).toBe(20);
  });

  it("ไม่ส่งมา → default page 1", () => {
    expect(parsePagination(sp("")).page).toBe(1);
  });
});

describe("parseSort", () => {
  it("sortBy ที่อนุญาต + sortOrder", () => {
    expect(parseSort(sp("sortBy=name&sortOrder=asc"), ["name", "created_at"], "created_at")).toEqual({
      name: 1,
    });
  });

  it("ไม่ส่ง sortBy → fallback, order default = desc", () => {
    expect(parseSort(sp(""), ["name", "created_at"], "created_at")).toEqual({ created_at: -1 });
  });

  it("sortBy นอกลิสต์ → throw", () => {
    expect(() => parseSort(sp("sortBy=evil"), ["name"], "name")).toThrowError(/sortBy/);
  });
});

describe("parseBool / parseNumber", () => {
  it("parseBool", () => {
    expect(parseBool("true")).toBe(true);
    expect(parseBool("1")).toBe(true);
    expect(parseBool("false")).toBe(false);
    expect(parseBool("0")).toBe(false);
    expect(parseBool("")).toBeUndefined();
    expect(parseBool(null)).toBeUndefined();
    expect(parseBool("maybe")).toBeUndefined();
  });

  it("parseNumber", () => {
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("abc")).toBeUndefined();
  });
});

describe("buildMeta", () => {
  it("คำนวณ totalPages / hasNext / hasPrev", () => {
    const m = buildMeta(25, { page: 2, limit: 10, skip: 10 });
    expect(m).toMatchObject({ total: 25, totalPages: 3, hasNextPage: true, hasPrevPage: true });
  });

  it("total 0 → totalPages อย่างน้อย 1", () => {
    expect(buildMeta(0, { page: 1, limit: 10, skip: 0 }).totalPages).toBe(1);
  });
});

describe("escapeRegExp", () => {
  it("escape อักขระพิเศษ", () => {
    expect(escapeRegExp("a.b*c?(d)")).toBe("a\\.b\\*c\\?\\(d\\)");
  });
});
