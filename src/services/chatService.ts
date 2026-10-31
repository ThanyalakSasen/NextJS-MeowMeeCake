/**
 * chatService — แชทลูกค้า ↔ ร้าน (แทนฟอร์ม "ส่งข้อความหาเรา" · collection chatconversations / chatmessages)
 *
 * - ลูกค้า 1 คน = 1 ห้อง สร้างตอนส่งข้อความแรก (GET ไม่สร้างห้องเปล่า)
 * - 1 ข้อความ = ข้อความตัวอักษร และ/หรือ แนบคำสั่งซื้อ/พรีออเดอร์ของลูกค้าเอง 1 รายการ (ตรวจว่าเป็นของคนส่ง)
 * - หน้าเว็บดึงข้อความใหม่แบบ polling: ?after=<ISO เวลาของข้อความล่าสุดที่มี> → คืนข้อความตั้งแต่เวลานั้น (รวมเวลาเท่ากัน —
 *   หลาย instance สร้างข้อความเวลาเดียวกันได้ client ตัดตัวซ้ำด้วย _id) · ไม่ส่ง after = ข้อความล่าสุด N รายการ ·
 *   ?before= = ย้อนดูข้อความเก่ากว่า
 * - แก้ไข/ลบข้อความ: แต่ละฝั่งแก้/ลบได้เฉพาะข้อความของฝั่งตัวเอง (ลูกค้าเปลี่ยนคำสั่งซื้อที่แนบได้) · ลบ = soft delete
 *   polling ?after= คืนทั้งข้อความใหม่และข้อความที่ "เปลี่ยน" ตั้งแต่เวลานั้น (updated_at — แก้ไข/ลบ/อ่านแล้ว) — client ใช้ updated_at ล่าสุดเป็น cursor
 * - ร้าน "ลบแชท" ได้ (chats.delete) = ซ่อนห้องจากรายการหลังร้าน (hidden_at) — ประวัติไม่ถูกลบ
 *   ลูกค้าส่งข้อความใหม่ = ห้องกลับมาในรายการพร้อมประวัติเก่าทั้งหมด
 * - แจ้งเตือน: ลูกค้าส่งข้อความตอนร้านอ่านครบแล้ว (staff_unread = 0) → แจ้งเตือนหลังร้าน หมวด "ลูกค้า" (+ LINE เจ้าของร้าน)
 *   ครั้งเดียวต่อรอบ ไม่ยิงทุกข้อความ (กันโควตา LINE หมด) · ร้านตอบ → กระดิ่งในเว็บของลูกค้า (ไม่ส่ง LINE ลูกค้า) เฉพาะข้อความแรกที่ยังไม่อ่าน
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { Types } from "mongoose";
import { isObjectId } from "../lib/objectId";
import { rateLimit } from "../lib/rateLimit";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import chatConversationModel from "../models/chatConversationModel";
import chatMessageModel from "../models/chatMessageModel";
import orderModel from "../models/orderModel";
import preorderModel from "../models/preorderModel";
import orderItemModel from "../models/orderItemModel";
import preorderItemModel from "../models/preorderItemModel";
import userModel from "../models/userModel";
import roleModel from "../models/roleModel";
import { notificationService } from "./notificationService";
import { notifyCustomerLater } from "./customerNotifyService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const CHAT_MESSAGE_MAX_LENGTH = 1000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
/** ส่งได้ไม่เกิน 20 ข้อความ/นาที/บัญชี (กันกดรัว/สคริปต์) */
const SEND_LIMIT = { limit: 20, windowMs: 60_000 };
export const CHAT_ADMIN_PATH = "/owner/chats";
export const CHAT_CUSTOMER_PATH = "/customer/chat";

export type SenderType = "customer" | "staff";
export type AttachmentKind = "order" | "preorder";

export interface SendInput {
  body?: unknown;
  /** แนบคำสั่งซื้อ (ลูกค้าเท่านั้น) */
  order_id?: unknown;
  /** แนบพรีออเดอร์ (ลูกค้าเท่านั้น) */
  preorder_id?: unknown;
}

