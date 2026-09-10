/** /api/admin/aspects/[id] — GET/PATCH/DELETE (reports) */
import { itemRoutes } from "@/lib/crudRoutes";
import { aspectUpdate } from "@/schemas/sentiment";
import { aspectService } from "@/services/sentimentService";

export const { GET, PATCH, DELETE } = itemRoutes(aspectService, {
  auth: { menu: "reports" },
  validate: { update: aspectUpdate },
});
