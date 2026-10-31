// body ของปุ่มแก้ใน modal "ลบยังไม่ได้" (services/deleteBlockerActions.ts)
import { z } from "zod";
import { objectId } from "./common";

export const ingredientUnlinkBody = z.object({
  kind: z.enum(["recipe", "component"]),
  ref_id: objectId,
});

export const releaseRoundBody = z.object({
  round_item_id: objectId,
});

export const componentUnlinkBody = z.object({
  recipe_id: objectId,
});
