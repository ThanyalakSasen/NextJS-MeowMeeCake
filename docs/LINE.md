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
| ออเดอร์ใหม่ | ออเดอร์เว็บ `ORD-` → หน้าแจ้งเตือนเว็บ + LINE · ออเดอร์หน้าร้าน `POS-` → หน้าแจ้งเตือนเว็บ**อย่างเดียว** (ตั้ง `LINE_NOTIFY_POS_ORDERS=true` ถ้าอยากได้ LINE ด้วย — §9.5) | `orderService.persistOrder` |
| พรีออเดอร์ใหม่ | ทุกพรีออเดอร์ — ข้อความมีชื่อรอบ + ยอดรวม (เพิ่ม 2026-09-30, §9) | `preorderService.createPreorder` |
| สลิปรอตรวจ | ลูกค้าแนบ/แก้สลิป | `paymentService.submitSlip` |
| สินค้าใกล้หมด | สต็อกเพิ่งข้ามลงมา ≤ **เกณฑ์ของสินค้านั้น** (`products.low_stock_threshold` · ไม่ตั้ง = 5 — §9.5) — ทั้งตอนขาย **และ** ปรับสต็อกเอง (นับสต็อก/ตัดของเสีย — §9.2) | `productService.notifyIfLowStockCrossed()` ← `deductStockForOrder` / `setStock` / `adjustStock` (+ `increaseStock`/`decreaseStock`) |
| วัตถุดิบใกล้หมด | สต็อกเพิ่งข้ามลงมา ≤ `reorder_point` ของวัตถุดิบนั้น | `ingredientTransactionService.createTransaction` |

แจ้งเฉพาะตอน "เพิ่งข้ามเกณฑ์" — ไม่แจ้งซ้ำทุกครั้งที่ของยังเหลือน้อยอยู่

### ลูกค้า (`customerNotifyService.notifyCustomerLater()` — push LINE อย่างเดียว ไม่บันทึก DB)

| เหตุการณ์ | ออเดอร์ | พรีออเดอร์ | จุดเรียก |
|---|---|---|---|
| ได้รับออเดอร์ + ยอดรวม | ✅ (เฉพาะเว็บ ไม่ส่งสำหรับ POS) | ✅ | `orderService.persistOrder` / `preorderService.createPreorder` |
| สถานะเปลี่ยน — **เฉพาะ** `ready` (รับเองที่ร้าน) และ `cancelled` + เหตุผล · ไม่แจ้ง confirmed / preparing / completed และ ready ของออเดอร์จัดส่ง (ประหยัดโควตา — §9.6) | ✅ | ✅ | `updateOrderStatus` / `updatePreorderStatus` |
| ชำระเงิน (paid / failed / refunded) | ✅ | ✅ | `lib/orderLifecycle.setEntityPaymentStatus` |
| จัดส่ง (shipping + เลขพัสดุ / delivered / failed) | ✅ | ✅ | `lib/orderLifecycle.applyEntityDeliveryUpdate` |

จัดส่ง: แจ้งเฉพาะตอน `delivery_status` เปลี่ยนจริง — แก้แค่ `tracking_no`/note ไม่แจ้งซ้ำ

---

## 3. ตัวแปร env (`.env.local`)

