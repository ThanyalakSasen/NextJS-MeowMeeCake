/**
 * money — แปลงเงินระหว่าง "บาท" (float ทศนิยม 2 ตำแหน่ง — ใช้ที่ API request/response เท่านั้น)
 * กับ "สตางค์" (integer — เก็บใน DB และคำนวณทุกอย่างด้วยหน่วยนี้)
 *
 * BACKLOG §3.11 — ก่อนแก้ ราคา/ยอดรวม/ส่วนลดทุกอย่างเก็บเป็น JS `number` หน่วยบาทตรง ๆ (float) มี
 * `round2()` ช่วยปัดตอนแสดงผล/บันทึกลง DB แต่ float สะสม error ได้จากการคูณ/บวกต่อเนื่องหลายจุด
 * (ราคา × จำนวน → รวมหลายบรรทัด → หักส่วนลด → บวกค่าส่ง) — เก็บเป็น integer สตางค์ตัดปัญหานี้ที่ต้นทาง
 * เพราะ integer บวก/ลบ/คูณกันไม่มี rounding error เลย (มีแค่ตอน "หาร" เท่านั้นที่ต้องปัดเอง เช่น
 * ส่วนลดเปอร์เซ็นต์ — ใช้ `Math.round` เสมอ ไม่ปล่อยทศนิยมค้าง)
 *
 * **ตัดสินใจร่วมกับผู้ใช้ (2026-09-12): API ยังรับ-ส่งเป็นทศนิยมบาทเหมือนเดิม** (ไม่ breaking change กับ
 * client ที่ใช้อยู่) — มีแค่ชั้น DB/service เท่านั้นที่เปลี่ยนหน่วยเป็นสตางค์ กติกา:
 *   1. แปลงเป็นสตางค์ "ให้เร็วที่สุด" ตอนรับ input (route parse body แล้วแปลงทันทีก่อนส่งเข้า service)
 *   2. คำนวณทุกอย่างเป็น integer สตางค์ตลอดทาง — **ห้ามผสมหน่วยกลางทางคำนวณเด็ดขาด**
 *   3. แปลงกลับเป็นบาทเฉพาะตอนสุดท้ายก่อนส่ง response กลับ (หรือแสดงผล)
 */

/** บาท (float) → สตางค์ (integer) — ปัดเข้าใกล้ที่สุด กัน floating-point เช่น 19.99*100 = 1998.999... */
export function toSatang(baht: number): number {
  return Math.round(baht * 100);
}

/** สตางค์ (integer) → บาท (float ทศนิยม 2 ตำแหน่งเสมอ) — ใช้ตอนส่ง response กลับหรือแสดงผล */
export function toBaht(satang: number): number {
  return Math.round(satang) / 100;
}

/** คิดเปอร์เซ็นต์ของยอดสตางค์ แล้วปัดกลับเป็น integer สตางค์เสมอ (เช่น ส่วนลด 15% ของ 9999 สตางค์) */
export function percentOfSatang(satang: number, percent: number): number {
  return Math.round((satang * percent) / 100);
}

/**
 * แปลงทุก key ที่ระบุของ object จากบาท → สตางค์ (ใช้ที่ route/service boundary ตอนรับ input)
 * ข้าม key ที่ค่าเป็น `null`/`undefined` ไว้เฉย ๆ (ไม่แปลง 0 → 0 เพราะ 0 ไม่มีปัญหา แปลงตรง ๆ ได้)
 */
export function toSatangFields<T extends Record<string, unknown>>(
  obj: T,
  keys: readonly (keyof T)[]
): T {
  const out = { ...obj };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === "number") (out as Record<string, unknown>)[k as string] = toSatang(v);
  }
  return out;
}

/** ตรงข้ามกับ toSatangFields — ใช้ตอนแปลง document จาก DB (สตางค์) กลับเป็นบาทก่อนส่ง response */
export function toBahtFields<T extends Record<string, unknown>>(
  obj: T,
  keys: readonly (keyof T)[]
): T {
  const out = { ...obj };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === "number") (out as Record<string, unknown>)[k as string] = toBaht(v);
  }
  return out;
}
