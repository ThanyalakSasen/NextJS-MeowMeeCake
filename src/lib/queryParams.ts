/**
 * queryParams — แกะค่าจาก query string (?page=&limit=&sortBy=...) ให้เป็นรูปแบบที่ service ใช้ได้
 * ใช้ในชั้น route handler ก่อนส่งต่อให้ service
 */

import { badRequest } from "./httpError";

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(
  sp: URLSearchParams,
  defaultLimit = 20,
  maxLimit = 100
): Pagination {
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number(sp.get("limit")) || defaultLimit)
  );
  return { page, limit, skip: (page - 1) * limit };
}

/** คืน object สำหรับ .sort() ของ mongoose เช่น { created_at: -1 } */
export function parseSort(
  sp: URLSearchParams,
  allowed: string[],
  fallback: string
): Record<string, 1 | -1> {
  const by = sp.get("sortBy") || fallback;
  if (!allowed.includes(by)) {
    throw badRequest(`sortBy ต้องเป็นหนึ่งใน: ${allowed.join(", ")}`);
  }
  const order: 1 | -1 = sp.get("sortOrder") === "asc" ? 1 : -1;
  return { [by]: order };
}

/** "true"/"1" → true, "false"/"0" → false, ไม่ส่งมา → undefined */
export function parseBool(value: string | null): boolean | undefined {
  if (value === null || value === "") return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

export function parseNumber(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** meta ของ list ที่ paginate — โครงมาตรฐานเดียวของทุก list endpoint (ดู docs/api-conventions.md) */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export function buildMeta(total: number, { page, limit }: Pagination): PageMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  };
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