export interface MessageQuery {
  after?: string | null;
  /** cursor คู่กับ after: _id ของข้อความสุดท้ายที่ได้รับ (updated_at = after) — ส่งมา = คืนเฉพาะที่ "หลัง" คู่ (updated_at, _id) นั้น */
  after_id?: string | null;
  before?: string | null;
  limit?: unknown;
}

// ── presenter ────────────────────────────────────────────────
function presentMessage(m: any) {
  const deleted = !!m.deleted_at;
  return {
    _id: String(m._id),
    conversation_id: String(m.conversation_id),
    sender_type: m.sender_type as SenderType,
    body: deleted ? "" : m.body ?? "",
    attachment: !deleted && m.attachment
      ? {
          kind: m.attachment.kind as AttachmentKind,
          ref_id: String(m.attachment.ref_id),
          doc_no: m.attachment.doc_no,
          order_status: m.attachment.order_status ?? null,
          payment_status: m.attachment.payment_status ?? null,
          order_type: m.attachment.order_type ?? null,
          total_amount: Number(m.attachment.total_amount ?? 0),
          item_count: Number(m.attachment.item_count ?? 0),
          first_item_name: m.attachment.first_item_name ?? "",
          ordered_at: m.attachment.ordered_at ?? null,
        }
      : null,
    read_at: m.read_at ?? null,
    edited_at: m.edited_at ?? null,
    /** true = ถูกลบแล้ว (polling ส่งมาให้ client เอาออกจากจอ) */
    deleted,
    created_at: m.created_at,
    updated_at: m.updated_at ?? m.created_at,
  };
}
export type ChatMessageDto = ReturnType<typeof presentMessage>;

function presentConversation(c: any) {
  const customer = c.customer_id && typeof c.customer_id === "object" && "user_fullname" in c.customer_id ? c.customer_id : null;
  return {
    _id: String(c._id),
    customer_id: String(customer?._id ?? c.customer_id),
    customer: customer
      ? {
          _id: String(customer._id),
          user_fullname: customer.user_fullname ?? "",
          user_phone: customer.user_phone ?? null,
          email: customer.email ?? "",
          user_img: customer.user_img ?? null,
        }
      : null,
    last_message_at: c.last_message_at ?? null,
    last_message_preview: c.last_message_preview ?? "",
    last_sender_type: c.last_sender_type ?? null,
    customer_unread: Number(c.customer_unread ?? 0),
    staff_unread: Number(c.staff_unread ?? 0),
    created_at: c.created_at,
  };
}

// ── helpers ──────────────────────────────────────────────────
function parseDate(v: string | null | undefined, field: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`รูปแบบ ${field} ไม่ถูกต้อง`);
  return d;
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_LIMIT, Math.floor(n)) : DEFAULT_LIMIT;
}

/** ข้อความในห้อง เรียงเก่า → ใหม่ (เหมือนหน้าจอแชท) */
async function loadMessages(conversationId: unknown, q: MessageQuery) {
  const limit = clampLimit(q.limit);
  const after = parseDate(q.after, "after");
  const before = parseDate(q.before, "before");
  const filter: Record<string, unknown> = { conversation_id: conversationId };
  if (after) {
    // ข้อความใหม่ + ข้อความที่แก้ไข/ลบ/อ่านแล้ว ตั้งแต่ after · ข้อความใหม่ updated_at = created_at → ใช้ updated_at อย่างเดียวพอ
    // รวมที่ถูกลบ (deleted: true) ให้อีกฝั่งเอาออก
    // after_id (เอกสารบั๊กข้อ 17): cursor คู่ (updated_at, _id) — เดิมใช้เวลาอย่างเดียวแบบ $gte: ข้อความที่ updated_at
    // เท่ากันเกิน limit (เช่น กดอ่านแล้วทีเดียว 30+ ข้อความ) → ทุกรอบได้ 30 ตัวแรกชุดเดิม cursor ไม่ขยับ = แชทค้าง
    // ไม่ส่ง after_id = แบบเดิม (รวมเวลาเท่ากัน — client รุ่นเก่าตัดซ้ำด้วย _id)
    const afterId = q.after_id ? String(q.after_id) : null;
    if (afterId && !isObjectId(afterId)) throw badRequest("รูปแบบ after_id ไม่ถูกต้อง");
    if (afterId) {
      filter.$or = [
        { updated_at: { $gt: after } },
        { updated_at: after, _id: { $gt: new Types.ObjectId(afterId) } },
      ];
    } else {
      filter.updated_at = { $gte: after };
    }
    const rows = await chatMessageModel.find(filter).sort({ updated_at: 1, _id: 1 }).limit(limit + 1).lean<any[]>();
    // has_more = ยังมีที่เปลี่ยนอีก (เกิน limit) — client ขอต่อทันทีด้วย cursor ตัวสุดท้าย ไม่ต้องรอรอบ poll
    return { items: rows.slice(0, limit).map(presentMessage), has_more: rows.length > limit };
  }
  filter.deleted_at = null;
  if (before) filter.created_at = { $lt: before };
  const rows = await chatMessageModel.find(filter).sort({ created_at: -1, _id: -1 }).limit(limit + 1).lean<any[]>();
  const has_more = rows.length > limit;
  return { items: rows.slice(0, limit).reverse().map(presentMessage), has_more };
}

