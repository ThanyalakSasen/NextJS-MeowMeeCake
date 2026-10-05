/** GET /api/catalog/shipping-zones — โซนค่าจัดส่งของออเดอร์เว็บ (A–D ตามจังหวัด · สาธารณะ — docs/customer-backend-merge.md §8.7) */
import { okList, route } from "@/lib/apiResponse";
import * as shippingService from "@/services/shippingService";

export const GET = route(async () => okList(await shippingService.getShippingZones()));
