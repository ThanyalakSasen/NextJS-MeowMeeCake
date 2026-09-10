/** /api/admin/semantic-terms/[id] — GET/PATCH/DELETE (reports) */
import { itemRoutes } from "@/lib/crudRoutes";
import { semanticTermService } from "@/services/sentimentService";

export const { GET, PATCH, DELETE } = itemRoutes(semanticTermService, { auth: { menu: "reports" } });
