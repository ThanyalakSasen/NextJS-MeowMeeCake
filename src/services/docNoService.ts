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

export type DailyDocPrefix = "ORD" | "POS" | "PRE";

export async function nextDailyDocNo(prefix: DailyDocPrefix, now: Date = new Date()): Promise<string> {
  const ymd = bangkokDateString(now).replace(/-/g, "");
  return formatDailyDocNo(prefix, ymd, await nextDailySeq(`${prefix}-${ymd}`));
}

/**
 * เลขล็อตสินค้า (บาร์โค้ด Code128 บนฉลากสติกเกอร์ — productLotService) `L<YYMMDD><ลำดับ 4 หลัก>` เช่น L2610280001
 * นับตามวันผลิต ("YYYY-MM-DD") · สั้นและเป็นตัวเลขเกือบทั้งหมด → Code128 บีบเป็นคู่ตัวเลข แท่งกว้างพอให้เครื่องยิงอ่านได้
 * บนฉลากกว้าง ~50 มม. (รูปแบบ LOT-YYYYMMDD-MMC001 ยาวเกิน แท่งบางเกินกว่าเครื่องพิมพ์ความร้อน 203 dpi)
 */
export async function nextLotNo(producedDate: string): Promise<string> {
  const ymd = producedDate.replace(/-/g, "");
  const seq = await nextDailySeq(`LOT-${ymd}`);
  return `L${ymd.slice(2)}${String(seq).padStart(4, "0")}`;
}

async function nextDailySeq(key: string): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await DocCounterModel.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
      ).lean<{ seq: number } | null>();
      return doc!.seq;
    } catch (err) {
      // คำขอแรกของวันมาพร้อมกัน → upsert ตัวหนึ่งชน _id (11000) · ลองใหม่จะเจอเอกสารแล้ว $inc ตามปกติ
      if ((err as { code?: number })?.code === 11000 && attempt < 2) continue;
      throw err;
    }
  }
}
