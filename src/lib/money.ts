/**
 * money — หน่วยเงินของระบบ = **บาท** (ทศนิยมไม่เกิน 2 ตำแหน่ง) ทั้งใน DB และที่ API รับ-ส่ง
 *
 * ประวัติ: BACKLOG §3.11 (2026-09-12) เคยเปลี่ยนให้ DB เก็บเป็น "สตางค์" (integer) ส่วน API ยังเป็นบาท
 * **ยกเลิกแล้ว (docs/money-units.md — ตัดสินใจ 2026-10-01):** แอป FrontOffice อ่าน/เขียน MongoDB ตัวเดียวกัน
 * โดยตรงเป็นบาท (`product_price: 35` = 35 บาท) → DB มีสองหน่วยปนกัน ราคาเพี้ยน ×100/÷100 ซ้ำ ๆ
 * (BACKLOG2 §16, BACKLOG4 R7) — จึงกลับมาเก็บเป็นบาทให้ตรงกับ FrontOffice
 *
 * ชื่อฟังก์ชัน toSatang/toBaht คงไว้ (ใช้อยู่ ~130 จุด — เปลี่ยนชื่อ = diff/conflict ใหญ่โดยไม่จำเป็น)
 * แต่ **ทั้งคู่แค่ปัดเป็นบาททศนิยม 2 ตำแหน่ง ไม่คูณ/หาร 100 แล้ว**:
 *   toSatang(x)  = ค่าที่จะ "เก็บลง DB" (บาท ปัด 2 ตำแหน่ง)
 *   toBaht(x)    = ค่าที่จะ "ส่งออก API" (บาท ปัด 2 ตำแหน่ง)
 * กติกา: ปัดทุกครั้งที่คำนวณยอดเสร็จ (คูณราคา×จำนวน / รวมบรรทัด / หักส่วนลด) ก่อนเก็บหรือเทียบค่า —
 * float บวกกันสะสม error ได้ (0.1 + 0.2)
 */

/** ค่าที่จะเก็บลง DB — บาท ปัดทศนิยม 2 ตำแหน่ง (ชื่อเดิมจากสมัยเก็บสตางค์ — ดูหัวไฟล์) */
export function toSatang(baht: number): number {
  return round2(baht);
}

/** ค่าที่จะส่งออก API — บาท ปัดทศนิยม 2 ตำแหน่ง (DB เป็นบาทอยู่แล้ว ไม่ต้องหาร) */
export function toBaht(value: number): number {
  return round2(value);
}

/** คิดเปอร์เซ็นต์ของยอดเงิน (บาท) แล้วปัด 2 ตำแหน่ง */
export function percentOfSatang(amount: number, percent: number): number {
  return round2((amount * percent) / 100);
}

/** ปัดค่าบาทให้เหลือทศนิยม 2 ตำแหน่ง (Number.EPSILON กัน 1.005 → 1.00) */
export function round2(baht: number): number {
  return Math.round((baht + Number.EPSILON) * 100) / 100;
}

/**
 * ปัดทุก key เงินที่ระบุของ object (ตอนรับ input — ชื่อเดิมจากสมัยเก็บสตางค์)
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

/** ปัดทุก key เงินที่ระบุก่อนส่ง response (ชื่อเดิมจากสมัยเก็บสตางค์) */
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
