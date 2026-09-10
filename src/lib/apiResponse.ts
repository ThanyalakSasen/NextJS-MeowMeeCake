/**
 * apiResponse — ตัวช่วยฝั่ง route handler (controller layer)
 *
 * - ok() / created() / noContent()  : สร้าง response รูปแบบมาตรฐาน { success, data }
 * - toErrorResponse()               : แปลง error ทุกชนิด (HttpError, Mongoose, อื่น ๆ) เป็น response
 * - route()                         : ครอบ handler ให้ดัก error อัตโนมัติ ไม่ต้อง try/catch ทุกไฟล์
 *
 * รูปแบบ response:
 *   สำเร็จ  → { "success": true,  "data": <payload> }
 *   ล้มเหลว → { "success": false, "error": { "code", "message", "details" } }
 */

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { isHttpError } from "./httpError";
import type { PageMeta } from "./queryParams";
import { log } from "./logger";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

/**
 * response มาตรฐานของ list endpoint — data = { items, meta }
 *   - paginate → ส่ง meta (จาก buildMeta)
 *   - ลิสต์เต็ม (ไม่ paginate เช่น banners/units) → meta = null
 * frontend rule เดียว: อ่าน data.items เสมอ · ถ้าทำ pagination อ่าน data.meta
 */
export function okList<T>(items: T[], meta: PageMeta | null = null): NextResponse {
  return NextResponse.json({ success: true, data: { items, meta } }, { status: 200 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

interface DuplicateKeyError {
  code: number;
  keyValue?: Record<string, unknown>;
}

function isDuplicateKeyError(err: unknown): err is DuplicateKeyError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

/** แปลง error ที่หลุดออกมาจาก service/mongoose เป็น HTTP response */
export function toErrorResponse(err: unknown): NextResponse {
  if (isHttpError(err)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
      },
      { status: err.status }
    );
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "ข้อมูลไม่ผ่านการตรวจสอบของ schema",
          details: Object.values(err.errors).map((e) => e.message),
        },
      },
      { status: 400 }
    );
  }

  if (err instanceof mongoose.Error.CastError) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_VALUE", message: `รูปแบบของฟิลด์ ${err.path} ไม่ถูกต้อง`, details: null },
      },
      { status: 400 }
    );
  }

  if (isDuplicateKeyError(err)) {
    const fields = Object.keys(err.keyValue ?? {});
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DUPLICATE_KEY",
          message: `มีข้อมูลซ้ำในฟิลด์: ${fields.join(", ") || "unique field"}`,
          details: err.keyValue ?? null,
        },
      },
      { status: 409 }
    );
  }

  log.error("api.unhandled_error", { err });
  return NextResponse.json(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาดภายในระบบ", details: null },
    },
    { status: 500 }
  );
}

/**
 * ครอบ route handler ให้ดัก error ทุกตัวแล้วส่งผ่าน toErrorResponse()
 *
 *   export const GET = route(async (req) => {
 *     const data = await service.list(...);
 *     return ok(data);
 *   });
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response> | Response
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
