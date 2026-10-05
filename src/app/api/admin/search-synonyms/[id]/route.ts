/**
 * /api/admin/search-synonyms/[id]
 *   PATCH  (products.update) { term?, synonyms? } · DELETE (products.delete) — ลบแบบ soft delete (§8.16)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as searchSynonymService from "@/services/searchSynonymService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("products", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const doc = await searchSynonymService.updateSynonym(id, await req.json().catch(() => null));
  audit(req, { action: "แก้ไขคำพ้องค้นหา", action_type: "UPDATE", entity: "SearchSynonym", entity_id: id });
  return ok(doc);
});

export const DELETE = withPermission("products", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const doc = await searchSynonymService.deleteSynonym(id);
  audit(req, { action: "ลบคำพ้องค้นหา", action_type: "DELETE", entity: "SearchSynonym", entity_id: id });
  return ok(doc);
});
