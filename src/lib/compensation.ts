/**
 * compensation — Saga-lite สำหรับงานหลายขั้นที่ไม่มี transaction (MongoDB standalone)
 *
 *   const saga = new Saga();
 *   try {
 *     await deductStock();
 *     saga.onRollback("restock", () => restock());       // บันทึก undo หลัง action สำเร็จ
 *     await createOrder();
 *     saga.onRollback("delete-order", () => deleteOrder());
 *     saga.commit();                                       // ทุกขั้นสำเร็จ → ทิ้ง undo
 *   } catch (err) {
 *     await saga.rollback();                               // undo ย้อนลำดับ · best-effort · ไม่ throw ต่อ
 *     throw err;
 *   }
 *
 * - rollback รัน undo แบบ reverse order (ขั้นล่าสุดก่อน)
 * - undo ที่ throw → log ผ่าน logger แล้วไปต่อขั้นถัดไป (ไม่ให้ rollback ล้มกลางคัน)
 */
import { log } from "./logger";

interface Step {
  label: string;
  undo: () => Promise<unknown>;
}

export class Saga {
  private steps: Step[] = [];

  /** บันทึก undo — เรียกหลังจาก action ที่มี side effect สำเร็จแล้วเท่านั้น */
  onRollback(label: string, undo: () => Promise<unknown>): void {
    this.steps.push({ label, undo });
  }

  /** จำนวน undo ที่ค้างอยู่ (ไว้ตรวจ/เทส) */
  get size(): number {
    return this.steps.length;
  }

  /** ทิ้ง undo ทั้งหมด — เรียกเมื่อ transaction สำเร็จครบ */
  commit(): void {
    this.steps = [];
  }

  /** รัน undo ทุกขั้นแบบย้อนลำดับ · best-effort (undo ที่ fail = log แล้วไปต่อ) */
  async rollback(): Promise<void> {
    const pending = this.steps.splice(0);
    for (let i = pending.length - 1; i >= 0; i--) {
      const { label, undo } = pending[i];
      try {
        await undo();
      } catch (err) {
        log.error("saga.rollback_step_failed", { step: label, err });
      }
    }
  }
}
