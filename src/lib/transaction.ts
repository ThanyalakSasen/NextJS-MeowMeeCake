/**
 * runAtomic — เขียนหลายคำสั่งเป็นชุดเดียว (เอกสารบั๊กข้อ 12: บันทึกหลายคำขอแบบไม่ atomic)
 *
 * MongoDB แบบ replica set (Atlas = production) → MongoDB transaction: ล้มกลางทาง = ไม่มีอะไรถูกเขียน
 * แบบเครื่องเดียว (dev ในเครื่อง / mongodb-memory-server ของเทส) ไม่รองรับ transaction → เขียนตามลำดับเหมือนเดิม
 * (session = undefined) — ผู้เรียกจึงต้อง "ตรวจทุกอย่างก่อนเริ่มเขียน" อยู่ดี ให้ทางนี้ล้มกลางทางได้ยากที่สุด
 * fn อาจถูกเรียกซ้ำ (withTransaction retry เมื่อ transient error) — ห้ามมี side effect นอก DB ในนั้น
 */
import mongoose, { type ClientSession } from "mongoose";
import dbConnect from "./dbConnect";

let supported: Promise<boolean> | null = null;

async function transactionsSupported(): Promise<boolean> {
  supported ??= (async () => {
    try {
      const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
      return Boolean(hello.setName) || hello.msg === "isdbgrid";
    } catch {
      return false;
    }
  })();
  return supported;
}

export async function runAtomic<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  await dbConnect();
  if (!(await transactionsSupported())) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
