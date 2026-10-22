/**
 * chatService — แชทถาม-ตอบระหว่างร้านกับลูกค้า (แทนฟอร์ม "ส่งข้อความหาเรา" เดิม)
 *
 * - ลูกค้า 1 คน = 1 ห้อง (สร้างเองตอนส่งข้อความแรก) · ต้องล็อกอิน
 * - หน้าเว็บดึงข้อความใหม่เป็นช่วง ๆ (?after=) — ไม่ใช้ WebSocket (Render ฟรีหลับได้ · Vercel ไม่ค้างการเชื่อมต่อ)
 * - แจ้งเตือนในเว็บเท่านั้น (ไม่ส่ง LINE — ผู้ใช้เลือก 2026-10-22):
 *     ลูกค้าส่ง → กระดิ่งหลังร้าน เฉพาะข้อความแรกที่ร้านยังไม่อ่าน (unread_shop 0 → 1)
 *     ร้านตอบ  → กระดิ่งลูกค้า เฉพาะข้อความแรกที่ลูกค้ายังไม่อ่าน (unread_customer 0 → 1)
 * - การ์ดคำสั่งซื้อ: แนบ ref { kind: order|preorder, id } ได้ (ต้องเป็นของลูกค้าเจ้าของห้อง) · สถานะ/ยอดอ่านสดตอนแสดง
 * - ข้อความตอบเร็ว (หลังร้าน): ใช้ร่วมกันทั้งร้าน — ดู = chat.view · เพิ่ม/แก้/ลบ = chat.update
 * - ฝั่งลูกค้าไม่เห็นว่าพนักงานคนไหนตอบ (เห็นเป็น "ร้าน") · หลังร้านเห็นชื่อผู้ตอบ
 * - หลังร้านใช้สิทธิ์เมนู "chat" (view = ดู/อ่าน · create = ตอบ) — owner ผ่านหมด
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { isObjectId } from "../lib/objectId";
import { assertObjectId } from "../lib/objectId";
import { rateLimit } from "../lib/rateLimit";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import { trackBackground } from "../lib/backgroundTasks";
import { log } from "../lib/logger";
import { toBaht } from "../lib/money";
import chatConversationModel from "../models/chatConversationModel";
import chatMessageModel from "../models/chatMessageModel";
import userModel from "../models/userModel";
import orderModel from "../models/orderModel";
import preorderModel from "../models/preorderModel";
import chatQuickReplyModel from "../models/chatQuickReplyModel";
import { notificationService } from "./notificationService";
import { notifyCustomer } from "./customerNotifyService";
import { isPlaceholderEmail } from "./oauthService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const CHAT_TEXT_MAX = 1000;
/** โหลดครั้งแรก/เลื่อนดูย้อนหลัง ครั้งละกี่ข้อความ */
const PAGE_SIZE = 50;
/** ดึงข้อความใหม่ (?after=) สูงสุดต่อครั้ง */
const AFTER_MAX = 200;
/** path ในเว็บลูกค้าที่เปิดกล่องแชททันที (Navbar/ปุ่มลอยอ่าน ?chat=1) */
export const CUSTOMER_CHAT_PATH = "/customer?chat=1";

export type ChatSender = "customer" | "shop";

export type ChatRefKind = "order" | "preorder";

/** การ์ดคำสั่งซื้อในข้อความ — สถานะ/ยอดอ่านสดจากเอกสาร · missing = เอกสารถูกลบแล้ว (เหลือแค่เลข) */
export interface ChatOrderCard {
  kind: ChatRefKind;
  id: string;
  no: string;
  order_status: string | null;
  payment_status: string | null;
  total_amount: number | null;
  created_at: string | null;
  missing: boolean;
}

export interface ChatMessageDto {
  _id: string;
  sender: ChatSender;
  text: string;
  created_at: string;
  card: ChatOrderCard | null;
  /** หลังร้านเท่านั้น — ชื่อพนักงานที่ตอบ */
  sender_name?: string | null;
}

