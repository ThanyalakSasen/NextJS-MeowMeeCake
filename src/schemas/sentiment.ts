/**
 * schemas/sentiment — validation ของ CRUD แง่มุม (aspect) + พจนานุกรมคำ→แง่มุม (semantic-term)
 * ใช้กับ crudRoutes option `validate: { create, update }` (route: /api/admin/aspects, /semantic-terms)
 */
import { z } from "zod";
import { objectId } from "./common";

// ── Aspect (แง่มุมการวิเคราะห์ความรู้สึก) ──
export const aspectCreate = z.object({
  aspect_name_th: z.string().trim().min(1).max(100),
  aspect_name_eng: z.string().trim().min(1).max(100),
  aspect_desc: z.string().trim().max(500).nullable().optional(),
});
export const aspectUpdate = aspectCreate.partial();

// ── SemanticTerm (คำ + synonyms ผูกกับ aspect_id) ──
export const semanticTermCreate = z.object({
  term: z.string().trim().min(1).max(120),
  synonyms: z.array(z.string().trim().min(1).max(120)).optional(),
  aspect_id: objectId,
  product_ids: z.array(objectId).optional(),
});
export const semanticTermUpdate = semanticTermCreate.partial();