function cleanBody(raw: unknown): string {
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (body.length > CHAT_MESSAGE_MAX_LENGTH) throw badRequest(`ข้อความยาวได้ไม่เกิน ${CHAT_MESSAGE_MAX_LENGTH} ตัวอักษร`);
  return body;
}

/** ภาพคำสั่งซื้อ ณ ตอนแนบ — ต้องเป็นของลูกค้าคนนี้ ไม่งั้น 404 (ไม่บอกว่ามีอยู่จริงไหม) */
async function buildAttachment(customerId: string, input: SendInput) {
  const orderId = input.order_id ?? null;
  const preorderId = input.preorder_id ?? null;
  if (orderId == null && preorderId == null) return null;
  if (orderId != null && preorderId != null) throw badRequest("แนบได้ครั้งละ 1 รายการ");
  const kind: AttachmentKind = orderId != null ? "order" : "preorder";
  const id = orderId ?? preorderId;
  if (!isObjectId(id)) throw badRequest("รูปแบบคำสั่งซื้อที่แนบไม่ถูกต้อง");

  const model: any = kind === "order" ? orderModel : preorderModel;
  const doc = await model
    .findOne({ _id: id, user_id: customerId, deleted_at: null })
    .select("order_no preorder_no order_status payment_status order_type total_amount created_at")
    .lean();
  if (!doc) throw notFound("ไม่พบคำสั่งซื้อที่แนบ");

  const itemModel: any = kind === "order" ? orderItemModel : preorderItemModel;
  const items = await itemModel
    .find(kind === "order" ? { order_id: doc._id, deleted_at: null } : { preorder_id: doc._id, deleted_at: null })
    .select("product_name_th quantity")
    .sort({ _id: 1 })
    .lean();
  return {
    kind,
    ref_id: doc._id,
    doc_no: String(kind === "order" ? doc.order_no : doc.preorder_no),
    order_status: doc.order_status ?? null,
    payment_status: doc.payment_status ?? null,
    order_type: doc.order_type ?? null,
    total_amount: Number(doc.total_amount ?? 0),
    item_count: items.reduce((s: number, it: any) => s + Number(it.quantity ?? 0), 0),
    first_item_name: String(items[0]?.product_name_th ?? ""),
    ordered_at: doc.created_at ?? null,
  };
}

function previewOf(body: string, attachment: { kind: AttachmentKind; doc_no: string } | null): string {
  const tag = attachment ? `[แนบ${attachment.kind === "order" ? "คำสั่งซื้อ" : "พรีออเดอร์"} ${attachment.doc_no}]` : "";
  return [tag, body].filter(Boolean).join(" ").slice(0, 200);
}

