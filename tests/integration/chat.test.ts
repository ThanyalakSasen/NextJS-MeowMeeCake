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
});

describe("แก้ไข / ลบข้อความแชท", () => {
  it("ร้านลบแชท = ซ่อนจากหลังร้าน (ประวัติไม่หาย) · ลูกค้ายังเห็นแชทเดิม · ทักใหม่ = กลับมาพร้อมประวัติเก่า", async () => {
    const user = await makeUser();
    const uid = String(user._id);
    await chatService.sendCustomerMessage(uid, { body: "สวัสดีค่ะ" });
    await chatService.sendCustomerMessage(uid, { body: "ขอถามหน่อย" });
    const { items } = await chatService.listConversations({ pagination: pg });
    const convId = items[0]._id;

    expect(await chatService.deleteConversation(convId)).toMatchObject({ _id: convId, hidden: true });
    expect(await chatMessageModel.countDocuments({ conversation_id: convId })).toBe(2);
    expect((await chatService.listConversations({ pagination: pg })).items).toHaveLength(0);
    expect(await chatService.staffUnreadSummary()).toEqual({ conversations: 0, messages: 0 });
    expect((await chatService.getMyChat(uid, {})).messages.map((m) => m.body)).toEqual(["สวัสดีค่ะ", "ขอถามหน่อย"]);
    await expect(chatService.deleteConversation(convId)).rejects.toMatchObject({ status: 404 });

    await chatService.sendCustomerMessage(uid, { body: "มาใหม่" });
    const again = await chatService.listConversations({ pagination: pg });
    expect(again.items.map((c) => c._id)).toEqual([convId]);
    const staffView = await chatService.getConversationForStaff(convId, {});
    expect(staffView.messages.map((m) => m.body)).toEqual(["สวัสดีค่ะ", "ขอถามหน่อย", "มาใหม่"]);
  });

  it("แก้ข้อความ = เปลี่ยนพรีออเดอร์ที่แนบได้ · ของคนอื่น = 404 · ร้านแนบไม่ได้ = 400", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const uid = String(user._id);
    const pre1 = await makePreorder(uid, { total_amount: 100 });
    const pre2 = await makePreorder(uid, { total_amount: 250 });
    const otherPre = await makePreorder(String(other._id));
    const m = await chatService.sendCustomerMessage(uid, { body: "ถามเรื่องนี้ค่ะ", preorder_id: String(pre1._id) });

    const edited = await chatService.editCustomerMessage(uid, m._id, { body: "ถามเรื่องนี้ค่ะ", preorder_id: String(pre2._id) });
    expect(edited.attachment).toMatchObject({ kind: "preorder", doc_no: pre2.preorder_no, total_amount: 250 });
    expect(edited.edited_at).not.toBeNull();
    const conv = await chatConversationModel.findOne({ customer_id: user._id }).lean<{ _id: unknown; last_message_preview: string }>();
    expect(conv!.last_message_preview).toBe(`[แนบพรีออเดอร์ ${pre2.preorder_no}] ถามเรื่องนี้ค่ะ`);

    await expect(
      chatService.editCustomerMessage(uid, m._id, { body: "x", preorder_id: String(otherPre._id) })
    ).rejects.toMatchObject({ status: 404 });
    const staffMsg = await chatService.sendStaffMessage(String(other._id), String(conv!._id), { body: "ได้ค่ะ" });
    await expect(
      chatService.editStaffMessage(String(conv!._id), staffMsg._id, { body: "ได้ค่ะ", preorder_id: String(pre1._id) })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("ลูกค้าแก้/ลบข้อความตัวเองได้ · ข้อความของร้านแก้ไม่ได้ (404) · ลบแล้วไม่ส่งเนื้อหาออกไป · ร้านแก้/ลบของร้านได้", async () => {
    const user = await makeUser();
    const staff = await makeUser();
    const uid = String(user._id);
    const m1 = await chatService.sendCustomerMessage(uid, { body: "ขอเค้ก 1 ปอนด์" });
    const { items } = await chatService.listConversations({ pagination: pg });
    const convId = items[0]._id;
    const reply = await chatService.sendStaffMessage(String(staff._id), convId, { body: "ได้ค่ะ" });

    const edited = await chatService.editCustomerMessage(uid, m1._id, { body: "ขอเค้ก 2 ปอนด์" });
    expect(edited).toMatchObject({ body: "ขอเค้ก 2 ปอนด์", deleted: false });
    expect(edited.edited_at).not.toBeNull();
    await expect(chatService.editCustomerMessage(uid, m1._id, { body: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(chatService.editCustomerMessage(uid, reply._id, { body: "แอบแก้" })).rejects.toMatchObject({ status: 404 });
    await expect(chatService.deleteCustomerMessage(uid, reply._id)).rejects.toMatchObject({ status: 404 });
    // ลูกค้าคนอื่นแก้ข้อความของคนนี้ไม่ได้
    const other = await makeUser();
    await chatService.sendCustomerMessage(String(other._id), { body: "hi" });
    await expect(chatService.editCustomerMessage(String(other._id), m1._id, { body: "x" })).rejects.toMatchObject({ status: 404 });

    const deleted = await chatService.deleteCustomerMessage(uid, m1._id);
    expect(deleted).toMatchObject({ body: "", deleted: true, attachment: null, edited_at: null });
    await expect(chatService.deleteCustomerMessage(uid, m1._id)).rejects.toMatchObject({ status: 404 });
    await expect(chatService.editCustomerMessage(uid, m1._id, { body: "กลับมา" })).rejects.toMatchObject({ status: 404 });

    const staffView = await chatService.getConversationForStaff(convId, {});
    expect(staffView.messages.map((m) => [m.body, m.deleted])).toEqual([["", true], ["ได้ค่ะ", false]]);

    expect(await chatService.editStaffMessage(convId, reply._id, { body: "ได้เลยค่ะ" })).toMatchObject({ body: "ได้เลยค่ะ" });
    await expect(chatService.editStaffMessage(convId, m1._id, { body: "x" })).rejects.toMatchObject({ status: 404 });
    expect(await chatService.deleteStaffMessage(convId, reply._id)).toMatchObject({ deleted: true });
    const conv = await chatConversationModel.findById(convId).lean<{ last_message_preview: string; customer_unread: number }>();
    expect(conv).toMatchObject({ last_message_preview: "ข้อความถูกลบ", customer_unread: 0 });
  });

  it("polling ?after= ได้ข้อความเก่าที่ถูกแก้/ลบหลังจากนั้นด้วย · ลบข้อความที่ยังไม่อ่าน = ตัวนับยังไม่อ่านลด", async () => {
    const user = await makeUser();
    const uid = String(user._id);
    const m1 = await chatService.sendCustomerMessage(uid, { body: "ข้อความแรก" });
    await new Promise((r) => setTimeout(r, 20));
    const m2 = await chatService.sendCustomerMessage(uid, { body: "ข้อความสอง" });
    expect(await chatService.staffUnreadSummary()).toEqual({ conversations: 1, messages: 2 });
    const { items } = await chatService.listConversations({ pagination: pg });
    const convId = items[0]._id;
    const after = new Date(m2.created_at).toISOString();

    await chatService.editCustomerMessage(uid, m1._id, { body: "ข้อความแรก (แก้)" });
    const poll = await chatService.getConversationForStaff(convId, { after });
    expect(poll.messages.map((m) => m.body)).toEqual(["ข้อความแรก (แก้)", "ข้อความสอง"]);

    await chatService.deleteCustomerMessage(uid, m2._id);
    expect(await chatService.staffUnreadSummary()).toEqual({ conversations: 1, messages: 1 });
    const poll2 = await chatService.getConversationForStaff(convId, { after });
    expect(poll2.messages.find((m) => m._id === m2._id)).toMatchObject({ deleted: true, body: "" });
  });
});
