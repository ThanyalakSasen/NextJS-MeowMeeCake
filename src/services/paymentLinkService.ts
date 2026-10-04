/**
 * paymentLinkService — ลิงก์หน้าชำระเงินแบบใช้ครั้งเดียวหลัง checkout (ออเดอร์ปกติ + พรีออเดอร์)
 * ย้ายมาจาก backend ฝั่งลูกค้า (paymentscusController · docs/customer-backend-merge.md §8.8)
 *
 * ความปลอดภัยของลิงก์:
 *   - token สุ่ม 192 บิต ใช้ได้ครั้งเดียว อายุ 30 นาที ผูกกับเจ้าของคำสั่งซื้อ (ต้องล็อกอินบัญชีเดียวกัน) และประเภทคำสั่งซื้อ
 *   - DB เก็บเฉพาะ SHA-256 ของ token (payment_link_token · select: false) — ข้อมูลใน DB หลุดก็เปิดหน้าชำระเงินไม่ได้
 *   - token อยู่ใน fragment (#t=) ของหน้าเว็บ ไม่ใช่ query — browser ไม่ส่ง fragment ไป server จึงไม่ติด log/Referer
 *   - ออกลิงก์ได้เฉพาะคำสั่งซื้อที่ยังรอชำระเงินอยู่จริง · ออกใหม่ = ทับ token เดิม (ลิงก์เก่าใช้ไม่ได้ทันที)
 */
import { createHash, randomBytes } from "node:crypto";
import type { Model } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, HttpError, notFound } from "../lib/httpError";
import { isObjectId } from "../lib/objectId";
import orderModel from "../models/orderModel";
import preorderModel from "../models/preorderModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PaymentLinkKind = "order" | "preorder";

const PAYMENT_LINK_TTL_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/; // randomBytes(24) → base64url 32 ตัวอักษร

const MODEL: Record<PaymentLinkKind, () => Model<any>> = {
  order: () => orderModel as Model<any>,
  preorder: () => preorderModel as Model<any>,
};

/** kind จาก body — ไม่ระบุ = ออเดอร์ปกติ · ค่าอื่น = 400 */
export function parseKind(raw: unknown): PaymentLinkKind {
  if (raw === undefined || raw === null || raw === "order") return "order";
  if (raw === "preorder") return "preorder";
  throw badRequest('kind ต้องเป็น "order" หรือ "preorder"');
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** ออกลิงก์ — คืน token (หน้าเว็บ redirect ไป /payment#t=<token>) */
export async function createPaymentLink(userId: string, kind: PaymentLinkKind, id: unknown) {
  if (!isObjectId(id)) throw notFound("ไม่พบคำสั่งซื้อที่รอชำระเงิน");
  await dbConnect();
  const token = randomBytes(24).toString("base64url");
  const expires_at = new Date(Date.now() + PAYMENT_LINK_TTL_MS);
  const result = await MODEL[kind]().updateOne(
    {
      _id: id,
      user_id: userId,
      deleted_at: null,
      order_status: "pending",
      payment_status: { $in: ["pending", "failed"] },
    },
    { $set: { payment_link_token: hashToken(token), payment_link_expires_at: expires_at } }
  );
  if (result.matchedCount === 0) throw notFound("ไม่พบคำสั่งซื้อที่รอชำระเงิน");
  return { token, kind, expires_at };
}

/** ใช้ token เปิดหน้าชำระเงิน — ล้าง token ทิ้งแบบ atomic (เปิดซ้ำ/ลิงก์ที่คัดลอกไปใช้ไม่ได้) · ใช้ไม่ได้ = 410 */
export async function redeemPaymentLink(userId: string, kind: PaymentLinkKind, token: unknown) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw badRequest("ลิงก์ไม่ถูกต้อง");
  await dbConnect();
  const doc = await MODEL[kind]()
    .findOneAndUpdate(
      {
        payment_link_token: hashToken(token),
        user_id: userId,
        payment_link_expires_at: { $gt: new Date() },
        deleted_at: null,
      },
      { $set: { payment_link_token: null, payment_link_expires_at: null } },
      { returnDocument: "after" }
    )
    .select("_id")
    .lean<{ _id: unknown } | null>();
  if (!doc) {
    throw new HttpError("ลิงก์ชำระเงินนี้ถูกใช้ไปแล้วหรือหมดอายุ กรุณาชำระเงินจากหน้าประวัติคำสั่งซื้อ", 410, "NOT_FOUND");
  }
  return { kind, id: String(doc._id) };
}