async function saveMessage(conversationId: unknown, senderType: SenderType, senderId: string, body: string, attachment: any) {
  const msg = await chatMessageModel.create({
    conversation_id: conversationId,
    sender_type: senderType,
    sender_id: senderId,
    body,
    attachment,
  });
  const unreadField = senderType === "customer" ? "staff_unread" : "customer_unread";
  // คืนห้อง "ก่อน" อัปเดต — ใช้ดูว่าอีกฝั่งอ่านครบแล้วหรือยัง (ตัดสินว่าจะแจ้งเตือนไหม)
  const before = await chatConversationModel
    .findOneAndUpdate(
      { _id: conversationId },
      {
        $set: { last_message_at: msg.created_at, last_message_preview: previewOf(body, attachment), last_sender_type: senderType },
        $inc: { [unreadField]: 1 },
      },
      { returnDocument: "before" }
    )
    .lean<any>();
  return { msg: presentMessage(msg.toObject()), wasUnread: Number(before?.[unreadField] ?? 0) };
}

// ── ฝั่งลูกค้า (/api/shop/chat) ───────────────────────────────
/** ห้องของฉัน + ข้อความ · ยังไม่เคยคุย = conversation null */
export async function getMyChat(customerId: string, q: MessageQuery) {
  await dbConnect();
  const conv = await chatConversationModel.findOne({ customer_id: customerId }).lean<any>();
  if (!conv) return { conversation: null, messages: [], has_more: false };
  const { items, has_more } = await loadMessages(conv._id, q);
  return { conversation: presentConversation(conv), messages: items, has_more };
}

/** จำนวนข้อความจากร้านที่ยังไม่อ่าน (ป้ายตัวเลขบน Navbar — polling เบา ๆ) */
export async function myUnread(customerId: string) {
  await dbConnect();
  const conv = await chatConversationModel.findOne({ customer_id: customerId }).select("customer_unread").lean<any>();
  return { unread: Number(conv?.customer_unread ?? 0) };
}

export async function sendCustomerMessage(customerId: string, input: SendInput | null) {
  if (!input || typeof input !== "object") throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  const body = cleanBody(input.body);
  await dbConnect();
  const attachment = await buildAttachment(customerId, input);
  if (!body && !attachment) throw badRequest("กรุณาพิมพ์ข้อความหรือแนบคำสั่งซื้อ");

  const user = await userModel
    .findOne({ _id: customerId, deleted_at: null })
    .select("user_fullname")
    .lean<{ user_fullname?: string } | null>();
  if (!user) throw notFound("ไม่พบบัญชีผู้ใช้");

  // นับหลังตรวจข้อมูลผ่าน (กรอกผิดแล้วแก้ส่งใหม่ได้ทันที)
  await rateLimit(customerId, "shop:chat", SEND_LIMIT);

  const conv = await chatConversationModel
    // ห้องที่ร้านเคยลบ (ซ่อน) กลับมาแสดงในรายการ — พร้อมประวัติเดิม
    .findOneAndUpdate(
      { customer_id: customerId },
      { $setOnInsert: { customer_id: customerId }, $set: { hidden_at: null } },
      { upsert: true, returnDocument: "after" }
    )
    .lean<any>();
  const { msg, wasUnread } = await saveMessage(conv._id, "customer", customerId, body, attachment);

  // แจ้งร้านเฉพาะข้อความแรกของรอบที่ยังไม่อ่าน — ไม่ยิงทุกข้อความ (โควตา LINE)
  if (wasUnread === 0) {
    void notificationService.notify({
      title: `แชทใหม่จากลูกค้า: ${user.user_fullname || "ลูกค้า"}`,
      message: previewOf(body, attachment) || "ส่งข้อความใหม่",
      module: "customer",
      type: "info",
      link: `${CHAT_ADMIN_PATH}?id=${String(conv._id)}`,
    });
  }
  return msg;
}

/** ลูกค้าเปิดห้อง → ข้อความจากร้านทั้งหมดถือว่าอ่านแล้ว */
export async function markReadByCustomer(customerId: string) {
  await dbConnect();
  const conv = await chatConversationModel.findOne({ customer_id: customerId }).select("_id").lean<any>();
  if (!conv) return { unread: 0 };
  return { unread: await markRead(conv._id, "staff") };
}

