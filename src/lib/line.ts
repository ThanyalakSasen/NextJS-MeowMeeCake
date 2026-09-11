/**
 * line — ส่ง push message ไปยัง LINE_TARGET_ID ผ่าน LINE Messaging API
 * ใช้คู่กับ notificationService.notify() — ทุกแจ้งเตือนที่บันทึกลง DB จะพยายามส่งซ้ำเข้า LINE ด้วย
 *
 * ตั้งค่าใน .env.local:
 *   LINE_CHANNEL_ACCESS_TOKEN — channel access token ของ LINE Official Account / Messaging API channel
 *   LINE_TARGET_ID            — userId/groupId/roomId ปลายทาง (ขอจาก LINE Developers Console)
 *
 * ไม่ตั้งค่าไว้ (เช่นตอน dev/test) = ข้ามเงียบ ๆ คืน { ok:false, error } ไม่ throw —
 * กันไม่ให้ dev ที่ยังไม่มี LINE channel ใช้งานฟีเจอร์อื่นไม่ได้ไปด้วย
 */
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
/** LINE จำกัดข้อความ text message ไม่เกิน 5000 ตัวอักษร */
const MAX_TEXT_LENGTH = 5000;

export interface LinePushResult {
  ok: boolean;
  error?: string;
}

export async function pushLineMessage(text: string): Promise<LinePushResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_TARGET_ID;
  if (!token || !to) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN/LINE_TARGET_ID" };
  }

  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to,
        messages: [{ type: "text", text: text.slice(0, MAX_TEXT_LENGTH) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `LINE API ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}