```env
# Messaging API channel (LINE OA) — ใช้ส่งทั้งหาเจ้าของร้านและลูกค้า
LINE_CHANNEL_ACCESS_TOKEN=
LINE_TARGET_ID=
# true = ออเดอร์หน้าร้าน (POS) ส่ง LINE หาเจ้าของร้านด้วย (ไม่ตั้ง = ไม่ส่ง)
LINE_NOTIFY_POS_ORDERS=
# จำนวนข้อความที่กันไว้ให้เจ้าของร้านต่อเดือน — โควตาเหลือเท่านี้แล้วหยุดส่งหาลูกค้า (ไม่ตั้ง = 30)
LINE_OWNER_QUOTA_RESERVE=

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
| `LINE_NOTIFY_POS_ORDERS` | ไม่บังคับ — `true` = ออเดอร์ POS ส่ง LINE หาเจ้าของร้านด้วย · ไม่ตั้ง = บันทึกในหน้าแจ้งเตือนเว็บอย่างเดียว (§9.5) |
| `LINE_OWNER_QUOTA_RESERVE` | ไม่บังคับ — จำนวนเต็ม ≥ 0 (ค่าเริ่มต้น 30) · โควตาเดือนนี้เหลือ ≤ ค่านี้ → หยุดส่งหาลูกค้า เก็บไว้ให้แจ้งเตือนร้าน (§9.6) |
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
3. ~~**เกณฑ์สินค้าใกล้หมดตายตัว 5 ชิ้นทุกสินค้า**~~ — ✅ แก้แล้ว 2026-09-30 (§9.5)
4. ~~**ออเดอร์ POS แจ้งเจ้าของร้านทุกออเดอร์**~~ — ✅ แก้แล้ว 2026-09-30 (§9.5)
5. **เตือนลูกค้าก่อนวันรับพรีออเดอร์** — ต้องมี scheduled job (cron) ซึ่งโปรเจกต์ยังไม่มี
6. **ปุ่ม "เชื่อม LINE" ฝั่ง frontend** — อยู่ใน repo frontend (แยกจาก repo นี้) ใช้ API ข้อ 5
7. **โควตาข้อความ LINE OA ฟรี 300 ข้อความ/เดือน** — ✅ รับมือแล้ว 2026-09-30 (§9.6: ลดข้อความลูกค้า + กันโควตาให้ร้าน + แจ้งในเว็บ) · ถ้าร้านโตจนโควตาไม่พอ ต้องอัปเกรดแพ็กเกจใน LINE Official Account Manager (มีค่าใช้จ่าย — เจ้าของร้านตัดสินใจ)

---

## 9. บันทึกการแก้ไขทั้งหมด (ก่อน → หลัง)

สรุปตามลำดับเวลา · โค้ดอยู่ใน PR #53 (`feat/line-customer-notify`, stacked บน #52) · ส่วนตั้งค่า (§9.3) อยู่นอก git

| # | รอบ | เรื่อง | ที่ไหน |
|---|---|---|---|
| 9.1 | commit `8b707bc` | แจ้งเตือนลูกค้าทาง LINE + ผูกบัญชีผ่าน LINE Login | โค้ด + เทส + docs |
| 9.2 | commit ถัดมา (PR #53) | แจ้งเจ้าของร้าน: พรีออเดอร์ใหม่ + สินค้าใกล้หมดจากการปรับสต็อกเอง | `preorderService` / `productService` |
| 9.3 | ไม่อยู่ใน git | แก้การตั้งค่า LINE จนใช้งานได้จริง (token 401, ช่องว่างใน env, channel ผิดประเภท, Callback URL) | `.env.local` + LINE Developers Console |
| 9.4 | ทุก commit | เอกสาร | `docs/LINE.md`, `docs/env.md`, `.env.example` |
| 9.5 | commit ถัดมา (PR #53) | แจ้งเจ้าของร้าน: เกณฑ์สินค้าใกล้หมดรายสินค้า + ออเดอร์ POS ไม่ส่ง LINE | `lib/lowStock` / `productService` / `dashboardService` / `notificationService` / `orderService` |
| 9.6 | commit ถัดมา (PR #53) | รับมือโควตา LINE OA 300 ข้อความ/เดือน: ลดข้อความลูกค้า + กันโควตาให้ร้าน + แจ้งในเว็บ | `lib/lineQuota` / `customerNotifyService` / `notificationService` |

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

---

### 9.5 แจ้งเจ้าของร้าน: เกณฑ์สินค้าใกล้หมดรายสินค้า + ออเดอร์ POS ไม่ส่ง LINE (2026-09-30, §8 ข้อ 3–4)

#### ข้อ 3 — เกณฑ์สินค้าใกล้หมดตั้งได้รายสินค้า

**ภาพรวม ก่อน → หลัง**

| | ก่อน | หลัง |
|---|---|---|
| เกณฑ์ | ค่าคงที่ `LOW_STOCK_THRESHOLD = 5` ใน `productService.ts` ใช้ทุกสินค้า — ขนมขายวันละ 50 ชิ้นก็เตือนตอนเหลือ 5 (สายไป) ของฝากขายวันละชิ้นก็เตือนตอน 5 (เร็วไป) | ฟิลด์ใหม่ `products.low_stock_threshold` ตั้งรายสินค้าได้ (เทียบ `reorder_point` ของวัตถุดิบ) · ไม่ตั้ง (`null`) = 5 เหมือนเดิม |
| ที่ใช้เกณฑ์ | 3 ที่ เขียนเลข 5 แยกกัน: แจ้งเตือน, `GET /api/admin/products/low-stock` (default `?threshold=5`), dashboard (`$lte: 5`) | ทั้ง 3 ที่อ่านจาก `src/lib/lowStock.ts` ที่เดียว — ไม่ drift |
| ข้อความ LINE | `คงเหลือ 3 ชิ้น` | `คงเหลือ 3 ชิ้น (เกณฑ์แจ้งเตือน 5)` — รู้ว่าเตือนเพราะเกณฑ์เท่าไร |

**รายไฟล์**

| ไฟล์ | ก่อน | หลัง |
|---|---|---|
| `src/lib/lowStock.ts` (ใหม่) | — | `DEFAULT_LOW_STOCK_THRESHOLD = 5` · `effectiveLowStockThreshold(product)` (= `low_stock_threshold ?? 5`) · `crossedLowStock(threshold, before, after)` · `LOW_STOCK_EXPR` (MongoDB `$expr`: สต็อก ≤ `$ifNull: ["$low_stock_threshold", 5]`) |
| `src/models/productModel.ts` | ไม่มีฟิลด์ | + `low_stock_threshold: { type: Number, min: 0, default: null }` |
| `src/services/productService.ts` — create/update | ไม่รับค่านี้ | รับ `low_stock_threshold` · `assertLowStockThreshold()` บังคับจำนวนเต็ม ≥ 0 หรือ `null` (ผิด → 400) · สินค้า preorder (ไม่มีสต็อก) เก็บเป็น `null` เสมอ · เปลี่ยนประเภทเป็น preorder → ล้างเป็น `null` |
| `src/services/productService.ts` — `notifyIfLowStockCrossed` | `before > 5 && after <= 5` | `crossedLowStock(effectiveLowStockThreshold(product), before, after)` — ทุกจุดที่เรียก (ขาย/`setStock`/`adjustStock`) ส่ง doc เต็มที่มีฟิลด์นี้อยู่แล้ว ไม่ต้อง query เพิ่ม |
| `src/services/productService.ts` — `getLowStockProducts` | `(threshold = 5)` → `$lte: threshold` · คืน `{ threshold, count, items }` | `(threshold?)` — **ไม่ส่ง = เกณฑ์รายสินค้า** (`LOW_STOCK_EXPR`) · ส่งตัวเลข = เกณฑ์เดียวทุกตัวแบบเดิม · คืน `{ threshold, per_product, count, items }` + `items[].low_stock_threshold` |
| `src/app/api/admin/products/low-stock/route.ts` | `parseNumber(threshold) ?? 5` | `parseNumber(threshold)` — ไม่ส่ง `?threshold=` = เกณฑ์รายสินค้า |
| `src/services/dashboardService.ts` (`overview`) | `product_stock_quantity: { $ne: null, $lte: 5 }` | `product_stock_quantity: { $ne: null }` + `LOW_STOCK_EXPR` |

```ts
// ก่อน — productService.ts
const LOW_STOCK_THRESHOLD = 5;
if (!(before > LOW_STOCK_THRESHOLD && after <= LOW_STOCK_THRESHOLD)) return;