/** body ของการส่งข้อความ — ข้อความ และ/หรือ การ์ดคำสั่งซื้อ */
export interface ChatSendInput {
  text?: unknown;
  ref?: { kind?: unknown; id?: unknown } | null;
}

function cleanText(raw: unknown, allowEmpty = false): string {
  const text = String(raw ?? "").trim();
  if (!text && !allowEmpty) throw badRequest("กรุณาพิมพ์ข้อความ");
  if (text.length > CHAT_TEXT_MAX) throw badRequest(`ข้อความยาวได้ไม่เกิน ${CHAT_TEXT_MAX} ตัวอักษร`);
  return text;
}

/** ตรวจการ์ดที่แนบ — ต้องเป็นคำสั่งซื้อ/พรีออเดอร์ของลูกค้าเจ้าของห้อง (ไม่ใช่ = 404 · ไม่บอกว่ามีอยู่จริงไหม) */
async function resolveRef(ownerUserId: unknown, raw: ChatSendInput["ref"]): Promise<{ kind: ChatRefKind; id: unknown; no: string } | null> {
  if (raw == null) return null;
  const kind = raw.kind;
  if (kind !== "order" && kind !== "preorder") throw badRequest("ref.kind ต้องเป็น order หรือ preorder");
  const id = String(raw.id ?? "");
  if (!isObjectId(id)) throw badRequest("ref.id ไม่ถูกต้อง");
  const doc =
    kind === "order"
      ? await orderModel.findOne({ _id: id, user_id: ownerUserId, deleted_at: null }).select("order_no").lean<any>()
      : await preorderModel.findOne({ _id: id, user_id: ownerUserId, deleted_at: null }).select("preorder_no").lean<any>();
  if (!doc) throw notFound(kind === "order" ? "ไม่พบคำสั่งซื้อนี้ในบัญชีของลูกค้า" : "ไม่พบพรีออเดอร์นี้ในบัญชีของลูกค้า");
  return { kind, id: doc._id, no: String(kind === "order" ? doc.order_no : doc.preorder_no) };
}

/** ข้อความที่ใช้เป็นสรุปห้อง/แจ้งเตือน — มีแต่การ์ด = "[คำสั่งซื้อ ORD-…]" */
function previewText(text: string, ref: { kind: ChatRefKind; no: string } | null): string {
  if (text) return text;
  if (!ref) return "";
  return ref.kind === "order" ? `[คำสั่งซื้อ ${ref.no}]` : `[พรีออเดอร์ ${ref.no}]`;
}

const excerpt = (text: string, n = 120) => (text.length > n ? `${text.slice(0, n)}…` : text);