// ── ฝั่งร้าน (/api/admin/chats) ───────────────────────────────
/**
 * แสดงเฉพาะห้องของ "บัญชีลูกค้า" ที่ยังใช้งานอยู่ (ผู้ใช้เลือก 2026-10-27):
 *   ตัดห้องรูปแบบเก่าที่ไม่มี customer_id (ข้อมูลจาก schema เดิม — ขึ้นเป็นแถวไม่มีชื่อ/ซ้ำ) · บัญชีพนักงาน/เจ้าของ · บัญชีที่ถูกลบ
 */
async function customerRoomFilter(): Promise<Record<string, unknown>> {
  const staffRoles = await roleModel.find({ role_type: { $ne: "customer" } }).select("_id").lean<{ _id: unknown }[]>();
  const excluded = await userModel
    .find({ $or: [{ role_id: { $in: staffRoles.map((r) => r._id) } }, { deleted_at: { $ne: null } }] })
    .select("_id")
    .lean<{ _id: unknown }[]>();
  return { $exists: true, $ne: null, $nin: excluded.map((u) => u._id) };
}

export async function listConversations(opts: { pagination: Pagination; search?: string; unreadOnly?: boolean }) {
  await dbConnect();
  const customerFilter = await customerRoomFilter();
  const filter: Record<string, unknown> = { last_message_at: { $ne: null }, hidden_at: null, customer_id: customerFilter };
  if (opts.unreadOnly) filter.staff_unread = { $gt: 0 };
  const search = opts.search?.trim();
  if (search) {
    const re = new RegExp(escapeRegExp(search), "i");
    const users = await userModel
      .find({ $or: [{ user_fullname: re }, { user_phone: re }, { email: re }] })
      .select("_id")
      .limit(500)
      .lean<{ _id: unknown }[]>();
    filter.customer_id = { ...customerFilter, $in: users.map((u) => u._id) };
  }
  const [rows, total] = await Promise.all([
    chatConversationModel
      .find(filter)
      .sort({ last_message_at: -1 })
      .skip(opts.pagination.skip)
      .limit(opts.pagination.limit)
      .populate("customer_id", "user_fullname user_phone email user_img")
      .lean<any[]>(),
    chatConversationModel.countDocuments(filter),
  ]);
  return { items: rows.map(presentConversation), meta: buildMeta(total, opts.pagination) };
}

/** จำนวนห้องที่มีข้อความลูกค้ายังไม่อ่าน (ป้ายตัวเลขเมนู "แชทลูกค้า") */
export async function staffUnreadSummary() {
  await dbConnect();
  // นับเฉพาะห้องที่แสดงในรายการ (ห้องของบัญชีลูกค้า — customerRoomFilter)
  const match = { staff_unread: { $gt: 0 }, hidden_at: null, customer_id: await customerRoomFilter() };
  const [conversations, agg] = await Promise.all([
    chatConversationModel.countDocuments(match),
    chatConversationModel.aggregate([{ $match: match }, { $group: { _id: null, n: { $sum: "$staff_unread" } } }]),
  ]);
  return { conversations, messages: Number(agg[0]?.n ?? 0) };
}

async function findConversation(id: string) {
  if (!isObjectId(id)) throw badRequest("รูปแบบ id ไม่ถูกต้อง");
  const conv = await chatConversationModel
    .findById(id)
    .populate("customer_id", "user_fullname user_phone email user_img")
    .lean<any>();
  if (!conv) throw notFound("ไม่พบห้องแชท");
  return conv;
}

export async function getConversationForStaff(id: string, q: MessageQuery) {
  await dbConnect();
  const conv = await findConversation(id);
  const { items, has_more } = await loadMessages(conv._id, q);
  return { conversation: presentConversation(conv), messages: items, has_more };
}

