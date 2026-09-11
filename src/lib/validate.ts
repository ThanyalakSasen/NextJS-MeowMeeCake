/**
 * validate — ด่านตรวจ input ของ route handler ด้วย zod (ก่อนส่งต่อ service)
 *
 *   const body = await parseBody(req, createOrderBody);   // มี type จาก schema, throw badRequest ถ้าไม่ผ่าน
 *   const q = parseQuery(req.nextUrl.searchParams, listQuery);
 *
 * ทำงานร่วมกับ apiResponse.route()/withAuth() ที่มีอยู่แล้ว —
 * fail = throw HttpError(400) → toErrorResponse ห่อเป็น { success:false, error:{ code, message, details:{ issues } } }
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { badRequest } from "./httpError";

export interface FieldIssue {
  path: string;
  message: string;
  code: string;
}

function toIssues(err: z.ZodError): FieldIssue[] {
  return err.issues.map((i) => ({
    path: i.path.map(String).join(".") || "(root)",
    message: i.message,
    code: i.code,
  }));
}

/** parse JSON body ตาม schema — body ไม่ใช่ JSON = 400, ไม่ผ่าน schema = 400 พร้อม issues */
export async function parseBody<T extends z.ZodType>(
  req: NextRequest,
  schema: T
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("body ต้องเป็น JSON ที่ถูกต้อง");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest("ข้อมูลที่ส่งมาไม่ผ่านการตรวจสอบ", { issues: toIssues(result.error) });
  }
  return result.data;
}

/** parse query string ตาม schema — ใช้คู่กับ z.coerce.* เพราะค่าจาก URLSearchParams เป็น string เสมอ
 *  หมายเหตุ: key ที่ซ้ำกันจะเก็บค่าสุดท้าย — ถ้าต้องการ array ให้ใช้ sp.getAll() เองใน route */
export function parseQuery<T extends z.ZodType>(
  sp: URLSearchParams,
  schema: T
): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(sp.entries()));
  if (!result.success) {
    throw badRequest("query string ไม่ถูกต้อง", { issues: toIssues(result.error) });
  }
  return result.data;
}

/** parse ค่าที่ resolve เองแล้ว (เช่น params ของ dynamic route) */
export function parse<T extends z.ZodType>(value: unknown, schema: T, label = "ข้อมูล"): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(`${label}ไม่ถูกต้อง`, { issues: toIssues(result.error) });
  }
  return result.data;
}
