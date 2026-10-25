import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import notificationModel from "@/models/notificationModel";
import customerNotificationModel from "@/models/customerNotificationModel";
import chatConversationModel from "@/models/chatConversationModel";
import * as chatService from "@/services/chatService";
import { flushBackground } from "@/lib/backgroundTasks";
import { MENU_KEYS } from "@/services/permissionService";
import { makeUser, makePreorder } from "./helpers";

/** แชทร้าน–ลูกค้า (แทนฟอร์ม "ส่งข้อความหาเรา") */

async function customer(name = "สมหญิง ใจดี") {
  const role = await roleModel.create({ role_name: `customer-${Math.random()}`, role_type: "customer" });
  return String((await makeUser({ role_id: role._id, user_fullname: name }))._id);
}

describe("แชทร้าน–ลูกค้า", () => {
  it("ยังไม่เคยแชท = ไม่มีห้อง · ส่งครั้งแรกสร้างห้อง · ข้อความเรียงเก่า→ใหม่", async () => {
    const uid = await customer();
    expect(await chatService.getMyChat(uid)).toEqual({ conversation: null, messages: [], has_more: false });
    await chatService.sendFromCustomer(uid, { text: "  สั่งเค้กวันเสาร์ได้ไหมคะ  " });
    await chatService.sendFromCustomer(uid, { text: "ขนาด 2 ปอนด์" });
    const chat = await chatService.getMyChat(uid);
    expect(chat.conversation).not.toBeNull();
    expect(chat.messages.map((m) => [m.sender, m.text])).toEqual([
      ["customer", "สั่งเค้กวันเสาร์ได้ไหมคะ"],
      ["customer", "ขนาด 2 ปอนด์"],
    ]);
    expect(await chatConversationModel.countDocuments({ user_id: uid })).toBe(1);
  });

  it("ข้อความว่าง/ยาวเกิน = 400", async () => {
    const uid = await customer();
    await expect(chatService.sendFromCustomer(uid, { text: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(chatService.sendFromCustomer(uid, { text: "ก".repeat(1001) })).rejects.toMatchObject({ status: 400 });
  });

  it("แจ้งหลังร้านเฉพาะข้อความแรกที่ยังไม่อ่าน · ร้านตอบ → ลูกค้าได้กระดิ่งครั้งเดียว · นับยังไม่อ่านถูก", async () => {
    const uid = await customer("ลูกค้าแชท");
    const staff = String((await makeUser({ user_fullname: "พนักงานเอ" }))._id);
    await chatService.sendFromCustomer(uid, { text: "ข้อความ 1" });
    await chatService.sendFromCustomer(uid, { text: "ข้อความ 2" });
    await flushBackground();
    expect(await notificationModel.countDocuments({ title: /แชทจากลูกค้า: ลูกค้าแชท/ })).toBe(1);

    const conv = (await chatConversationModel.findOne({ user_id: uid }).lean<any>())!; // eslint-disable-line @typescript-eslint/no-explicit-any
    const id = String(conv._id);
    expect(conv).toMatchObject({ unread_shop: 2, last_sender: "customer" });
    const list = await chatService.listConversations({ filter: "unanswered", pagination: { page: 1, limit: 50, skip: 0 } });
    expect(list.items.map((c) => c._id)).toContain(id);

    const reply = await chatService.sendFromShop(id, staff, { text: "ได้ค่ะ" });
    expect(reply).toMatchObject({ sender: "shop", text: "ได้ค่ะ", sender_name: "พนักงานเอ" });
    await chatService.sendFromShop(id, staff, { text: "รับที่ร้านนะคะ" });
    await flushBackground();
    expect(await customerNotificationModel.countDocuments({ user_id: uid, ref_type: "chat" })).toBe(1);
    expect(await chatService.myUnread(uid)).toEqual({ unread: 2 });
    expect(await chatConversationModel.findById(id).lean()).toMatchObject({ unread_shop: 0, last_sender: "shop" });

    // ลูกค้าไม่เห็นชื่อพนักงาน
    const mine = await chatService.getMyChat(uid);
    expect(mine.messages.filter((m) => m.sender === "shop").every((m) => m.sender_name === undefined)).toBe(true);
    await chatService.markMyChatRead(uid);
    expect(await chatService.myUnread(uid)).toEqual({ unread: 0 });
  });

  it("?after= ได้เฉพาะข้อความใหม่ · ร้านเห็นข้อมูลลูกค้า · ห้องไม่มีจริง = 404", async () => {
    const uid = await customer();
    const staff = String((await makeUser())._id);
    const first = await chatService.sendFromCustomer(uid, { text: "สวัสดีค่ะ" });
    const conv = (await chatConversationModel.findOne({ user_id: uid }).lean<any>())!; // eslint-disable-line @typescript-eslint/no-explicit-any
    await new Promise((r) => setTimeout(r, 5));
    await chatService.sendFromShop(String(conv._id), staff, { text: "สวัสดีค่ะ ยินดีให้บริการ" });
    const newer = await chatService.getMyChat(uid, { after: first.created_at });
    expect(newer.messages.map((m) => m.text)).toEqual(["สวัสดีค่ะ ยินดีให้บริการ"]);

    const detail = await chatService.getConversationForShop(String(conv._id));
    expect(detail.customer._id).toBe(uid);
    expect(Array.isArray(detail.recent_orders)).toBe(true);
    await expect(chatService.getConversationForShop("64b000000000000000000000")).rejects.toMatchObject({ status: 404 });
  });

  it("สิทธิ์เมนู chat มีใน MENU_KEYS (พนักงานต้องได้รับสิทธิ์ก่อนจึงเห็น/ตอบแชท)", () => {
    expect(MENU_KEYS).toContain("chat");
  });

  it("การ์ดคำสั่งซื้อ: แนบพรีออเดอร์ของตัวเองได้ (ข้อความว่างได้) · ของคนอื่น = 404 · ร้านแนบของลูกค้าห้องนี้ได้", async () => {
    const uid = await customer();
    const other = await customer("คนอื่น");
    const staff = String((await makeUser())._id);
    const mine = await makePreorder(uid);
    const theirs = await makePreorder(other);

    const msg = await chatService.sendFromCustomer(uid, { ref: { kind: "preorder", id: String(mine._id) } });
    expect(msg.text).toBe("");
    expect(msg.card).toMatchObject({ kind: "preorder", id: String(mine._id), missing: false });
    expect(msg.card?.no).toBe((mine as any).preorder_no); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(
      chatService.sendFromCustomer(uid, { text: "อันนี้", ref: { kind: "preorder", id: String(theirs._id) } })
    ).rejects.toMatchObject({ status: 404 });
    await expect(chatService.sendFromCustomer(uid, { ref: { kind: "bill", id: String(mine._id) } })).rejects.toMatchObject({ status: 400 });
    await expect(chatService.sendFromCustomer(uid, {})).rejects.toMatchObject({ status: 400 });

    const conv = (await chatConversationModel.findOne({ user_id: uid }).lean<any>())!; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(conv.last_message_text).toContain("[พรีออเดอร์");
    const reply = await chatService.sendFromShop(String(conv._id), staff, { text: "ตรวจให้แล้วค่ะ", ref: { kind: "preorder", id: String(mine._id) } });
    expect(reply.card?.id).toBe(String(mine._id));
    await expect(
      chatService.sendFromShop(String(conv._id), staff, { ref: { kind: "preorder", id: String(theirs._id) } })
    ).rejects.toMatchObject({ status: 404 });
    const { messages } = await chatService.getMyChat(uid);
    expect(messages.every((m) => m.card?.kind === "preorder")).toBe(true);
  });

  it("ข้อความตอบเร็ว: เพิ่ม (ต่อท้ายลำดับ) · แก้ · ลบ · ข้อความว่าง = 400", async () => {
    const staff = String((await makeUser())._id);
    const a = await chatService.createQuickReply({ title: "ทักทาย", text: "สวัสดีค่ะ" }, staff);
    const b = await chatService.createQuickReply({ text: "ขอบคุณค่ะ" }, staff);
    expect(b.sort_order).toBeGreaterThan(a.sort_order);
    expect((await chatService.listQuickReplies()).items.map((q) => q.text)).toEqual(["สวัสดีค่ะ", "ขอบคุณค่ะ"]);
    expect(await chatService.updateQuickReply(a._id, { text: "สวัสดีค่ะ ยินดีให้บริการ" })).toMatchObject({ title: "ทักทาย", text: "สวัสดีค่ะ ยินดีให้บริการ" });
    await expect(chatService.createQuickReply({ text: "  " }, staff)).rejects.toMatchObject({ status: 400 });
    await chatService.deleteQuickReply(b._id);
    expect((await chatService.listQuickReplies()).items).toHaveLength(1);
    await expect(chatService.deleteQuickReply(b._id)).rejects.toMatchObject({ status: 404 });
  });

  it("แจ้งเตือนแชทไม่ส่ง LINE (ร้าน: line false · ลูกค้า: กระดิ่งอย่างเดียว)", async () => {
    const uid = await customer("ไม่เอาไลน์");
    await chatService.sendFromCustomer(uid, { text: "ทดสอบ" });
    await flushBackground();
    const n = await notificationModel.findOne({ title: /แชทจากลูกค้า: ไม่เอาไลน์/ }).lean<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(n).toBeTruthy();
    expect(n.line_sent ?? false).toBe(false);
  });
});
