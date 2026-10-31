// body ของปุ่มแก้ใน modal "ลบยังไม่ได้" (services/deleteBlockerActions.ts)
import { z } from "zod";
import { objectId } from "./common";

export const ingredientUnlinkBody = z.object({
  kind: z.enum(["recipe", "component"]),
  ref_id: objectId,
});

export const releaseRoundBody = z.object({
  round_item_id: objectId,
  /** true = มีออเดอร์ค้าง — ยกเลิกสินค้าในรอบ (ออเดอร์/การผลิตยังอยู่) แล้วลบสินค้าได้ (releasePreorders) */
  keep_orders: z.boolean().optional(),
});

export const componentUnlinkBody = z.object({
  recipe_id: objectId,
});
