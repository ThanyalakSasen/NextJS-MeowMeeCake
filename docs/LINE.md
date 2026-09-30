# การแจ้งเตือนผ่าน LINE — เจ้าของร้าน + ลูกค้า

> อัปเดตล่าสุด: 2026-09-30 · branch `feat/line-customer-notify` (PR #53)
> ตัวแปร env ทั้งหมด → [`env.md`](env.md) · ตัวอย่างค่า → `.env.example`

---

## 1. ภาพรวม

| ผู้รับ | ส่งหาใคร | ต้องใช้ | โค้ดหลัก |
|---|---|---|---|
| เจ้าของร้าน | ปลายทางเดียว `LINE_TARGET_ID` (userId หรือ groupId) | Messaging API channel (LINE OA) | `src/lib/line.ts` + `notificationService.notify()` |
| ลูกค้า | LINE userId ของลูกค้าแต่ละคน (`users.line_user_id`) | Messaging API channel ตัวเดียวกัน + **LINE Login channel** สำหรับผูกบัญชี | `src/lib/lineLogin.ts` + `customerNotifyService` |

ทุกข้อความใช้ `LINE_CHANNEL_ACCESS_TOKEN` ตัวเดียวกัน · ส่งแบบ best-effort — LINE ล้มเหลว **ไม่ทำให้**
ออเดอร์/การชำระเงิน/การจัดส่งล้มตาม (แค่ log warn · ฝั่งร้านเก็บ `line_error` ไว้ใน notification)

ลูกค้าได้รับข้อความได้ต้องครบ 2 ข้อ: (1) ผูกบัญชี LINE ผ่านเว็บแล้ว และ (2) เป็นเพื่อนกับ LINE OA ของร้าน

---

## 2. เหตุการณ์ที่แจ้งเตือน

### เจ้าของร้าน (`notificationService.notify()` — บันทึกลง DB + push LINE)

| เหตุการณ์ | เงื่อนไข | จุดเรียก |
|---|---|---|
| ออเดอร์ใหม่ | ทุกออเดอร์ (เว็บ `ORD-` และหน้าร้าน `POS-`) | `orderService.persistOrder` |
| พรีออเดอร์ใหม่ | ทุกพรีออเดอร์ — ข้อความมีชื่อรอบ + ยอดรวม (เพิ่ม 2026-09-30, §9) | `preorderService.createPreorder` |
| สลิปรอตรวจ | ลูกค้าแนบ/แก้สลิป | `paymentService.submitSlip` |
| สินค้าใกล้หมด | สต็อกเพิ่งข้ามจาก > 5 ลงมา ≤ 5 (`LOW_STOCK_THRESHOLD`) — ทั้งตอนขาย **และ** ปรับสต็อกเอง (นับสต็อก/ตัดของเสีย, เพิ่ม 2026-09-30, §9) | `productService.notifyIfLowStockCrossed()` ← `deductStockForOrder` / `setStock` / `adjustStock` (+ `increaseStock`/`decreaseStock`) |
| วัตถุดิบใกล้หมด | สต็อกเพิ่งข้ามลงมา ≤ `reorder_point` ของวัตถุดิบนั้น | `ingredientTransactionService.createTransaction` |

แจ้งเฉพาะตอน "เพิ่งข้ามเกณฑ์" — ไม่แจ้งซ้ำทุกครั้งที่ของยังเหลือน้อยอยู่

### ลูกค้า (`customerNotifyService.notifyCustomerLater()` — push LINE อย่างเดียว ไม่บันทึก DB)

| เหตุการณ์ | ออเดอร์ | พรีออเดอร์ | จุดเรียก |
|---|---|---|---|
| ได้รับออเดอร์ + ยอดรวม | ✅ (เฉพาะเว็บ ไม่ส่งสำหรับ POS) | ✅ | `orderService.persistOrder` / `preorderService.createPreorder` |
| สถานะเปลี่ยน (confirmed / preparing / ready / completed / cancelled + เหตุผล) | ✅ | ✅ | `updateOrderStatus` / `updatePreorderStatus` |
| ชำระเงิน (paid / failed / refunded) | ✅ | ✅ | `lib/orderLifecycle.setEntityPaymentStatus` |
| จัดส่ง (shipping + เลขพัสดุ / delivered / failed) | ✅ | ✅ | `lib/orderLifecycle.applyEntityDeliveryUpdate` |

จัดส่ง: แจ้งเฉพาะตอน `delivery_status` เปลี่ยนจริง — แก้แค่ `tracking_no`/note ไม่แจ้งซ้ำ

---

## 3. ตัวแปร env (`.env.local`)

```env
# Messaging API channel (LINE OA) — ใช้ส่งทั้งหาเจ้าของร้านและลูกค้า
LINE_CHANNEL_ACCESS_TOKEN=
LINE_TARGET_ID=

# LINE Login channel — ลูกค้าผูกบัญชี LINE
LINE_LOGIN_CHANNEL_ID=
LINE_LOGIN_CHANNEL_SECRET=
LINE_LOGIN_CALLBACK_URL=http://localhost:3000/api/shop/me/line/callback
LINE_LINK_RETURN_URL=http://localhost:3001/profile
```

| ตัวแปร | เอามาจาก |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | **Messaging API channel** → แท็บ Messaging API → Channel access token (long-lived) → Issue |
| `LINE_TARGET_ID` | userId (ขึ้นต้น `U`) ของเจ้าของร้าน หรือ groupId (ขึ้นต้น `C`) — ต้องเป็นเพื่อน/อยู่ในกลุ่มกับ OA |
| `LINE_LOGIN_CHANNEL_ID` | **LINE Login channel** → แท็บ Basic settings → Channel ID |
| `LINE_LOGIN_CHANNEL_SECRET` | **LINE Login channel** → แท็บ Basic settings → Channel secret |
| `LINE_LOGIN_CALLBACK_URL` | URL ของ backend — ต้องลงทะเบียนใน LINE Login channel ให้ตรงทุกตัวอักษร (ข้อ 4) |
| `LINE_LINK_RETURN_URL` | หน้าโปรไฟล์ฝั่ง frontend ที่จะพาลูกค้ากลับหลังผูกเสร็จ |

⚠️ ค่าของ Messaging API channel กับ LINE Login channel **ห้ามสลับกัน** — เป็นคนละ channel
⚠️ แก้ `.env.local` แล้วต้อง restart `npm run dev` ทุกครั้ง

---

## 4. ตั้งค่าใน LINE Developers Console

1. **Messaging API channel** (LINE OA ของร้าน) — ออก Channel access token (long-lived)
2. **LINE Login channel** — สร้างใน **Provider เดียวกับ** Messaging API channel
   (LINE userId ของคนเดียวกันจะเป็นค่าเดียวกันเฉพาะใน Provider เดียวกัน — คนละ Provider = push ไม่ถึง)
3. ใน LINE Login channel → แท็บ **LINE Login**:
   - **Callback URL**: `http://localhost:3000/api/shop/me/line/callback` (ไม่มี `/` ท้าย · `http` ไม่ใช่ `https` ตอน dev) → กด **Update**
   - **Linked OA**: เลือก OA ของร้าน — ให้หน้าผูกบัญชีชวนลูกค้าเพิ่มเพื่อน OA ไปด้วย (`bot_prompt=aggressive`)
4. ใน LINE Login channel → แท็บ Basic settings → เปิด **OpenID Connect** (ต้องใช้ scope `openid` เพื่อได้ `id_token`)
5. ตอน deploy production: เพิ่ม Callback URL ของโดเมนจริง (`https://…/api/shop/me/line/callback`)
   แล้วแก้ `LINE_LOGIN_CALLBACK_URL` / `LINE_LINK_RETURN_URL` ให้ตรง

---

## 5. API สำหรับ frontend (หน้าโปรไฟล์ลูกค้า)

ทุก endpoint ต้องล็อกอิน · ส่ง cookie `session` ด้วย (`credentials: "include"`)

### `GET /api/shop/me/line` — สถานะ + ลิงก์ผูกบัญชี
```json
{ "success": true, "data": { "linked": false, "authorize_url": "https://access.line.me/oauth2/v2.1/authorize?..." } }
```
- `linked` — ใช้เลือกแสดงปุ่ม "เชื่อม LINE" หรือ "ยกเลิกการเชื่อม"
- `authorize_url` — อายุ 10 นาที ให้เรียกใหม่ทุกครั้งที่กดปุ่ม · `null` = server ยังไม่ได้ตั้งค่า LINE Login (ปิดปุ่มไว้)

### กดปุ่ม "เชื่อม LINE"
```js
const res = await fetch(`${API}/api/shop/me/line`, { credentials: "include" });
const { data } = await res.json();
window.location.href = data.authorize_url; // เปลี่ยนหน้าทั้งหน้า — ห้ามใช้ fetch/popup
```

### `GET /api/shop/me/line/callback` — LINE redirect กลับมาที่นี่ (frontend ไม่ต้องเรียกเอง)
ตรวจ `state` ต้องเป็น user เดียวกับ session (กัน CSRF) → แลก `code` เป็น `id_token` → ให้ LINE ตรวจ →
ได้ `sub` (LINE userId) เก็บลง `users.line_user_id` → redirect ไป `LINE_LINK_RETURN_URL` พร้อม query:

| query | ความหมาย | frontend แสดง |
|---|---|---|
| `?line=linked` | ผูกสำเร็จ | "เชื่อมต่อ LINE เรียบร้อย" |
| `?line=cancelled` | ลูกค้ากดยกเลิกในหน้า LINE | ไม่ต้องแสดงอะไร |
| `?line=error` | state หมดอายุ / ไม่ใช่บัญชีเดียวกับที่ล็อกอิน / แลก code ไม่ผ่าน | "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง" |

ไม่ตั้ง `LINE_LINK_RETURN_URL` = ตอบ JSON `{ line: "linked" | ... }` แทนการ redirect

### `DELETE /api/shop/me/line` — ยกเลิกผูก
```json
{ "success": true, "data": { "linked": false } }
```

### หมายเหตุ
- LINE หนึ่งบัญชีผูกได้ทีละบัญชีเว็บ — ผูกซ้ำกับบัญชีใหม่ บัญชีเก่าถูกล้างอัตโนมัติ (`userService.linkLineAccount`)
- ลูกค้าบล็อก OA ทีหลัง → `linked` ยังเป็น `true` แต่จะไม่ได้รับข้อความ (LINE ไม่แจ้งกลับ) — ควรมีข้อความใต้ปุ่ม
  เช่น "เพิ่มเพื่อน MeowMeeCake เพื่อรับแจ้งเตือน"

---

## 6. แก้ปัญหา

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| LINE API 401 `Authentication failed` | `LINE_CHANNEL_ACCESS_TOKEN` ผิด/หมดอายุ หรือเอา Channel secret มาใส่แทน | ออก token ใหม่ (ข้อ 3) · ใส่แบบ `KEY=value` ไม่มีช่องว่าง/เครื่องหมายคำพูด |
| หน้า LINE Login ขึ้น `Invalid redirect_uri value` | (ก) `LINE_LOGIN_CHANNEL_ID` เป็นของ **Messaging API channel** (OA) ไม่ใช่ LINE Login — Messaging API channel ไม่มีที่ลงทะเบียน Callback URL เลย ใส่ URL อะไรก็ 400 · (ข) ใส่ Callback URL ผิดที่ (ต้องอยู่แท็บ **LINE Login** ไม่ใช่ Basic settings / Webhook URL / LIFF) · (ค) ไม่ตรงทุกตัวอักษร / ยังไม่กด Update | ดูข้อ 6.1 |
| `authorize_url` เป็น `null` | ยังตั้ง `LINE_LOGIN_*` ไม่ครบ | ข้อ 3 แล้ว restart dev server |
| ผูกแล้วแต่ลูกค้าไม่ได้ข้อความ | ไม่ได้เป็นเพื่อน OA / LINE Login channel อยู่คนละ Provider กับ OA | ให้ลูกค้าเพิ่มเพื่อน OA · ตั้ง Linked OA · ย้าย channel ให้อยู่ Provider เดียวกัน |
| ร้านไม่ได้ข้อความ แต่ในเว็บมีแจ้งเตือน | push ล้มเหลว | ดู `line_error` ใน notification นั้น (`/api/admin/notifications`) |

### 6.1 แยก Messaging API channel กับ LINE Login channel ให้ออก

เคสที่เจอจริง (2026-09-30): ใส่ Channel ID/secret ของ OA (Messaging API) ลง `LINE_LOGIN_*` → id+secret "ผ่าน"
การเช็คคู่ (token endpoint ตอบ `invalid_grant`) เพราะเป็นคู่ของ channel เดียวกันจริง แต่ authorize ตอบ
`Invalid redirect_uri` ทุก URL — **การเช็คคู่ id+secret ยืนยันไม่ได้ว่าเป็น channel ประเภทไหน**

| ดูจาก | Messaging API channel (OA) | LINE Login channel |
|---|---|---|
| หน้า Basic settings | มีข้อความ *"You can change your app name and icon in LINE Official Account Manager"* | แก้ชื่อ/ไอคอนได้ในหน้าเลย · มี **App types** (Web app) + **Permissions** (PROFILE, OPENID_CONNECT) |
| แท็บ | Messaging API (Webhook URL, Channel access token) | **LINE Login** (Callback URL, Linked OA) |
| ใช้กับ env | `LINE_CHANNEL_ACCESS_TOKEN` | `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` |

วิธีเช็คแบบไม่ต้องใช้เบราว์เซอร์: `GET https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=…&redirect_uri=…&state=x&scope=profile`
(ไม่ตาม redirect) — `302` ไป `/oauth2/v2.1/login` = ตั้งค่าถูก · `400 Invalid client_id` = Channel ID ผิด ·
`400 Invalid redirect_uri` = Channel ID ถูกแต่ Callback URL ไม่ได้ลงทะเบียนใน channel นั้น

---

## 7. สถานะการทดสอบ (2026-09-30)

| รายการ | ผล |
|---|---|
| token ของ Messaging API (`GET /v2/bot/info`) | ✅ 200 — OA "MeowMeeCake" |
| push ข้อความทดสอบหาเจ้าของร้าน (`LINE_TARGET_ID`) | ✅ ส่งสำเร็จ |
| env `LINE_LOGIN_*` ครบ | ✅ |
| LINE Login channel id+secret | ✅ คู่ถูกต้อง (channel ประเภท LINE Login, Web app, PROFILE + OPENID_CONNECT) |
| หน้า authorize ของ LINE Login (รวม `bot_prompt` + `openid`) | ✅ 302 → หน้าล็อกอิน LINE — หลังแก้ 2 จุด: เปลี่ยน `LINE_LOGIN_*` จาก OA channel เป็น LINE Login channel ที่สร้างใหม่ + ใส่ Callback URL ในแท็บ LINE Login (ข้อ 6.1) |
| ผูกบัญชีจริงแบบ end-to-end (ลูกค้ากดยินยอม) | ⏳ ต้องทดสอบด้วยมือผ่านเบราว์เซอร์ — `line_user_id` ที่บันทึกควรตรงกับ "Your user ID" ในหน้า Basic settings ของ LINE Login channel |

เทสอัตโนมัติ: `tests/lib/line.test.ts` · `tests/lib/lineLogin.test.ts` · `tests/integration/customerLineNotify.test.ts` ·
`tests/integration/ownerLineNotify.test.ts`

---

## 8. ยังไม่ทำ / ช่องโหว่ที่รู้แล้ว

1. ~~**พรีออเดอร์ใหม่ไม่แจ้งเจ้าของร้าน**~~ — ✅ แก้แล้ว 2026-09-30 (§9)
2. ~~**สินค้าใกล้หมดแจ้งเฉพาะตอนขาย**~~ — ✅ แก้แล้ว 2026-09-30 (§9)
3. **เกณฑ์สินค้าใกล้หมดตายตัว 5 ชิ้นทุกสินค้า** — ไม่มีฟิลด์เกณฑ์รายสินค้าแบบ `reorder_point` ของวัตถุดิบ
4. **ออเดอร์ POS แจ้งเจ้าของร้านทุกออเดอร์** — ร้านขายหน้าร้านเยอะอาจ spam
5. **เตือนลูกค้าก่อนวันรับพรีออเดอร์** — ต้องมี scheduled job (cron) ซึ่งโปรเจกต์ยังไม่มี
6. **ปุ่ม "เชื่อม LINE" ฝั่ง frontend** — อยู่ใน repo frontend (แยกจาก repo นี้) ใช้ API ข้อ 5

---

## 9. บันทึกการแก้ไขทั้งหมด (ก่อน → หลัง)

สรุปตามลำดับเวลา · โค้ดอยู่ใน PR #53 (`feat/line-customer-notify`, stacked บน #52) · ส่วนตั้งค่า (§9.3) อยู่นอก git

| # | รอบ | เรื่อง | ที่ไหน |
|---|---|---|---|
| 9.1 | commit `8b707bc` | แจ้งเตือนลูกค้าทาง LINE + ผูกบัญชีผ่าน LINE Login | โค้ด + เทส + docs |
| 9.2 | commit ถัดมา (PR #53) | แจ้งเจ้าของร้าน: พรีออเดอร์ใหม่ + สินค้าใกล้หมดจากการปรับสต็อกเอง | `preorderService` / `productService` |
| 9.3 | ไม่อยู่ใน git | แก้การตั้งค่า LINE จนใช้งานได้จริง (token 401, ช่องว่างใน env, channel ผิดประเภท, Callback URL) | `.env.local` + LINE Developers Console |
| 9.4 | ทั้ง 2 commit | เอกสาร | `docs/LINE.md`, `docs/env.md`, `.env.example` |

---

### 9.1 แจ้งเตือนลูกค้าทาง LINE + ผูกบัญชีผ่าน LINE Login (commit `8b707bc`, 2026-09-29)

**ภาพรวม ก่อน → หลัง**

| | ก่อน | หลัง |
|---|---|---|
| ใครได้รับ LINE | เจ้าของร้านคนเดียว (`LINE_TARGET_ID`) | เจ้าของร้าน **+ ลูกค้าแต่ละคน** ที่ผูกบัญชีแล้ว |
| ระบบรู้ LINE userId ของลูกค้า | ❌ ไม่มีที่เก็บ ไม่มีวิธีได้มา | ✅ `users.line_user_id` ได้จาก LINE Login |
| ลูกค้ารู้ความเคลื่อนไหวออเดอร์ | ต้องเข้าเว็บมาดูเอง | ได้ข้อความ LINE ตอนสร้าง / เปลี่ยนสถานะ / ชำระเงิน / จัดส่ง |

**รายไฟล์**

| ไฟล์ | ก่อน | หลัง |
|---|---|---|
| `src/lib/line.ts` | `pushLineMessage(text)` — ส่งได้แค่ `LINE_TARGET_ID` | `pushLineMessage(text, to?)` — ส่ง `to` = ส่งหาคนนั้น · ไม่ส่ง = `LINE_TARGET_ID` เหมือนเดิม (ผู้เรียกเดิมไม่ต้องแก้) · มี `to` แต่ไม่มี `LINE_TARGET_ID` ก็ส่งได้ |
| `src/lib/lineLogin.ts` (ใหม่) | — | OAuth authorization code flow: `lineLoginConfig()` (null ถ้า env ไม่ครบ) · `signLinkState` / `verifyLinkState` (JWT HS256 จาก `JWT_SECRET`, audience `line-link`, อายุ 10 นาที — session JWT เอามาใช้แทนไม่ได้เพราะไม่มี audience นี้) · `buildAuthorizeUrl` (`scope=openid profile`, `bot_prompt=aggressive`) · `exchangeCodeForLineUserId` (แลก code → `id_token` → ให้ LINE `/oauth2/v2.1/verify` ตรวจ → คืน `sub`) |
| `src/models/userModel.ts` | ไม่มีฟิลด์ LINE | + `line_user_id: String, default null` |
| `src/services/userService.ts` | — | + `linkLineAccount(id, lineUserId)` — ล้าง `line_user_id` เดียวกันออกจากบัญชีอื่นก่อน (LINE หนึ่งบัญชี = เว็บหนึ่งบัญชี) · + `unlinkLineAccount(id)` |
| `src/services/customerNotifyService.ts` (ใหม่) | — | `customerMessages` (ข้อความตามเหตุการณ์ — สถานะที่ไม่ต้องแจ้งคืน `null`) · `notifyCustomer(userId, text)` (ไม่มี token → ไม่ query DB · ไม่ได้ผูก → ข้าม · ไม่ throw) · `notifyCustomerLater()` fire-and-forget |
| `src/app/api/shop/me/line/route.ts` (ใหม่) | — | `GET` → `{ linked, authorize_url }` · `DELETE` → ยกเลิกผูก |
| `src/app/api/shop/me/line/callback/route.ts` (ใหม่) | — | `GET` — `state` ต้องเป็น user เดียวกับ session (กันคนอื่นผูก LINE เข้าบัญชีเรา) → แลก code → `linkLineAccount` → redirect `LINE_LINK_RETURN_URL?line=linked/cancelled/error` (ไม่ตั้ง = ตอบ JSON) |
| `src/services/orderService.ts` | `persistOrder` แจ้งแค่ร้าน · `updateOrderStatus` ไม่แจ้งใคร | `persistOrder` + แจ้งลูกค้า "ได้รับออเดอร์" (**เฉพาะเว็บ `ORD-`** — POS ไม่ส่ง) · `updateOrderStatus` แจ้งลูกค้าทุกครั้งที่เปลี่ยน (ยกเลิกแนบเหตุผล) |
| `src/services/preorderService.ts` | ไม่แจ้งใครเลย | `createPreorder` แจ้งลูกค้า (หลัง `saga.commit()`) · `updatePreorderStatus` แจ้งลูกค้า |
| `src/lib/orderLifecycle.ts` | ไม่แจ้ง | `setEntityPaymentStatus` แจ้ง paid / failed / refunded · `applyEntityDeliveryUpdate` แจ้งเมื่อ `delivery_status` **เปลี่ยนจริง** (แก้แค่ `tracking_no` ไม่แจ้งซ้ำ) — ไฟล์นี้ใช้ร่วม order + preorder จึงครอบทั้งคู่ในจุดเดียว · `customerDocRef()` แยกชนิดจาก `preorder_no` / `order_no` |

**หลักการที่ใช้ทุกจุด:** LINE ล้มเหลว / ไม่ได้ตั้งค่า **ไม่ทำให้ธุรกรรมหลักล้ม** (fire-and-forget + catch + log warn) ·
dev/test ที่ไม่มี token ไม่เสีย query เพิ่ม

**เทส:** `tests/lib/line.test.ts` (+2 เคส `to`) · `tests/lib/lineLogin.test.ts` ใหม่ (config, state ปลอม / secret อื่น /
ไม่มี audience, authorize URL, แลก code สำเร็จ / ล้มเหลว) · `tests/integration/customerLineNotify.test.ts` ใหม่ 11 เคส ·
ผลตอนนั้น unit 206 / integration 197 ✅ · `next build` ✅

---

### 9.2 แจ้งเจ้าของร้าน: พรีออเดอร์ใหม่ + สินค้าใกล้หมดจากการปรับสต็อกเอง (2026-09-30, §8 ข้อ 1–2)

#### ข้อ 1 — พรีออเดอร์ใหม่แจ้งเจ้าของร้าน (`src/services/preorderService.ts`)

| | ก่อน | หลัง |
|---|---|---|
| ลูกค้าสร้างพรีออเดอร์ | แจ้งแค่ลูกค้า — ร้าน**ไม่รู้**ว่ามีพรีออเดอร์เข้า (ต่างจากออเดอร์ปกติที่แจ้งร้าน) | แจ้งร้านด้วย (หน้าแจ้งเตือนในเว็บ + LINE) |
| ข้อความ | — | title `พรีออเดอร์ใหม่ PRE-…` · message `รอบ <round_name> · ยอดรวม … บาท` · module `order` · type `info` |

```ts
// หลัง — ใน createPreorder หลัง saga.commit() (สร้างไม่สำเร็จ → rollback → ไม่แจ้ง)
notificationService
  .notify({
    title: `พรีออเดอร์ใหม่ ${preorder.preorder_no}`,
    message: `รอบ ${round.round_name ?? "-"} · ยอดรวม ${toBaht(total_amount).toLocaleString("th-TH")} บาท`,
    module: "order",
    type: "info",
    link: null,
  })
  .catch((err) => log.error("preorder.notify_failed", { preorder_id: String(preorder._id), err }));
```

- best-effort เหมือนฝั่ง order · `link: null` เพราะยังไม่มี path หน้าจัดการพรีออเดอร์ฝั่ง frontend ที่ยืนยันแล้ว
  (ออเดอร์ใช้ `/owner/orders/manageOrders?id=…`) — ได้ path แล้วให้ใส่ใน `createPreorder`

#### ข้อ 2 — สินค้าใกล้หมดจากการปรับสต็อกเอง (`src/services/productService.ts`)

| ทางที่สต็อกลด | ก่อน | หลัง |
|---|---|---|
| ขาย (`deductStockForOrder`) | ✅ แจ้ง (logic เขียน inline ที่นี่ที่เดียว) | ✅ แจ้ง (ย้ายมาเรียก helper) |
| ตั้งยอดตรง ๆ / นับสต็อก (`setStock` ← `PUT /api/admin/products/[id]/stock`) | ❌ ไม่แจ้ง | ✅ แจ้ง |
| ปรับ ± / ตัดของเสีย (`adjustStock` ← `PATCH …/stock`, รวม `increaseStock` / `decreaseStock`) | ❌ ไม่แจ้ง | ✅ แจ้ง |

```ts
// ก่อน — อยู่ใน deductStockForOrder อย่างเดียว
if (before > LOW_STOCK_THRESHOLD && after <= LOW_STOCK_THRESHOLD) {
  notificationService.notify({ /* สินค้าใกล้หมด */ }).catch(/* ... */);
}

// หลัง — helper กลาง ใช้ร่วม 3 จุด
function notifyIfLowStockCrossed(product, before, after): void {
  if (!(before > LOW_STOCK_THRESHOLD && after <= LOW_STOCK_THRESHOLD)) return;
  notificationService.notify({ /* สินค้าใกล้หมด */ }).catch(/* ... */);
}
```

วิธีได้ค่า `before` ของแต่ละจุด:
- `deductStockForOrder` — ค่าจาก doc ที่อ่านไว้ก่อนตัด (เหมือนเดิม)
- `setStock` — **ก่อน:** `findOneAndUpdate(..., { new: true })` ได้แต่ค่าหลังอัปเดต ไม่รู้ค่าเดิม ·
  **หลัง:** ตัด `new: true` ออก → ได้ doc **ก่อน**อัปเดตจากคำสั่งเดียวกัน (atomic — ไม่คลาดแม้มีคนขายพร้อมกัน
  ต่างจากการอ่านแยกอีกรอบ) แล้วคืน `{ ...previous, product_stock_quantity: quantity }` ให้ route (shape เหมือนเดิม)
- `adjustStock` — `before = after - delta` (จากผล `$inc` ตัวเดียวกัน)

เงื่อนไขไม่เปลี่ยน: แจ้งเฉพาะ "เพิ่งข้าม" `> 5` → `≤ 5` — เพิ่มสต็อก หรือต่ำอยู่แล้วลดต่อ ไม่แจ้งซ้ำ

**เทส:** `tests/integration/ownerLineNotify.test.ts` ใหม่ 6 เคส — `setStock` 10→3 แจ้ง / 4→2 ไม่แจ้ง ·
`adjustStock` 8→4 แจ้ง / 2→12 ไม่แจ้ง · `decreaseStock` 6→5 แจ้ง (เท่าเกณฑ์นับว่าใกล้หมด) ·
`createPreorder` สร้าง notification มีชื่อรอบ + ยอด 240 · ผล unit 206 ✅ · integration 203 ✅ ·
typecheck ✅ · lint 0 error (warning 5 จุดเดิมใน `src/app/api/admin/*` ไม่เกี่ยวกับงานนี้)

---

### 9.3 แก้การตั้งค่า LINE จนใช้งานได้จริง (2026-09-29 → 2026-09-30, นอก git)

ไล่ตามลำดับที่เจอ — ทุกขั้นตรวจด้วยการยิง LINE API จริงโดยไม่แสดงค่าลับ

| # | อาการที่เจอ (ก่อน) | ตรวจด้วย | สาเหตุ | แก้ | หลังแก้ |
|---|---|---|---|---|---|
| 1 | push หาเจ้าของร้านได้ `401 Authentication failed` — **แจ้งเตือนร้านไม่เคยส่งถึง LINE เลย** (มีแค่ `line_error` ใน DB) | `GET /v2/bot/info` | `LINE_CHANNEL_ACCESS_TOKEN` ใช้ไม่ได้ | ออก Channel access token (long-lived) ใหม่จากแท็บ Messaging API ของ OA | `200` — OA "MeowMeeCake" · push ทดสอบถึง `LINE_TARGET_ID` ✅ |
| 2 | ไม่มี `LINE_LOGIN_*` ใน `.env.local` → `authorize_url` = `null` | เช็คชื่อ key | ยังไม่ได้เพิ่ม | เพิ่ม 4 key (placeholder + URL) แล้วเจ้าของกรอก ID / secret | ครบ 4 key |
| 3 | บรรทัด `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TARGET_ID`, `LINE_LOGIN_CHANNEL_SECRET` มีช่องว่างรอบ `=` | ตรวจรูปแบบ (ไม่พิมพ์ค่า) | พิมพ์เว้นวรรค — Next.js trim ให้เลยยังทำงาน แต่ `node --env-file` / Docker อาจอ่านช่องว่างติดไปด้วย | ลบช่องว่างเป็น `KEY=value` (สำรองไฟล์เดิมไว้ก่อน) | ทั้ง 3 ค่ายังผ่าน LINE API ✅ |
| 4 | หน้า authorize ตอบ `400 Invalid redirect_uri value` แม้ใส่ Callback URL แล้ว — ลอง 9 รูปแบบ URL ก็ 400 หมด | authorize แบบไม่ตาม redirect + ลอง URL หลายแบบ | `LINE_LOGIN_CHANNEL_ID` เป็นของ **Messaging API channel** (OA) — channel ประเภทนี้ไม่มีที่ลงทะเบียน Callback URL · ยืนยันจากหน้า Basic settings ที่มีข้อความ *"change your app name and icon in LINE Official Account Manager"* | สร้าง **LINE Login channel** ใหม่ (Web app, PROFILE + OPENID_CONNECT) ใน Provider เดียวกับ OA → ใช้ ID / secret ของตัวใหม่ | id + secret คู่ถูก ✅ · control ด้วย Channel ID ปลอมตอบ `Invalid client_id` แต่ตัวจริงผ่านไปติดที่ `redirect_uri` = LINE รู้จัก channel แล้ว |
| 5 | channel ใหม่ยังตอบ `Invalid redirect_uri` ทุก URL (ลองซ้ำทุก 30 วินาที 4 ครั้ง — ไม่ใช่เรื่อง delay) | เหมือนข้อ 4 | ยังไม่ได้ใส่ Callback URL ในแท็บ **LINE Login** ของ channel นี้ (หน้าที่ส่งมาดูเป็น Basic settings) | ใส่ `http://localhost:3000/api/shop/me/line/callback` ในแท็บ LINE Login → Update | **`302` → `access.line.me/oauth2/v2.1/login`** ✅ (URL เต็มที่ระบบสร้าง รวม `bot_prompt` + `openid`) |

**บทเรียน** (อยู่ใน §6.1 ด้วย): การเช็ค id + secret ที่ token endpoint (`invalid_grant` = คู่ถูก) ยืนยัน**ไม่ได้**ว่าเป็น
LINE Login channel — OA channel ก็ผ่าน · ต้องดูประเภท channel ใน Console หรือเช็ค authorize ตรง ๆ

**สถานะหลังแก้ทั้งหมด:** แจ้งเตือนเจ้าของร้านใช้งานได้จริง ✅ · ลิงก์ผูกบัญชีลูกค้าเปิดหน้าล็อกอิน LINE ได้ ✅ ·
เหลือทดสอบผูกบัญชีจริงแบบ end-to-end ด้วยมือ (ต้องกดยินยอมในหน้า LINE — §7)

---

### 9.4 เอกสาร

| ไฟล์ | ก่อน | หลัง |
|---|---|---|
| `docs/LINE.md` | ไม่มี | ใหม่ — ภาพรวม, เหตุการณ์, env, ตั้งค่า Console, API frontend, แก้ปัญหา (+ §6.1 แยกประเภท channel), สถานะทดสอบ, ช่องโหว่, บันทึกการแก้ไขนี้ |
| `docs/env.md` | `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TARGET_ID` — "ยังไม่ทำ" | ลิงก์มา `LINE.md` + เพิ่มแถว `LINE_LOGIN_*` 4 ตัว |
| `.env.example` | หัวข้อ LINE "ทำภายหลัง" มี 2 key | อธิบายแต่ละ key + เพิ่ม `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` / `LINE_LOGIN_CALLBACK_URL` / `LINE_LINK_RETURN_URL` พร้อมค่า dev |
