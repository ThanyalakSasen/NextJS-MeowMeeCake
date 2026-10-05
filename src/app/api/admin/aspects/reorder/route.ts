/**
 * PATCH /api/admin/aspects/reorder — เรียงลำดับแง่มุมในฟอร์มรีวิวใหม่ทั้งชุด (reports.update · ย้ายมาจาก /api/owner/aspects/reorder · §8.20)
 *   body { orderedIds: [...] } → แง่มุมทั้งหมดตามลำดับใหม่
 */
import { okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { reorderAspects } from "@/services/sentimentService";

export const PATCH = withPermission("reports", "update", async (_s, req) => {
  const body = await req.json().catch(() => null);
  const items = await reorderAspects(body?.orderedIds);
  audit(req, { action: "จัดลำดับแง่มุมรีวิว", action_type: "UPDATE", entity: "Aspect" });
  return okList(items);
});
