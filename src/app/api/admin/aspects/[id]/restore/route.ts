/** POST /api/admin/aspects/[id]/restore — reports.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { aspectService } from "@/services/sentimentService";

export const { POST } = restoreRoute(aspectService, { auth: { menu: "reports" } });
