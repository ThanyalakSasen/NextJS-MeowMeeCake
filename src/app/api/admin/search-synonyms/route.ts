/**
 * /api/admin/search-synonyms — จัดการคำพ้องค้นหาสินค้า (ย้ายมาจากฝั่งลูกค้า /api/owner/search-synonyms · §8.16)
 *   GET  (products.view)   → กลุ่มคำทั้งหมด เรียงตามคำหลัก
 *   POST (products.create) { term, synonyms[] } → 201 · คำหลักซ้ำ (ไม่สนตัวพิมพ์/วรรณยุกต์) = 409 · คำสั้นกว่า 2 ตัว = 400
 */
import { created, okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as searchSynonymService from "@/services/searchSynonymService";

export const GET = withPermission("products", "view", async () => okList(await searchSynonymService.listSynonyms()));

export const POST = withPermission("products", "create", async (_s, req) => {
  const doc = (await searchSynonymService.createSynonym(await req.json().catch(() => null))) as { _id: unknown; term: string };
  audit(req, { action: `เพิ่มคำพ้องค้นหา "${doc.term}"`, action_type: "CREATE", entity: "SearchSynonym", entity_id: String(doc._id) });
  return created(doc);
});
