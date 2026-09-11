import { Types } from "mongoose";
import { badRequest } from "./httpError";

/** โยน HttpError(400) ถ้า id ไม่ใช่รูปแบบ ObjectId ที่ถูกต้อง */
export function assertObjectId(id: string, field = "id"): void {
  if (!Types.ObjectId.isValid(id)) {
    throw badRequest(`รูปแบบ ${field} ไม่ถูกต้อง`);
  }
}

export function isObjectId(id: unknown): id is string {
  return typeof id === "string" && Types.ObjectId.isValid(id);
}

/** เก็บเฉพาะ key ที่อนุญาต (กัน mass-assignment เช่น ยัด deleted_at มาเอง) */
export function pick<T extends Record<string, unknown>>(
  source: T,
  keys: readonly string[]
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      out[key as keyof T] = source[key] as T[keyof T];
    }
  }
  return out;
}
