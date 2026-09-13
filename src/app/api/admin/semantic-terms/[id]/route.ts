/** /api/admin/semantic-terms/[id] — GET/PATCH/DELETE (reports) */
import { itemRoutes } from "@/lib/crudRoutes";
import { semanticTermUpdate } from "@/schemas/sentiment";
import { semanticTermService } from "@/services/sentimentService";

export const { GET, PATCH, DELETE } = itemRoutes(semanticTermService, {
  auth: { menu: "reports" },
  audit: { entity: "SemanticTerm" },
  validate: { update: semanticTermUpdate },
});
