/**
 * stockRequestOnce — ทำคำขอปรับสต็อกครั้งเดียวต่อ request_key (models/stockRequestModel.ts)
 *
 * ไม่ส่ง key = ทำตามปกติ (API เดิม/สคริปต์) · key เดิมที่ทำเสร็จแล้ว = คืนผลเดิม ไม่ปรับซ้ำ (replay: true)
 * key เดิมที่ยังค้าง pending (คำขอแรกยังไม่จบ หรือ server ล้มกลางทาง) = 409 ให้โหลดยอดใหม่ก่อน — ไม่เดาว่าทำไปแล้วหรือยัง
 * ทำไม่สำเร็จ = ลบ key ทิ้ง ลองใหม่ด้วย key เดิมได้
 */
import dbConnect from "./dbConnect";
import { badRequest, conflict } from "./httpError";
import stockRequestModel from "../models/stockRequestModel";

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const KEEP_MS = 24 * 60 * 60 * 1000;

export function parseRequestKey(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !KEY_RE.test(value)) {
    throw badRequest("request_key ต้องเป็นตัวอักษร/ตัวเลข/-/_ ยาว 8-100 ตัว");
  }
  return value;
}

export async function stockRequestOnce<T>(
  key: string | undefined,
  productId: string,
  run: () => Promise<T>
): Promise<{ result: T; replay: boolean }> {
  if (!key) return { result: await run(), replay: false };
  await dbConnect();

  try {
    await stockRequestModel.create({ _id: key, product_id: productId, expire_at: new Date(Date.now() + KEEP_MS) });
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    const prev = await stockRequestModel.findById(key).lean<{ product_id: string; status: string; result: T }>();
    if (prev && prev.product_id !== productId) throw badRequest("request_key นี้ใช้กับสินค้าอื่นไปแล้ว");
    if (prev?.status === "done") return { result: prev.result, replay: true };
    throw conflict("รายการนี้กำลังบันทึกอยู่หรืออาจบันทึกไปแล้ว — โหลดยอดสต็อกใหม่แล้วตรวจก่อนทำซ้ำ", {
      reason: "STOCK_REQUEST_PENDING",
    });
  }

  let result: T;
  try {
    result = await run();
  } catch (e) {
    await stockRequestModel.deleteOne({ _id: key, status: "pending" });
    throw e;
  }
  await stockRequestModel.updateOne({ _id: key }, { $set: { status: "done", result } });
  return { result, replay: false };
}
