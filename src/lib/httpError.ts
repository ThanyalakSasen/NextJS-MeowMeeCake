/**
 * httpError — คลาส error กลางที่ใช้ร่วมกันทั้ง service layer
 *
 * service จะ "throw" error พวกนี้เมื่อเจอเงื่อนไขผิดปกติ (ไม่พบข้อมูล, ข้อมูลซ้ำ ฯลฯ)
 * โดยไม่ต้องรู้จัก HTTP เลย จากนั้น route handler (controller) จะเรียก
 * toErrorResponse() ใน apiResponse.ts เพื่อแปลงเป็น HTTP status code ที่ถูกต้อง
 */

export type HttpErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "TOO_MANY_REQUESTS";

export class HttpError extends Error {
  readonly status: number;
  readonly code: HttpErrorCode;
  readonly details?: unknown;

  constructor(
    message: string,
    status = 400,
    code: HttpErrorCode = "BAD_REQUEST",
    details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── ตัวช่วยสร้าง error แต่ละชนิด (ใช้บ่อย เขียนสั้น ๆ ได้) ──────────
export const badRequest = (msg = "คำขอไม่ถูกต้อง", details?: unknown) =>
  new HttpError(msg, 400, "BAD_REQUEST", details);

export const unauthorized = (msg = "กรุณาเข้าสู่ระบบ") =>
  new HttpError(msg, 401, "UNAUTHORIZED");

export const forbidden = (msg = "ไม่มีสิทธิ์ดำเนินการนี้") =>
  new HttpError(msg, 403, "FORBIDDEN");

export const notFound = (msg = "ไม่พบข้อมูลที่ระบุ") =>
  new HttpError(msg, 404, "NOT_FOUND");

export const conflict = (msg = "ข้อมูลขัดแย้งกับที่มีอยู่ในระบบ", details?: unknown) =>
  new HttpError(msg, 409, "CONFLICT", details);

export const unprocessable = (msg = "ข้อมูลไม่ผ่านเงื่อนไขทางธุรกิจ", details?: unknown) =>
  new HttpError(msg, 422, "UNPROCESSABLE", details);

export const tooMany = (msg = "คำขอถี่เกินไป กรุณาลองใหม่ภายหลัง", details?: unknown) =>
  new HttpError(msg, 429, "TOO_MANY_REQUESTS", details);

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
