import { describe, it, expect } from "vitest";
import chatConversationModel from "@/models/chatConversationModel";
import chatMessageModel from "@/models/chatMessageModel";
import * as chatService from "@/services/chatService";
import { makeUser } from "./helpers";

/** ข้อ 17: polling ?after= ใช้เวลาอย่างเดียว — ข้อความ updated_at เท่ากันเกิน limit (กดอ่านแล้วทีเดียว) ทำให้ cursor ไม่ขยับ */
describe("chat polling cursor (updated_at, _id)", () => {
  it("ข้อความเวลาเดียวกัน 35 ข้อความ: after + after_id ไล่ได้ครบ ไม่ค้างชุดเดิม", async () => {
    const user = await makeUser();
    await chatService.sendCustomerMessage(String(user._id), { body: "เริ่ม" });
    const conv = await chatConversationModel.findOne({ customer_id: user._id }).lean<{ _id: unknown }>();
    const at = new Date("2034-01-01T00:00:00.000Z");
    await chatMessageModel.collection.insertMany(
      Array.from({ length: 35 }, (_, i) => ({
        conversation_id: conv!._id,
        sender_type: "customer",
        body: `m${i}`,
        attachment: null,
        read_at: at,
        deleted_at: null,
        created_at: at,
        updated_at: at,
      }))
    );
    const convId = String(conv!._id);
    const iso = at.toISOString();

    const first = await chatService.getConversationForStaff(convId, { after: iso });
    expect(first.messages).toHaveLength(30);
    expect(first.has_more).toBe(true);

    // แบบเดิม (ไม่มี after_id) — ขอซ้ำได้ 30 ตัวแรกชุดเดิม = ค้าง
    const again = await chatService.getConversationForStaff(convId, { after: iso });
    expect(again.messages.map((m) => m._id)).toEqual(first.messages.map((m) => m._id));

    const last = first.messages[first.messages.length - 1];
    const next = await chatService.getConversationForStaff(convId, {
      after: new Date(last.updated_at).toISOString(),
      after_id: last._id,
    });
    expect(next.messages).toHaveLength(5);
    expect(next.has_more).toBe(false);
    const all = new Set([...first.messages, ...next.messages].map((m) => m._id));
    expect(all.size).toBe(35);
  });

  it("after_id รูปแบบผิด = 400", async () => {
    const user = await makeUser();
    await chatService.sendCustomerMessage(String(user._id), { body: "x" });
    await expect(
      chatService.getMyChat(String(user._id), { after: new Date().toISOString(), after_id: "nope" })
    ).rejects.toMatchObject({ status: 400 });
  });
});
