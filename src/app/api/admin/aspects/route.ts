/** /api/admin/aspects — แง่มุมการวิเคราะห์ความรู้สึก GET/POST (reports) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { aspectCreate } from "@/schemas/sentiment";
import { aspectService } from "@/services/sentimentService";

export const { GET, POST } = collectionRoutes(aspectService, {
  sortable: ["created_at", "aspect_name_th", "aspect_name_eng"],
  defaultSort: "aspect_name_th",
  auth: { menu: "reports" },
  validate: { create: aspectCreate },
});
