/**
 * setup สำหรับ integration test — เริ่ม mongodb-memory-server, connect mongoose,
 * แล้ว pre-populate cache ของ src/lib/dbConnect (global._mongoose) ให้ reuse connection นี้
 *
 * top-level await รันก่อน test file import → ตั้ง global ทันก่อน dbConnect ถูก import
 * (vitest isolate ต่อไฟล์ → mongod 1 ตัวต่อไฟล์)
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach } from "vitest";

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

const conn = await mongoose.connect(process.env.MONGODB_URI);

// dbConnect() อ่าน global._mongoose ตอน import — ใส่ connection ที่ต่อแล้วไว้ให้เลย
(globalThis as unknown as { _mongoose?: unknown })._mongoose = {
  conn,
  promise: Promise.resolve(conn),
};

afterEach(async () => {
  // list จาก DB จริงแทน mongoose.connection.collections (แคชแค่ collection ที่เคยผ่าน model ของ
  // mongoose เท่านั้น) — collection ที่ถูกสร้าง/เขียนตรงผ่าน native driver (เช่น db.collection("x")
  // ใน scripts/migrate-*.ts) จะไม่ถูกเคลียร์ถ้าใช้ mongoose.connection.collections อย่างเดียว ทำให้
  // ข้อมูลรั่วข้ามเทสในไฟล์เดียวกันได้ (BACKLOG §3.11 — เจอตอนเทส migrate-money-to-satang)
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.listCollections().toArray();
  await Promise.all(collections.map((c) => db.collection(c.name).deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect().catch(() => undefined);
  await mongod.stop();
});
