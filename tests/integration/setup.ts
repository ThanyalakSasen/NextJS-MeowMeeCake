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
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect().catch(() => undefined);
  await mongod.stop();
});