function parseDate(raw: unknown, field: string): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} ต้องเป็นวันเวลา (ISO)`);
  return d;
}

type CardLookup = Map<string, any>;

/** อ่านเอกสารของการ์ดทั้งหมดในชุดข้อความทีเดียว (สถานะ/ยอดล่าสุด) */
async function loadCards(rows: any[]): Promise<CardLookup> {
  const ids = { order: [] as unknown[], preorder: [] as unknown[] };
  for (const r of rows) if (r.ref?.id) ids[r.ref.kind as ChatRefKind].push(r.ref.id);
  const fields = "order_status payment_status total_amount created_at";
  const [orders, preorders] = await Promise.all([
    ids.order.length ? orderModel.find({ _id: { $in: ids.order } }).select(`order_no ${fields}`).lean<any[]>() : [],
    ids.preorder.length ? preorderModel.find({ _id: { $in: ids.preorder } }).select(`preorder_no ${fields}`).lean<any[]>() : [],
  ]);
  const map: CardLookup = new Map();
  for (const o of orders) map.set(`order:${String(o._id)}`, o);
  for (const p of preorders) map.set(`preorder:${String(p._id)}`, p);
  return map;
}

function toCard(ref: any, cards: CardLookup): ChatOrderCard | null {
  if (!ref?.id) return null;
  const doc = cards.get(`${ref.kind}:${String(ref.id)}`);
  return {
    kind: ref.kind,
    id: String(ref.id),
    no: doc ? String(ref.kind === "order" ? doc.order_no : doc.preorder_no) : String(ref.no ?? ""),
    order_status: doc?.order_status ?? null,
    payment_status: doc?.payment_status ?? null,
    total_amount: doc ? toBaht(doc.total_amount ?? 0) : null,
    created_at: doc?.created_at ? new Date(doc.created_at).toISOString() : null,
    missing: !doc,
  };
}

function toDto(doc: any, forShop: boolean, cards: CardLookup): ChatMessageDto {
  const dto: ChatMessageDto = {
    _id: String(doc._id),
    sender: doc.sender,
    text: doc.text ?? "",
    created_at: new Date(doc.created_at).toISOString(),
    card: toCard(doc.ref, cards),
  };
  if (forShop && doc.sender === "shop") {
    const u = doc.sender_user_id && typeof doc.sender_user_id === "object" ? doc.sender_user_id : null;
    dto.sender_name = u?.user_fullname ?? null;
  }
  return dto;
}

/**
 * ข้อความของห้อง — after = เฉพาะที่ใหม่กว่า (ดึงเป็นช่วง) · before = เก่ากว่า (เลื่อนดูย้อนหลัง) · ไม่ส่ง = ล่าสุด
 * คืนเรียงเก่า → ใหม่เสมอ
 */
async function listMessages(
  conversationId: unknown,
  q: { after?: unknown; before?: unknown },
  forShop: boolean
): Promise<{ messages: ChatMessageDto[]; has_more: boolean }> {
  const after = parseDate(q.after, "after");
  const before = parseDate(q.before, "before");
  const filter: Record<string, any> = { conversation_id: conversationId };
  let query;
  if (after) {
    filter.created_at = { $gt: after };
    query = chatMessageModel.find(filter).sort({ created_at: 1 }).limit(AFTER_MAX);
  } else {
    if (before) filter.created_at = { $lt: before };
    query = chatMessageModel.find(filter).sort({ created_at: -1 }).limit(PAGE_SIZE + 1);
  }
  if (forShop) query = query.populate("sender_user_id", "user_fullname");
  const rows = await query.lean<any[]>();
  const page = after ? rows : rows.slice(0, PAGE_SIZE).reverse();
  const cards = await loadCards(page);
  return { messages: page.map((r) => toDto(r, forShop, cards)), has_more: !after && rows.length > PAGE_SIZE };
}

// ── ฝั่งลูกค้า ─────────────────────────────────────────────

/** ห้องของฉัน + ข้อความ (ยังไม่เคยแชท = conversation null · ข้อความว่าง) */
export async function getMyChat(userId: string, q: { after?: unknown; before?: unknown } = {}) {
  await dbConnect();
  const conv = await chatConversationModel.findOne({ user_id: userId }).lean<any>();
  if (!conv) return { conversation: null, messages: [], has_more: false };
  const { messages, has_more } = await listMessages(conv._id, q, false);
  return {
    conversation: { _id: String(conv._id), unread_customer: conv.unread_customer ?? 0 },
    messages,
    has_more,
  };
}

/** จำนวนข้อความจากร้านที่ฉันยังไม่อ่าน (จุดแดงบนปุ่มแชท) */
export async function myUnread(userId: string): Promise<{ unread: number }> {
  await dbConnect();
  const conv = await chatConversationModel.findOne({ user_id: userId }).select("unread_customer").lean<any>();
  return { unread: conv?.unread_customer ?? 0 };
}

export async function markMyChatRead(userId: string): Promise<{ unread: number }> {
  await dbConnect();
  await chatConversationModel.updateOne({ user_id: userId }, { $set: { unread_customer: 0 } });
  return { unread: 0 };
}

/** อัปเดตสรุปห้องของลูกค้าคนนี้ (สร้างห้องถ้ายังไม่มี) — คืนห้อง "ก่อน" อัปเดต (ใช้ดูว่าเป็นข้อความแรกที่ยังไม่อ่านไหม) */
async function bumpCustomerConversation(userId: string, text: string, at: Date) {
  const update = {
    $setOnInsert: { user_id: userId },
    $set: { last_message_at: at, last_message_text: excerpt(text, 200), last_sender: "customer" },
    $inc: { unread_shop: 1 },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const before = await chatConversationModel
        .findOneAndUpdate({ user_id: userId }, update, { upsert: true, returnDocument: "before" })
        .lean<any>();
      const conv = await chatConversationModel.findOne({ user_id: userId }).lean<any>();
      return { before, conv };
    } catch (err: any) {
      // ส่งพร้อมกัน 2 ข้อความแรก → upsert ชน unique index — ลองใหม่ (ครั้งที่ 2 เจอห้องแล้ว)
      if (err?.code === 11000 && attempt < 2) continue;
      throw err;
    }
  }
}

export async function sendFromCustomer(userId: string, input: ChatSendInput): Promise<ChatMessageDto> {
  const hasRef = input.ref != null;
  const text = cleanText(input.text, hasRef);
  await dbConnect();
  const user = await userModel
    .findOne({ _id: userId, deleted_at: null })
    .select("user_fullname")
    .lean<{ user_fullname?: string } | null>();
  if (!user) throw notFound("ไม่พบบัญชีผู้ใช้");

  const ref = await resolveRef(userId, input.ref);

  // กันกดรัว/สแปม: 20 ข้อความต่อนาทีต่อบัญชี (429)
  await rateLimit(userId, "shop:chat", { limit: 20, windowMs: 60_000 });

  const now = new Date();
  const preview = previewText(text, ref);
  const { before, conv } = await bumpCustomerConversation(userId, preview, now);
  const msg = await chatMessageModel.create({
    conversation_id: conv._id,
    sender: "customer",
    sender_user_id: userId,
    text,
    ref,
    created_at: now,
  });

  // ข้อความแรกที่ร้านยังไม่อ่าน → กระดิ่งหลังร้าน (ไม่ส่ง LINE) · ข้อความถัดไประหว่างยังไม่อ่าน = ไม่แจ้งซ้ำ
  if (!before || (before.unread_shop ?? 0) === 0) {
    void trackBackground(
      notificationService
        .notify({
          title: `แชทจากลูกค้า: ${user.user_fullname || "ลูกค้า"}`,
          message: excerpt(preview),
          module: "customer",
          type: "info",
          link: `/owner/chat?c=${String(conv._id)}`,
          line: false,
        })
        .catch((err) => log.warn("chat.notify_shop_failed", { err }))
    );
  }
  const obj = msg.toObject();
  return toDto(obj, false, await loadCards([obj]));
}

// ── ฝั่งร้าน (หลังร้าน · สิทธิ์ chat) ─────────────────────────

export type ChatListFilter = "all" | "unanswered" | "unread";

/** รายการห้อง — ข้อความล่าสุดก่อน · unanswered = ข้อความล่าสุดเป็นของลูกค้า · unread = ร้านยังไม่เปิดอ่าน · q = ชื่อ/เบอร์/อีเมลลูกค้า */
export async function listConversations(query: { filter?: string | null; q?: string | null; pagination: Pagination }) {
  await dbConnect();
  const filter: Record<string, any> = { last_message_at: { $ne: null } };
  if (query.filter === "unanswered") filter.last_sender = "customer";
  else if (query.filter === "unread") filter.unread_shop = { $gt: 0 };
  else if (query.filter && query.filter !== "all") throw badRequest("filter ต้องเป็น all | unanswered | unread");

  const q = query.q?.trim();
  if (q) {
    const re = new RegExp(escapeRegExp(q), "i");
    const users = await userModel
      .find({ $or: [{ user_fullname: re }, { user_phone: re }, { email: re }] })
      .select("_id")
      .limit(500)
      .lean<Array<{ _id: unknown }>>();
    filter.user_id = { $in: users.map((u) => u._id) };
  }

  const [rows, total] = await Promise.all([
    chatConversationModel
      .find(filter)
      .sort({ last_message_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("user_id", "user_fullname user_img")
      .lean<any[]>(),
    chatConversationModel.countDocuments(filter),
  ]);
  const items = rows.map((c) => {
    const u = c.user_id && typeof c.user_id === "object" ? c.user_id : null;
    return {
      _id: String(c._id),
      customer: { _id: u ? String(u._id) : String(c.user_id), name: u?.user_fullname || "ลูกค้า", image: u?.user_img ?? null },
      last_message_at: c.last_message_at ? new Date(c.last_message_at).toISOString() : null,
      last_message_text: c.last_message_text ?? "",
      last_sender: c.last_sender ?? null,
      unread_shop: c.unread_shop ?? 0,
    };
  });
  return { items, meta: buildMeta(total, query.pagination) };
}

/** ตัวเลขบนเมนูหลังร้าน — ห้องที่ยังไม่เปิดอ่าน · ห้องที่ยังรอร้านตอบ */
export async function shopUnreadSummary() {
  await dbConnect();
  const [unread, unanswered] = await Promise.all([
    chatConversationModel.countDocuments({ unread_shop: { $gt: 0 } }),
    chatConversationModel.countDocuments({ last_sender: "customer" }),
  ]);
  return { unread_conversations: unread, unanswered_conversations: unanswered };
}

async function findConversation(id: string) {
  assertObjectId(id, "conversation_id");
  const conv = await chatConversationModel.findById(id).lean<any>();
  if (!conv) throw notFound("ไม่พบห้องแชทนี้");
  return conv;
}

/** ห้อง 1 ห้อง + ข้อมูลลูกค้าไว้ประกอบการตอบ (ติดต่อ · คำสั่งซื้อ/พรีออเดอร์ล่าสุด) */
export async function getConversationForShop(id: string) {
  await dbConnect();
  const conv = await findConversation(id);
  const [user, orders, preorders] = await Promise.all([
    userModel.findById(conv.user_id).select("user_fullname user_phone email user_img").lean<any>(),
    orderModel
      .find({ user_id: conv.user_id, deleted_at: null })
      .sort({ created_at: -1 })
      .limit(3)
      .select("order_no order_status payment_status total_amount created_at")
      .lean<any[]>(),
    preorderModel
      .find({ user_id: conv.user_id, deleted_at: null })
      .sort({ created_at: -1 })
      .limit(3)
      .select("preorder_no order_status payment_status total_amount created_at")
      .lean<any[]>(),
  ]);
  const doc = (d: any, kind: "order" | "preorder") => ({
    _id: String(d._id),
    kind,
    no: kind === "order" ? d.order_no : d.preorder_no,
    order_status: d.order_status,
    payment_status: d.payment_status,
    total_amount: toBaht(d.total_amount ?? 0),
    created_at: d.created_at ? new Date(d.created_at).toISOString() : null,
  });
  return {
    _id: String(conv._id),
    unread_shop: conv.unread_shop ?? 0,
    last_sender: conv.last_sender ?? null,
    customer: {
      _id: String(conv.user_id),
      name: user?.user_fullname || "ลูกค้า",
      phone: user?.user_phone || null,
      email: user?.email && !isPlaceholderEmail(user.email) ? user.email : null,
      image: user?.user_img ?? null,
    },
    recent_orders: [...orders.map((o) => doc(o, "order")), ...preorders.map((p) => doc(p, "preorder"))]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 5),
  };
}

export async function getMessagesForShop(id: string, q: { after?: unknown; before?: unknown } = {}) {
  await dbConnect();
  const conv = await findConversation(id);
  return listMessages(conv._id, q, true);
}

export async function markShopRead(id: string) {
  await dbConnect();
  await findConversation(id);
  await chatConversationModel.updateOne({ _id: id }, { $set: { unread_shop: 0 } });
  return { unread_shop: 0 };
}

export async function sendFromShop(id: string, staffUserId: string, input: ChatSendInput): Promise<ChatMessageDto> {
  const hasRef = input.ref != null;
  const text = cleanText(input.text, hasRef);
  await dbConnect();
  const conv = await findConversation(id);
  const ref = await resolveRef(conv.user_id, input.ref);
  const preview = previewText(text, ref);
  const now = new Date();
  const msg = await chatMessageModel.create({
    conversation_id: conv._id,
    sender: "shop",
    sender_user_id: staffUserId,
    text,
    ref,
    created_at: now,
  });
  // ตอบแล้ว = ร้านอ่านห้องนี้แล้ว
  const before = await chatConversationModel
    .findOneAndUpdate(
      { _id: conv._id },
      {
        $set: { last_message_at: now, last_message_text: excerpt(preview, 200), last_sender: "shop", unread_shop: 0 },
        $inc: { unread_customer: 1 },
      },
      { returnDocument: "before" }
    )
    .lean<any>();

  // ข้อความแรกที่ลูกค้ายังไม่อ่าน → กระดิ่งลูกค้า (text null = ไม่ส่ง LINE) · ข้อความถัดไประหว่างยังไม่อ่าน = ไม่แจ้งซ้ำ
  if ((before?.unread_customer ?? 0) === 0) {
    void trackBackground(
      notifyCustomer(conv.user_id, null, {
        title: "ร้านตอบกลับแชทของคุณ",
        message: excerpt(preview),
        type: "info",
        link: CUSTOMER_CHAT_PATH,
        ref_type: "chat",
        ref_id: conv._id,
      })
    );
  }

  const populated = (await chatMessageModel.findById(msg._id).populate("sender_user_id", "user_fullname").lean<any>()) ?? msg.toObject();
  return toDto(populated, true, await loadCards([populated]));
}

// ── ข้อความตอบเร็ว (หลังร้าน) ─────────────────────────────────

const QUICK_REPLY_MAX = 50;

function toQuickReply(d: any) {
  return { _id: String(d._id), title: d.title ?? "", text: d.text, sort_order: d.sort_order ?? 0 };
}

function cleanQuickReply(body: { title?: unknown; text?: unknown; sort_order?: unknown }, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (body.text !== undefined || !partial) out.text = cleanText(body.text);
  if (body.title !== undefined) {
    const title = String(body.title ?? "").trim();
    if (title.length > 50) throw badRequest("ชื่อข้อความตอบเร็วยาวได้ไม่เกิน 50 ตัวอักษร");
    out.title = title;
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (!Number.isInteger(n)) throw badRequest("sort_order ต้องเป็นจำนวนเต็ม");
    out.sort_order = n;
  }
  return out;
}

export async function listQuickReplies() {
  await dbConnect();
  const rows = await chatQuickReplyModel.find({}).sort({ sort_order: 1, created_at: 1 }).lean<any[]>();
  return { items: rows.map(toQuickReply) };
}

export async function createQuickReply(body: { title?: unknown; text?: unknown; sort_order?: unknown }, userId: string) {
  await dbConnect();
  if ((await chatQuickReplyModel.countDocuments({})) >= QUICK_REPLY_MAX) {
    throw badRequest(`ข้อความตอบเร็วมีได้ไม่เกิน ${QUICK_REPLY_MAX} ข้อความ`);
  }
  const data = cleanQuickReply(body, false);
  if (data.sort_order === undefined) {
    const last = await chatQuickReplyModel.findOne({}).sort({ sort_order: -1 }).select("sort_order").lean<any>();
    data.sort_order = (last?.sort_order ?? 0) + 1;
  }
  const doc = await chatQuickReplyModel.create({ ...data, created_by: userId });
  return toQuickReply(doc.toObject());
}

export async function updateQuickReply(id: string, body: { title?: unknown; text?: unknown; sort_order?: unknown }) {
  await dbConnect();
  assertObjectId(id, "quick_reply_id");
  const doc = await chatQuickReplyModel.findByIdAndUpdate(id, { $set: cleanQuickReply(body, true) }, { returnDocument: "after" }).lean<any>();
  if (!doc) throw notFound("ไม่พบข้อความตอบเร็วนี้");
  return toQuickReply(doc);
}

export async function deleteQuickReply(id: string) {
  await dbConnect();
  assertObjectId(id, "quick_reply_id");
  const res = await chatQuickReplyModel.deleteOne({ _id: id });
  if (res.deletedCount === 0) throw notFound("ไม่พบข้อความตอบเร็วนี้");
  return { deleted: true };
}
