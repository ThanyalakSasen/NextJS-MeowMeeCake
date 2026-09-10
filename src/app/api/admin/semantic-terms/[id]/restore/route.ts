/** POST /api/admin/semantic-terms/[id]/restore — reports.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { semanticTermService } from "@/services/sentimentService";

export const { POST } = restoreRoute(semanticTermService, { auth: { menu: "reports" } });
