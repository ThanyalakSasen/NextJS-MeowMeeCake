/**
 * /api/shop/push — แจ้งเตือนบนเครื่องของลูกค้า (Web Push)
 *   GET    → { enabled, public_key } (backend ตั้ง VAPID key แล้วหรือยัง)
 *   POST   body: PushSubscription.toJSON() { endpoint, keys: { p256dh, auth } } → เปิดรับบนเครื่องนี้
 *   DELETE body: { endpoint } → ปิดบนเครื่องนี้
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { pushSubscribe, pushUnsubscribe } from "@/schemas/push";
import * as pushService from "@/services/pushService";

export const GET = withAuth(async () => ok(pushService.pushConfig()));

export const POST = withAuth(async (session, req) => {
  const body = await parseBody(req, pushSubscribe);
  return ok(await pushService.subscribe(session.user_id, body, req.headers.get("user-agent")));
});

export const DELETE = withAuth(async (session, req) => {
  const { endpoint } = await parseBody(req, pushUnsubscribe);
  return ok(await pushService.unsubscribe(session.user_id, endpoint));
});
