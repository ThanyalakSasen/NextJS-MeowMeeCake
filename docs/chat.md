# แชทลูกค้า ↔ ร้าน (2026-10-26)

แทนฟอร์ม "ส่งข้อความหาเรา" (`POST /api/shop/contact` ยังอยู่เพื่อความเข้ากันได้ แต่หน้าเว็บไม่ใช้แล้ว)

## ข้อมูล

| collection | ไฟล์ | เก็บอะไร |
|---|---|---|
| `chatconversations` | `src/models/chatConversationModel.ts` | ลูกค้า 1 คน = 1 ห้อง (unique `customer_id`) · ข้อความล่าสุดแบบย่อ · `customer_unread` / `staff_unread` |
| `chatmessages` | `src/models/chatMessageModel.ts` | ข้อความ (`body` ≤ 1000) และ/หรือ `attachment` = คำสั่งซื้อ/พรีออเดอร์ 1 รายการ (ภาพ ณ ตอนส่ง: เลขที่ · ยอด · จำนวนชิ้น · สินค้าแรก · สถานะ) · `read_at` |

ตรรกะทั้งหมดอยู่ที่ `src/services/chatService.ts`

## API

| method | path | สิทธิ์ | ทำอะไร |
|---|---|---|---|
| GET | `/api/shop/chat?after=&before=&limit=` | ล็อกอิน | ห้องของฉัน + ข้อความ (เก่า→ใหม่) · ยังไม่เคยคุย = `conversation: null` |
| POST | `/api/shop/chat/messages` | ล็อกอิน | `{ body?, order_id? \| preorder_id? }` — แนบได้เฉพาะของตัวเอง (ของคนอื่น = 404) · 20 ข้อความ/นาที |
| POST | `/api/shop/chat/read` | ล็อกอิน | ข้อความจากร้าน = อ่านแล้ว |
| GET | `/api/shop/chat/unread` | ล็อกอิน | `{ unread }` |
| GET | `/api/admin/chats?search=&unread=true&page=&limit=` | `chats.view` | รายการห้อง ล่าสุดก่อน |
| GET | `/api/admin/chats/unread` | `chats.view` | `{ conversations, messages }` ที่ร้านยังไม่อ่าน |
| GET | `/api/admin/chats/[id]?after=&before=` | `chats.view` | ห้อง (ข้อมูลลูกค้า) + ข้อความ |
| POST | `/api/admin/chats/[id]/messages` | `chats.create` | ร้านตอบ `{ body }` (ตอบแล้ว = ข้อความลูกค้าอ่านแล้ว) |
| POST | `/api/admin/chats/[id]/read` | `chats.view` | ข้อความลูกค้า = อ่านแล้ว |

- **อัปเดตแบบ polling** — หน้าเว็บขอ `?after=<เวลาข้อความล่าสุด>` ทุก 4 วิ (คืนรวมเวลาเท่ากัน · client ตัดซ้ำด้วย `_id`) — ใช้กับ Render ฟรีได้ ไม่ต้องมี WebSocket
- **แจ้งเตือน** — ลูกค้าส่งตอนร้านอ่านครบแล้ว → แจ้งเตือนหลังร้าน หมวด "ลูกค้า" (+ LINE เจ้าของร้าน) ครั้งเดียวต่อรอบ ไม่ใช่ทุกข้อความ (กันโควตา LINE) ·
  ร้านตอบตอนลูกค้าอ่านครบแล้ว → กระดิ่งในเว็บของลูกค้า (ไม่ส่ง LINE ลูกค้า)

## สิทธิ์ `chats`

menu key ใหม่ (`src/lib/menuKeys.ts`) · ตอน deploy ครั้งแรกระบบคัดลอกสิทธิ์จาก `orders` ให้ `chats` อัตโนมัติครั้งเดียว
(`LATER_SUBMENU_MIGRATIONS` → migration id `chat-permissions-v1`) — คนที่ดูแลคำสั่งซื้อได้ตอบแชทได้ทันที เจ้าของร้านปรับแยกทีหลังได้

## ไม่ต้องรันสคริปต์ตอน deploy

collection + index สร้างเองตอนใช้ครั้งแรก (ถ้าปิด autoIndex ให้รัน `npm run sync-indexes`)
