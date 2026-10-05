/**
 * schemas/sentiment — validation ของ CRUD แง่มุม (aspect) + พจนานุกรมคำ→แง่มุม (semantic-term)
 * ใช้กับ crudRoutes option `validate: { create, update }` (route: /api/admin/aspects, /semantic-terms)
 */
import { z } from "zod";
import { objectId } from "./common";
import { ASPECT_ICON_KEYS } from "../lib/aspectIcons";

// ── Aspect (แง่มุมการวิเคราะห์ความรู้สึก) ──
// ชื่ออังกฤษไม่กรอก = ใช้ชื่อไทย · icon = key จาก src/lib/aspectIcons.ts (null = ค่าเริ่มต้น) · §8.20
export const aspectCreate = z.object({
  aspect_name_th: z.string().trim().min(1).max(50),
  aspect_name_eng: z.string().trim().max(50).optional(),
  aspect_desc: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
  icon: z.enum(ASPECT_ICON_KEYS).nullable().optional(),
  placeholder_text: z.string().trim().max(200).nullable().optional(),
});
export const aspectUpdate = aspectCreate.extend({ aspect_name_eng: z.string().trim().min(1).max(50) }).partial();

// ── SemanticTerm (คำ + synonyms ผูกกับ aspect_id) ──
export const semanticTermCreate = z.object({
  term: z.string().trim().min(1).max(120),
  synonyms: z.array(z.string().trim().min(1).max(120)).optional(),
  aspect_id: objectId,
  product_ids: z.array(objectId).optional(),
});
export const semanticTermUpdate = semanticTermCreate.partial();
