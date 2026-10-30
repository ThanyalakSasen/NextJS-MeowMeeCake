import { describe, it, expect } from "vitest";
import productionOrderModel from "@/models/productionOrderModel";
import * as productionOrderService from "@/services/productionOrderService";

/** หน้าการผลิตหลังร้าน: ใบที่ยังไม่จบโหลดในคำขอเดียว (หลายสถานะ) · แท็บประวัติให้ backend กรองช่วง (ไม่ต้องโหลดทุกใบมากรองเอง)
 *  ปี 2034 กันข้อมูลเทสอื่นปน */
const page = { page: 1, limit: 100, skip: 0 };
const at = (m: number, d: number) => new Date(Date.UTC(2034, m, d, 3));

async function seed() {
  const tag = `PRD-LF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const mk = (no: string, production_status: string, production_date: Date, completed_at: Date | null = null) =>
    productionOrderModel.create({ production_no: `${tag}-${no}`, source_type: "manual", production_status, production_date, completed_at });
  await mk("planned", "planned", at(0, 10));
  await mk("progress", "in_progress", at(0, 20));
  await mk("done-feb", "done", at(0, 30), at(1, 2)); // วางแผน ม.ค. เสร็จ ก.พ. → อยู่ประวัติ ก.พ.
  await mk("done-jan", "done", at(0, 5), at(0, 6));
  await mk("cancel", "cancelled", at(0, 15));
  return tag;
}
const nos = (r: { items: unknown[] }, tag: string) =>
  (r.items as Array<{ production_no: string }>).map((o) => o.production_no.replace(`${tag}-`, "")).filter((n) => !n.startsWith("PRD")).sort();

describe("listProductionOrders — ตัวกรองของหน้าการผลิต", () => {
  it("production_status หลายค่า = $in", async () => {
    const tag = await seed();
    const r = await productionOrderService.listProductionOrders({ pagination: page, production_status: ["planned", "in_progress"], search: tag });
    expect(nos(r, tag)).toEqual(["planned", "progress"]);
  });

  it("history_from/to: เสร็จแล้วนับตาม completed_at · ใบอื่นตาม production_date", async () => {
    const tag = await seed();
    const jan = await productionOrderService.listProductionOrders({
      pagination: page, search: tag, history_from: at(0, 1).toISOString(), history_to: at(0, 31).toISOString(),
    });
    expect(nos(jan, tag)).toEqual(["cancel", "done-jan", "planned", "progress"]);
    const feb = await productionOrderService.listProductionOrders({
      pagination: page, search: tag, history_from: at(1, 1).toISOString(), history_to: at(1, 28).toISOString(),
    });
    expect(nos(feb, tag)).toEqual(["done-feb"]);
  });
});