export async function sendStaffMessage(staffId: string, conversationId: string, input: SendInput | null) {
  if (!input || typeof input !== "object") throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  if (input.order_id != null || input.preorder_id != null) throw badRequest("ร้านแนบคำสั่งซื้อในแชทไม่ได้");
  const body = cleanBody(input.body);
  if (!body) throw badRequest("กรุณาพิมพ์ข้อความ");
  await dbConnect();
  const conv = await findConversation(conversationId);
  const { msg, wasUnread } = await saveMessage(conv._id, "staff", staffId, body, null);
  // ตอบแล้ว = ร้านเห็นข้อความลูกค้าแล้ว
  await markRead(conv._id, "customer");

  if (wasUnread === 0) {
    notifyCustomerLater(conv.customer_id?._id ?? conv.customer_id, null, {
      title: "ร้านตอบกลับในแชท",
      message: body.slice(0, 200),
      type: "info",
      link: CHAT_CUSTOMER_PATH,
      ref_type: null,
      ref_id: null,
    });
  }
  return msg;
}

export async function markReadByStaff(conversationId: string) {
  await dbConnect();
  const conv = await findConversation(conversationId);
  const staff_unread = await markRead(conv._id, "customer");
  return { staff_unread };
}

/**
 * ข้อความของ sender ฝั่งนี้ = อ่านแล้ว + ตั้งตัวนับของอีกฝั่งใหม่ → คืนจำนวนที่ยังไม่อ่าน
 * นับจากข้อความจริงแทนการตั้ง 0 — ข้อความที่เข้ามาระหว่าง updateMany กับ updateOne จะไม่หายจากตัวนับ
 */
async function markRead(conversationId: unknown, senderOfMessages: SenderType): Promise<number> {
  const unreadFilter = { conversation_id: conversationId, sender_type: senderOfMessages, read_at: null, deleted_at: null };
  await chatMessageModel.updateMany(unreadFilter, { $set: { read_at: new Date() } });
  const remaining = await chatMessageModel.countDocuments(unreadFilter);
  await chatConversationModel.updateOne(
    { _id: conversationId },
    { $set: { [senderOfMessages === "customer" ? "staff_unread" : "customer_unread"]: remaining } }
  );
  return remaining;
}


// ── แก้ไข / ลบข้อความ (ทั้งสองฝั่ง — เฉพาะข้อความของฝั่งตัวเอง) ─────────────
export interface EditInput {
  body?: unknown;
  /** เปลี่ยนคำสั่งซื้อที่แนบ (ลูกค้าเท่านั้น) */
  order_id?: unknown;
  preorder_id?: unknown;
  /** true = เอาคำสั่งซื้อที่แนบออก (ลูกค้าเท่านั้น) */
  remove_attachment?: unknown;
}

/** ข้อความล่าสุดที่ยังไม่ถูกลบ → สรุปของห้อง (รายการห้องหลังร้าน) + นับยังไม่อ่านใหม่ทั้งสองฝั่ง */
async function refreshConversationSummary(conversationId: unknown) {
  const last = await chatMessageModel
    .findOne({ conversation_id: conversationId, deleted_at: null })
    .sort({ created_at: -1, _id: -1 })
    .lean<any>();
  const [staffUnread, customerUnread] = await Promise.all([
    chatMessageModel.countDocuments({ conversation_id: conversationId, sender_type: "customer", read_at: null, deleted_at: null }),
    chatMessageModel.countDocuments({ conversation_id: conversationId, sender_type: "staff", read_at: null, deleted_at: null }),
  ]);
  await chatConversationModel.updateOne(
    { _id: conversationId },
    {
      $set: {
        last_message_preview: last ? previewOf(last.body ?? "", last.attachment ?? null) : "",
        last_sender_type: last?.sender_type ?? null,
        staff_unread: staffUnread,
        customer_unread: customerUnread,
      },
    }
  );
}

/** ข้อความของฝั่งนี้ในห้องนี้ที่ยังไม่ถูกลบ — ไม่ใช่ = 404 (ไม่บอกว่ามีอยู่จริงไหม) */
async function findOwnMessage(conversationId: unknown, senderType: SenderType, messageId: string) {
  if (!isObjectId(messageId)) throw badRequest("รูปแบบ id ข้อความไม่ถูกต้อง");
  const msg = await chatMessageModel
    .findOne({ _id: messageId, conversation_id: conversationId, sender_type: senderType, deleted_at: null })
    .lean<any>();
  if (!msg) throw notFound("ไม่พบข้อความ");
  return msg;
}