// หลัง — เกณฑ์ของสินค้าชิ้นนั้น (src/lib/lowStock.ts)
const threshold = effectiveLowStockThreshold(product); // low_stock_threshold ?? 5
if (!crossedLowStock(threshold, before, after)) return;
```

**API ที่เปลี่ยน (สำหรับ frontend)**
- `POST /api/admin/products`, `PATCH /api/admin/products/[id]` — รับ `low_stock_threshold` (จำนวนเต็ม ≥ 0 หรือ `null`)
  → ควรเพิ่มช่อง "แจ้งเตือนเมื่อเหลือ ≤ … ชิ้น (เว้นว่าง = 5)" ในฟอร์มสินค้าที่มีสต็อก
- `GET /api/admin/products/low-stock` — ไม่ส่ง `?threshold=` แล้วผลเปลี่ยนจาก "≤ 5 ทุกตัว" เป็น "≤ เกณฑ์ของแต่ละตัว"
  (สินค้าที่ไม่ได้ตั้งยังเป็น 5 → ผลเหมือนเดิมจนกว่าจะตั้งค่า) · response เพิ่ม `per_product` + `items[].low_stock_threshold`
- สินค้าเดิมใน DB ไม่ต้อง migrate — ไม่มีฟิลด์ = `null` = 5

#### ข้อ 4 — ออเดอร์หน้าร้าน (POS) ไม่ส่ง LINE หาเจ้าของร้าน

| | ก่อน | หลัง |
|---|---|---|
| ออเดอร์เว็บ `ORD-` | หน้าแจ้งเตือนเว็บ + LINE | เหมือนเดิม |
| ออเดอร์หน้าร้าน `POS-` | หน้าแจ้งเตือนเว็บ + LINE **ทุกบิล** — พนักงานคีย์เองอยู่หน้าร้าน ร้านขายเยอะ LINE เจ้าของเด้งไม่หยุด จนข้อความสำคัญ (ออเดอร์เว็บ/สต็อกใกล้หมด) จมหาย | หน้าแจ้งเตือนเว็บ**อย่างเดียว** (ยังดูย้อนหลังได้) · ตั้ง `LINE_NOTIFY_POS_ORDERS=true` ถ้าอยากได้ LINE เหมือนเดิม |
| สินค้าใกล้หมดจากการขาย POS | แจ้ง LINE | **ยังแจ้ง LINE เหมือนเดิม** — ปิดแค่ข้อความ "ออเดอร์ใหม่" ของ POS |

| ไฟล์ | ก่อน | หลัง |
|---|---|---|
| `src/services/notificationService.ts` | `notify()` บันทึก DB แล้ว push LINE เสมอ | `NotifyInput.line?: boolean` — `false` = บันทึก DB แล้วจบ (`line_sent` คง `false`, ไม่มี `line_error`) · ไม่ส่ง = push เหมือนเดิม (ผู้เรียกเดิมไม่ต้องแก้) |
| `src/services/orderService.ts` (`persistOrder`) | `notify({ ... })` ทุกช่องทาง | `const isPos = orderNoPrefix(opts.channel) === "POS"` · `notify({ ..., line: !isPos \|\| process.env.LINE_NOTIFY_POS_ORDERS === "true" })` · แจ้งลูกค้าใช้ `!isPos` ตัวเดียวกัน (เดิมเช็ค `=== "ORD"` แยก) |
| `.env.example`, `docs/env.md` | — | + `LINE_NOTIFY_POS_ORDERS` |

#### เทส (`tests/integration/ownerLineNotify.test.ts` +8 เคส รวม 14)

| เคส | ผลที่คาด |
|---|---|
| ตั้งเกณฑ์ 20: `setStock` 25 → 18 | แจ้ง + ข้อความมี "เกณฑ์แจ้งเตือน 20" (ค่าเริ่มต้น 5 จะไม่แจ้ง) |
| ตั้งเกณฑ์ 0: 10 → 1 แล้ว → 0 | 1 ไม่แจ้ง · 0 แจ้ง |
| create/update | 12 ✅ · -1 / 2.5 → 400 · `null` ล้างได้ · สินค้า preorder → `null` |
| `getLowStockProducts` ไม่ส่ง / ส่ง 15 | ไม่ส่ง: สต็อก 15 เกณฑ์ 20 ติด, เกณฑ์ default ไม่ติด · ส่ง 15: ติดทั้งคู่ |
| dashboard `overview` | นับเพิ่ม 1 (ตัวที่เกณฑ์ 20) ไม่นับตัวที่ใช้ default |
| ออเดอร์เว็บ | บันทึก + push LINE (`line_sent: true`) |
| ออเดอร์ POS ค่าเริ่มต้น | บันทึก แต่ไม่ push (`line_sent: false`) |
| ออเดอร์ POS + `LINE_NOTIFY_POS_ORDERS=true` | push |

ผลรวม: unit 206 ✅ · integration 211 ✅ · typecheck ✅ · `next build` ✅ · lint 0 error (warning 5 จุดเดิม)

---

### 9.6 รับมือโควตาข้อความ LINE OA 300 ข้อความ/เดือน (2026-09-30)

**ที่มา:** ตรวจ `GET /v2/bot/message/quota` ของ OA จริง → `{ type: "limited", value: 300 }` (แพ็กเกจฟรี) ·
ทุกข้อความ push นับ 1 ต่อผู้รับ 1 คน · ก่อนแก้ ออเดอร์เว็บ 1 ออเดอร์ใช้ ~6–9 ข้อความ → **หมดที่ ~35–50 ออเดอร์/เดือน**
แล้ว LINE ตอบ `429` ทุกข้อความ**รวมแจ้งเตือนสต็อกของเจ้าของร้าน**จนขึ้นเดือนใหม่ — เงียบโดยไม่มีใครรู้
(มีแค่ `line_error` ใน DB)

**ภาพรวม ก่อน → หลัง**

| | ก่อน | หลัง |
|---|---|---|
| ข้อความต่อออเดอร์เว็บ (รับเอง จ่ายโอน) | ร้าน 1 + ลูกค้า: ได้รับ 1 · ชำระเงิน 1 · confirmed/preparing/ready/completed 4 = **7** | ร้าน 1 + ลูกค้า: ได้รับ 1 · ชำระเงิน 1 · ready 1 = **4** |
| ข้อความต่อออเดอร์เว็บ (จัดส่ง จ่ายโอน) | ร้าน 1 + ลูกค้า: 1 + 1 + สถานะ 4 + จัดส่ง 2 = **9** | ร้าน 1 + ลูกค้า: 1 + 1 + จัดส่ง 2 = **5** |
| ออเดอร์เว็บต่อเดือนก่อนโควตาหมด (ประมาณ) | ~35–50 | ~55–65 (270 ÷ 4–5 · หลังหักที่กันไว้ให้ร้าน 30 · ไม่รวมแจ้งเตือนสต็อก) |
| โควตาใกล้หมด | ส่งหาลูกค้าจนหมด → แจ้งเตือนร้านไม่ถึงด้วย | เหลือ ≤ 30 → **หยุดส่งหาลูกค้า** · ร้านยังได้แจ้งเตือนจาก 30 ข้อความที่กันไว้ |
| เจ้าของร้านรู้ไหมว่า LINE ใกล้หมด/หมด | ❌ ไม่รู้ | ✅ แจ้งในหน้าแจ้งเตือนเว็บ (ไม่กินโควตา) เดือนละครั้งต่อเรื่อง |

#### ข้อ ก — ลดข้อความถึงลูกค้า (`src/services/customerNotifyService.ts`)

| สถานะ | ก่อน | หลัง | เหตุผล |
|---|---|---|---|
| `pending` | "รอดำเนินการ" | ไม่แจ้ง | ได้ "ได้รับออเดอร์" ตอนสร้างแล้ว |
| `confirmed` | "ร้านยืนยันแล้ว" | ไม่แจ้ง | จ่ายเงินแล้วได้ "ชำระเงินสำเร็จ" + ระบบ auto-confirm อยู่แล้ว |
| `preparing` | "กำลังเตรียมสินค้า" | ไม่แจ้ง | ลูกค้าไม่ต้องทำอะไร ดูในเว็บได้ |
| `ready` | "สินค้าพร้อมแล้ว" ทุกออเดอร์ | "สินค้าพร้อมรับที่ร้านแล้ว 🎉" **เฉพาะรับเอง** | ลูกค้าต้องมารับ = สำคัญ · ออเดอร์จัดส่งได้ "กำลังจัดส่ง" แทน |
| `completed` | "เสร็จสิ้น ขอบคุณที่อุดหนุนค่ะ" | ไม่แจ้ง | ลูกค้ารับของไปแล้ว |
| `cancelled` | "ถูกยกเลิก" + เหตุผล | เหมือนเดิม | ลูกค้าต้องรู้ |
| ได้รับออเดอร์ / ชำระเงิน / จัดส่ง | แจ้ง | เหมือนเดิม | — |

```ts
// ก่อน
orderStatus(kind, docNo, status, reason?)          // แจ้งทุกสถานะใน ORDER_STATUS_TEXT (6 สถานะ)
// หลัง
orderStatus(kind, docNo, status, { reason, orderType })
// ORDER_STATUS_TEXT เหลือ ready + cancelled · ready + orderType "delivery" → null (ไม่ส่ง)
```

ผู้เรียก `orderService.updateOrderStatus` / `preorderService.updatePreorderStatus` ส่ง `order_type` มาด้วย

#### ข้อ ข — กันโควตาไว้ให้เจ้าของร้าน (`src/lib/lineQuota.ts` ใหม่)

- `getQuotaStatus()` — ถาม LINE `GET /v2/bot/message/quota` + `/quota/consumption` · **cache 5 นาที** (ไม่ถาม 2 request
  ทุกข้อความ) · `recordPushed()` หักจาก cache ทุกครั้งที่ส่งสำเร็จ (ทั้งร้านและลูกค้า) เพราะตัวเลข consumption ของ LINE
  อัปเดตช้า — ไม่งั้นช่วง cache จะส่งทะลุ reserve ได้
- `canSendToCustomer()` — เหลือ **≤ `LINE_OWNER_QUOTA_RESERVE`** (ค่าเริ่มต้น 30) → `false`
- `customerNotifyService.notifyCustomer` เช็คก่อน push ทุกครั้ง · **เจ้าของร้านไม่ถูกเช็ค** — ใช้ 30 ข้อความที่กันไว้
- แพ็กเกจไม่จำกัด (`type: "none"`) → ส่งได้เสมอ
- **fail-open:** ถามโควตาไม่ได้ (ไม่มี token / network / API error) → ส่งตามปกติ ไม่ให้ปัญหาฝั่ง quota API ทำแจ้งเตือนเงียบทั้งระบบ

```ts
// หลัง — customerNotifyService.notifyCustomer
if (!(await canSendToCustomer())) return false;     // เหลือ ≤ reserve → ข้าม (+ แจ้งในเว็บ ข้อ ค)
const result = await pushLineMessage(text, user.line_user_id);
if (result.ok) recordPushed();
else if (isQuotaExceededError(result.error)) await alertQuotaExhausted();
```

#### ข้อ ค — แจ้งในหน้าแจ้งเตือนเว็บ (ไม่กินโควตา)

| หัวข้อ (module `system`, type `warning`) | เกิดเมื่อ | ข้อความ |
|---|---|---|
| `โควตา LINE ใกล้หมด (YYYY-MM)` | `canSendToCustomer()` เจอเหลือ ≤ reserve | เหลือ x/300 — หยุดส่งหาลูกค้าชั่วคราว กันไว้ 30 ให้แจ้งเตือนร้าน |
| `โควตา LINE หมดแล้ว (YYYY-MM)` | push ได้ `429` (ทั้งฝั่งร้าน `notificationService.notify` และฝั่งลูกค้า) | LINE ปฏิเสธ — แจ้งเตือนทาง LINE ทั้งหมดจะไม่ถึงจนขึ้นเดือนใหม่ ดูในหน้านี้แทน / อัปเกรดแพ็กเกจ |

- **เดือนละครั้งต่อหัวข้อ:** ใส่เดือน (เวลาไทย) ใน title แล้วเช็ค `exists` ก่อนสร้าง — restart server ก็ไม่ซ้ำ
- เขียนตรงผ่าน `notificationModel` (ไม่ผ่าน `notificationService.notify`) — ไม่ push LINE และกัน import วน
- `notificationService.notify` ฝั่งร้าน: **ก่อน** push ล้มเหลวแค่บันทึก `line_error` · **หลัง** + `recordPushed()` ตอนสำเร็จ
  และ `alertQuotaExhausted()` ตอนได้ 429

#### รายไฟล์

| ไฟล์ | เปลี่ยน |
|---|---|
| `src/lib/lineQuota.ts` (ใหม่) | `getQuotaStatus` · `recordPushed` · `canSendToCustomer` · `alertQuotaExhausted` · `isQuotaExceededError` · `ownerQuotaReserve` · `resetQuotaCache` (เทส) |
| `src/services/customerNotifyService.ts` | ข้อ ก (สถานะ) + ข้อ ข/ค (เช็คโควตา, นับ, 429) |
| `src/services/notificationService.ts` | `recordPushed` ตอนสำเร็จ · `alertQuotaExhausted` ตอน 429 |
| `src/services/orderService.ts`, `src/services/preorderService.ts` | ส่ง `{ reason, orderType }` ให้ `orderStatus` |
| `.env.example`, `docs/env.md`, §3 | + `LINE_OWNER_QUOTA_RESERVE` |

#### เทส

- `tests/integration/lineQuota.test.ts` ใหม่ 9 เคส — reserve ค่าเริ่มต้น/ตั้งเอง/ค่าผิด · เหลือเยอะส่งได้ · เหลือ = reserve
  ไม่ส่ง + แจ้งเว็บครั้งเดียว (เรียก 2 รอบ) · ร้านยังส่งได้ใต้ reserve · นับเองระหว่าง cache แล้วหยุดตรง reserve
  (ถาม LINE แค่รอบแรก) · แพ็กเกจไม่จำกัด · ถามโควตาไม่ได้ = ส่ง · 429 ฝั่งร้าน/ลูกค้า → แจ้งเว็บครั้งเดียว + `line_error`
- `tests/integration/customerLineNotify.test.ts` — ปรับเคสสถานะ: ไล่ `confirmed → preparing → ready → completed` แล้ว
  ได้ข้อความเดียว (ready) · + เคสยกเลิกพร้อมเหตุผล · + เคส `orderStatus` คืน `null` ตามตาราง ข้อ ก

ผลรวม: unit 206 ✅ · integration 222 ✅ · typecheck ✅ · `next build` ✅ · lint 0 error (warning 5 จุดเดิม)
