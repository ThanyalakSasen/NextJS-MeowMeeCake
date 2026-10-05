/**
 * backgroundTasks — ติดตามงานที่ปล่อยทำเบื้องหลัง (fire-and-forget) เช่น แจ้งเตือนร้าน/ลูกค้า หลังสร้างออเดอร์
 *
 * โค้ดจริงไม่ต้องรอ — trackBackground คืน promise เดิม (ผู้เรียกจะ await หรือ .catch ต่อเหมือนเดิมก็ได้)
 * แต่ integration test ต้องรอให้งานพวกนี้จบก่อนล้าง DB / ปิด connection (tests/integration/setup.ts):
 * ไม่งั้นงานที่ยังวิ่งอยู่จะเขียนลง DB หลังล้างแล้ว (ข้อมูลรั่วไปเทสถัดไป) หรือเขียนหลังปิด connection
 * (log `MongoNotConnectedError` รกผลเทส)
 */
const pending = new Set<Promise<unknown>>();

export function trackBackground<T>(task: Promise<T>): Promise<T> {
  pending.add(task);
  task.then(
    () => pending.delete(task),
    () => pending.delete(task)
  );
  return task;
}

/** รอจนงานเบื้องหลังจบหมด (รวมงานที่งานเหล่านั้นปล่อยต่อ) — ใช้ในเทส */
export async function flushBackground(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