async function applyEdit(conversationId: unknown, msg: any, body: string, attachment: any) {
  if (!body && !attachment) throw badRequest("ข้อความว่างไม่ได้ — ถ้าไม่ต้องการแล้วให้ลบข้อความแทน");
  const updated = await chatMessageModel
    .findOneAndUpdate({ _id: msg._id, deleted_at: null }, { $set: { body, attachment, edited_at: new Date() } }, { returnDocument: "after" })
    .lean<any>();
  if (!updated) throw notFound("ไม่พบข้อความ");
  await refreshConversationSummary(conversationId);
  return presentMessage(updated);
}

async function softDelete(conversationId: unknown, msg: any) {
  await chatMessageModel.updateOne({ _id: msg._id }, { $set: { deleted_at: new Date(), body: "", attachment: null } });
  await refreshConversationSummary(conversationId);
  return { _id: String(msg._id), deleted: true };
}

async function myConversationId(customerId: string) {
  const conv = await chatConversationModel.findOne({ customer_id: customerId }).select("_id").lean<any>();
  if (!conv) throw notFound("ไม่พบข้อความ");
  return conv._id;
}

/** ลูกค้าแก้ข้อความของตัวเอง — แก้ข้อความ และ/หรือ เปลี่ยน/เอาออก คำสั่งซื้อที่แนบ (ต้องเป็นของตัวเอง) */
export async function editCustomerMessage(customerId: string, messageId: string, input: EditInput | null) {
  if (!input || typeof input !== "object") throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  await dbConnect();
  const convId = await myConversationId(customerId);
  const msg = await findOwnMessage(convId, "customer", messageId);
  const body = input.body === undefined ? msg.body ?? "" : cleanBody(input.body);
  const replace = input.order_id != null || input.preorder_id != null;
  const attachment = replace
    ? await buildAttachment(customerId, { order_id: input.order_id, preorder_id: input.preorder_id })
    : input.remove_attachment === true
      ? null
      : msg.attachment ?? null;
  return applyEdit(convId, msg, body, attachment);
}

export async function deleteCustomerMessage(customerId: string, messageId: string) {
  await dbConnect();
  const convId = await myConversationId(customerId);
  return softDelete(convId, await findOwnMessage(convId, "customer", messageId));
}

/** ร้านแก้ข้อความของร้าน (ข้อความเท่านั้น — ร้านแนบคำสั่งซื้อไม่ได้) */
export async function editStaffMessage(conversationId: string, messageId: string, input: EditInput | null) {
  if (!input || typeof input !== "object") throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  if (input.order_id != null || input.preorder_id != null) throw badRequest("ร้านแนบคำสั่งซื้อในแชทไม่ได้");
  const body = cleanBody(input.body);
  await dbConnect();
  const conv = await findConversation(conversationId);
  const msg = await findOwnMessage(conv._id, "staff", messageId);
  return applyEdit(conv._id, msg, body, null);
}

export async function deleteStaffMessage(conversationId: string, messageId: string) {
  await dbConnect();
  const conv = await findConversation(conversationId);
  return softDelete(conv._id, await findOwnMessage(conv._id, "staff", messageId));
}

/**
 * ร้าน "ลบแชท" ของลูกค้า = ซ่อนห้องจากรายการหลังร้าน — ไม่ลบข้อความ (ประวัติยังอยู่ ลูกค้ายังเห็นแชทของตัวเองครบ)
 * ข้อความที่ค้างอ่านถือว่าอ่านแล้ว (ตัวเลขเมนูไม่ค้าง) · ลูกค้าส่งข้อความใหม่ = กลับมาแสดงพร้อมประวัติเก่า (sendCustomerMessage)
 */
export async function deleteConversation(conversationId: string) {
  await dbConnect();
  const conv = await findConversation(conversationId);
  await markRead(conv._id, "customer");
  await chatConversationModel.updateOne({ _id: conv._id }, { $set: { hidden_at: new Date() } });
  return { _id: String(conv._id), hidden: true };
}
