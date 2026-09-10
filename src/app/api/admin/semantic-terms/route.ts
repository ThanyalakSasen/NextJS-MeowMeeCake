/**
 * /api/admin/semantic-terms — พจนานุกรมคำ→แง่มุม สำหรับ NLP (reports)
 *   GET  — ?search= ?aspect_id=
 *   POST — body: { term, aspect_id, synonyms?, product_ids? }
 */
import { collectionRoutes } from "@/lib/crudRoutes";
import { semanticTermService } from "@/services/sentimentService";

export const { GET, POST } = collectionRoutes(semanticTermService, {
  sortable: ["created_at", "term"],
  defaultSort: "term",
  filterFromQuery: (sp) => ({ aspect_id: sp.get("aspect_id") ?? undefined }),
  auth: { menu: "reports" },
});
