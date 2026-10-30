import { describe, it, expect, vi } from "vitest";
import notificationModel from "@/models/notificationModel";
import customerNotificationModel from "@/models/customerNotificationModel";
import chatConversationModel from "@/models/chatConversationModel";
import chatMessageModel from "@/models/chatMessageModel";
import * as chatService from "@/services/chatService";
import { makePreorder, makeUser } from "./helpers";

/** แชทลูกค้า ↔ ร้าน (services/chatService.ts) — collection chatconversations / chatmessages */

const pg = { page: 1, limit: 20, skip: 0 };

describe("แชทลูกค้า", () => {
  it("ยังไม่เคยคุย = ไม่มีห้อง · ข้อความแรกสร้างห้อง + แจ้งร้านครั้งเดียวต่อรอบที่ยังไม่อ่าน", async () => {
    const user = await makeUser({ user_fullname: "คุณมะลิ" });
    const uid = String(user._id);
    expect(await chatService.getMyChat(uid, {})).toMatchObject({ conversation: null, messages: [] });

    const m1 = await chatService.sendCustomerMessage(uid, { body: "  สวัสดีค่ะ  " });
    expect(m1).toMatchObject({ sender_type: "customer", body: "สวัสดีค่ะ", attachment: null });
    await chatService.sendCustomerMessage(uid, { body: "ขอถามเรื่องเค้กค่ะ" });
    await new Promise((r) => setTimeout(r, 50)); // notify() ทำงานเบื้องหลัง

    expect(await chatConversationModel.countDocuments({ customer_id: user._id })).toBe(1);
    const notes = await notificationModel.find({ module: "customer" }).lean<{ title: string; link: string }[]>();
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("แชทใหม่จากลูกค้า: คุณมะลิ");
    expect(notes[0].link).toMatch(/^\/owner\/chats\?id=/);
    expect(await chatService.staffUnreadSummary()).toEqual({ conversations: 1, messages: 2 });

    const mine = await chatService.getMyChat(uid, {});
    expect(mine.messages.map((m) => m.body)).toEqual(["สวัสดีค่ะ", "ขอถามเรื่องเค้กค่ะ"]);
  });

  it("แนบพรีออเดอร์ของตัวเองได้ · ของคนอื่น = 404 · ว่างทั้งคู่ = 400", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const pre = await makePreorder(String(user._id), { total_amount: 350 });
    const otherPre = await makePreorder(String(other._id));

    const m = await chatService.sendCustomerMessage(String(user._id), { preorder_id: String(pre._id) });
    expect(m.attachment).toMatchObject({ kind: "preorder", doc_no: pre.preorder_no, total_amount: 350 });
    const conv = await chatConversationModel.findOne({ customer_id: user._id }).lean<{ last_message_preview: string }>();
    expect(conv!.last_message_preview).toBe(`[แนบพรีออเดอร์ ${pre.preorder_no}]`);

    await expect(
      chatService.sendCustomerMessage(String(user._id), { preorder_id: String(otherPre._id) })
    ).rejects.toMatchObject({ status: 404 });
    await expect(chatService.sendCustomerMessage(String(user._id), { body: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(chatService.sendCustomerMessage(String(user._id), { body: "ก".repeat(1001) })).rejects.toMatchObject({ status: 400 });
  });

  it("ร้านตอบ → ลูกค้าเห็นตัวเลขยังไม่อ่าน + กระดิ่งในเว็บ · ข้อความลูกค้าถือว่าร้านอ่านแล้ว · ลูกค้าเปิดห้อง = อ่านแล้ว", async () => {
    const user = await makeUser();
    const staff = await makeUser();
    const uid = String(user._id);
    await chatService.sendCustomerMessage(uid, { body: "มีเค้กส้มไหมคะ" });
    const { items } = await chatService.listConversations({ pagination: pg });
    expect(items).toHaveLength(1);
    const convId = items[0]._id;
    expect(items[0].customer?.user_fullname).toBe(user.user_fullname);

    await chatService.sendStaffMessage(String(staff._id), convId, { body: "มีค่ะ" });
    await expect(chatService.sendStaffMessage(String(staff._id), convId, { body: "" })).rejects.toMatchObject({ status: 400 });
    await new Promise((r) => setTimeout(r, 50));

    expect(await chatService.myUnread(uid)).toEqual({ unread: 1 });
    expect(await chatService.staffUnreadSummary()).toEqual({ conversations: 0, messages: 0 });
    expect(await customerNotificationModel.countDocuments({ user_id: user._id, link: "/customer/chat" })).toBe(1);
    expect(await chatMessageModel.countDocuments({ sender_type: "customer", read_at: null })).toBe(0);

    await chatService.markReadByCustomer(uid);
    expect(await chatService.myUnread(uid)).toEqual({ unread: 0 });

    // polling: ?after= เวลาของข้อความล่าสุด → ได้ข้อความนั้น (รวมเวลาเท่ากัน) + ที่ใหม่กว่า
    const all = await chatService.getConversationForStaff(convId, {});
    const last = all.messages[all.messages.length - 1];
    const after = await chatService.getConversationForStaff(convId, { after: new Date(last.created_at).toISOString() });
    expect(after.messages.map((m) => m._id)).toContain(last._id);
  });

  it("ค้นหาห้องจากชื่อลูกค้า · เฉพาะที่ยังไม่อ่าน", async () => {
    const a = await makeUser({ user_fullname: "สมหญิง ใจดี" });
    const b = await makeUser({ user_fullname: "สมชาย" });
    await chatService.sendCustomerMessage(String(a._id), { body: "a" });
    await chatService.sendCustomerMessage(String(b._id), { body: "b" });
    const found = await chatService.listConversations({ pagination: pg, search: "ใจดี" });
    expect(found.items.map((c) => c.customer?.user_fullname)).toEqual(["สมหญิง ใจดี"]);
    const conv = found.items[0]._id;
    await chatService.markReadByStaff(conv);
    const unread = await chatService.listConversations({ pagination: pg, unreadOnly: true });
    expect(unread.items.map((c) => c.customer?.user_fullname)).toEqual(["สมชาย"]);
  });

  it("ข้อความที่เข้ามาระหว่างกด 'อ่านแล้ว' ยังนับเป็นยังไม่อ่าน (เดิมตัวนับถูกตั้งเป็น 0)", async () => {
    const user = await makeUser();
    const uid = String(user._id);
    await chatService.sendCustomerMessage(uid, { body: "ข้อความแรก" });
    const conv = await chatConversationModel.findOne({ customer_id: user._id }).lean<{ _id: unknown }>();

    // ลูกค้าส่งข้อความใหม่หลัง updateMany ทำเสร็จ แต่ก่อนตั้งตัวนับ
    const original = chatMessageModel.updateMany.bind(chatMessageModel);
    vi.spyOn(chatMessageModel, "updateMany").mockImplementationOnce((async (...args: Parameters<typeof original>) => {
      const res = await original(...args);
      await chatMessageModel.create({ conversation_id: conv!._id, sender_type: "customer", sender_id: user._id, body: "แทรกเข้ามา" });
      return res;
    }) as unknown as typeof chatMessageModel.updateMany);

    try {
      expect(await chatService.markReadByStaff(String(conv!._id))).toEqual({ staff_unread: 1 });
    } finally {
      vi.restoreAllMocks();
    }
    const after = await chatConversationModel.findById(conv!._id).lean<{ staff_unread: number }>();
    expect(after?.staff_unread).toBe(1);
    expect(await chatMessageModel.countDocuments({ conversation_id: conv!._id, read_at: null })).toBe(1);
  });
});

describe("รายการแชทหลังร้าน — เฉพาะห้องของบัญชีลูกค้า", () => {
  it("ไม่แสดงห้องรูปแบบเก่า (ไม่มี customer_id) · บัญชีพนักงาน · บัญชีที่ถูกลบ · ตัวนับข้อความที่ยังไม่อ่านนับตาม", async () => {
    const roleModel = (await import("@/models/roleModel")).default;
    const userModel = (await import("@/models/userModel")).default;
    const customerRole = await roleModel.create({ role_name: `ลูกค้า-${Math.random()}`, role_type: "customer" });
    const staffRole = await roleModel.create({ role_name: `พนักงาน-${Math.random()}`, role_type: "staff" });
    const customer = await makeUser({ user_fullname: "ลูกค้าจริง", role_id: customerRole._id });
    const staff = await makeUser({ user_fullname: "พนักงานลองแชท", role_id: staffRole._id });
    const gone = await makeUser({ user_fullname: "ลูกค้าที่ลบแล้ว", role_id: customerRole._id });
    for (const u of [customer, staff, gone]) await chatService.sendCustomerMessage(String(u._id), { body: "สวัสดี" });
    await userModel.updateOne({ _id: gone._id }, { $set: { deleted_at: new Date() } });
    // ห้องจาก schema เดิม (user_id แทน customer_id)
    await chatConversationModel.collection.insertOne({ user_id: customer._id, last_message_at: new Date(), staff_unread: 3 });

    const { items, meta } = await chatService.listConversations({ pagination: pg });
    expect(items.map((c) => c.customer?.user_fullname)).toEqual(["ลูกค้าจริง"]);
    expect(meta.total).toBe(1);
    expect(await chatService.staffUnreadSummary()).toEqual({ conversations: 1, messages: 1 });
  });
  it("แก้/ลบข้อความของฝั่งตัวเอง · เปลี่ยนพรีออเดอร์ที่แนบ · polling ?after= ส่งข้อความที่เปลี่ยนมาด้วย · ร้านลบแชทได้ (ซ่อน — ประวัติไม่หาย)", async () => {
    const user = await makeUser();
    const staff = await makeUser();
    const uid = String(user._id);
    const p1 = await makePreorder(uid);
    const p2 = await makePreorder(uid);
    const m = await chatService.sendCustomerMessage(uid, { body: "ถามหน่อย", preorder_id: String(p1._id) });
    const { items } = await chatService.listConversations({ pagination: pg });
    const convId = items[0]._id;
    const cursor = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));

    const edited = await chatService.editCustomerMessage(uid, m._id, { body: "ถามใหม่", preorder_id: String(p2._id) });
    expect(edited).toMatchObject({ body: "ถามใหม่", attachment: { doc_no: p2.preorder_no } });
    expect(edited.edited_at).not.toBeNull();
    const polled = await chatService.getConversationForStaff(convId, { after: cursor });
    expect(polled.messages.map((x) => x.body)).toContain("ถามใหม่");

    // ร้านแก้ข้อความลูกค้าไม่ได้ · ลูกค้าแก้ข้อความร้านไม่ได้
    await expect(chatService.editStaffMessage(convId, m._id, { body: "x" })).rejects.toMatchObject({ status: 404 });
    const s1 = await chatService.sendStaffMessage(String(staff._id), convId, { body: "ตอบ" });
    await expect(chatService.deleteCustomerMessage(uid, s1._id)).rejects.toMatchObject({ status: 404 });
    expect(await chatService.editStaffMessage(convId, s1._id, { body: "ตอบใหม่" })).toMatchObject({ body: "ตอบใหม่" });
    expect(await chatService.myUnread(uid)).toEqual({ unread: 1 });

    // ลบข้อความที่ยังไม่อ่าน = ตัวเลขยังไม่อ่านลดตาม · ไม่แสดงในห้องอีก
    await chatService.deleteStaffMessage(convId, s1._id);
    expect(await chatService.myUnread(uid)).toEqual({ unread: 0 });
    expect((await chatService.getMyChat(uid, {})).messages.map((x) => x._id)).toEqual([m._id]);

    // ร้านลบแชท = ซ่อนจากรายการ ประวัติยังอยู่ · ลูกค้าส่งใหม่ = กลับมาพร้อมประวัติเก่า
    await chatService.deleteConversation(convId);
    expect((await chatService.listConversations({ pagination: pg })).items).toHaveLength(0);
    expect((await chatService.getMyChat(uid, {})).messages.map((x) => x._id)).toEqual([m._id]);
    const again = await chatService.sendCustomerMessage(uid, { body: "กลับมาแล้ว" });
    const back = await chatService.listConversations({ pagination: pg });
    expect(back.items.map((c) => c._id)).toEqual([convId]);
    expect((await chatService.getConversationForStaff(convId, {})).messages.map((x) => x._id)).toEqual([m._id, again._id]);
  });
});
