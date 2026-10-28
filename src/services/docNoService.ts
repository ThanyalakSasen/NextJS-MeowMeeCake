/**
 * docNoService — ออกเลขออเดอร์/พรีออเดอร์รูปแบบ `<prefix>-YYYYMMDD-MMC<ลำดับ>` (เช่น ORD-20261024-MMC001)
 *
 * ลำดับนับใหม่ทุกวันตามเวลาไทย แยกตาม prefix (ORD- เว็บไซต์ · POS- หน้าร้าน · PRE- พรีออเดอร์)
 * ตัวนับอยู่ใน DocCounters (`$inc` atomic) → ไม่ซ้ำกันในวันเดียวกัน · ออเดอร์ที่สร้างไม่สำเร็จทำให้เลขข้ามได้ (ไม่นำกลับมาใช้)
 * ออเดอร์เก่า (สุ่ม 6 ตัว เช่น ORD-20261024-J1HQXF) ไม่ได้เปลี่ยนย้อนหลัง
 */
import DocCounterModel from "../models/docCounterModel";
import { bangkokDateString } from "../lib/datetime";
import { formatDailyDocNo } from "../lib/productCode";

/** LOT = เลขล็อตสินค้าที่ผลิตเสร็จ (บาร์โค้ดบนฉลาก — productLotService) นับตามวันผลิต */
export type DailyDocPrefix = "ORD" | "POS" | "PRE" | "LOT";

export async function nextDailyDocNo(prefix: DailyDocPrefix, now: Date = new Date()): Promise<string> {
  const ymd = bangkokDateString(now).replace(/-/g, "");
  const key = `${prefix}-${ymd}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await DocCounterModel.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
      ).lean<{ seq: number } | null>();
      return formatDailyDocNo(prefix, ymd, doc!.seq);
    } catch (err) {
      // คำขอแรกของวันมาพร้อมกัน → upsert ตัวหนึ่งชน _id (11000) · ลองใหม่จะเจอเอกสารแล้ว $inc ตามปกติ
      if ((err as { code?: number })?.code === 11000 && attempt < 2) continue;
      throw err;
    }
  }
}
