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
| ⏰ เตือนก่อนวันรับ (รับเอง: "มารับได้ที่ร้าน…" / จัดส่ง: "จะเริ่มจัดส่ง…" · ยังไม่จ่ายเตือนชำระด้วย) — วันละครั้งจากตัวตั้งเวลา (§9.7) | — | ✅ | `preorderReminderService.sendPickupReminders` |

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

# งานตั้งเวลา — เตือนก่อนวันรับพรีออเดอร์ (§9.7)
CRON_SECRET=
PREORDER_REMINDER_DAYS_BEFORE=

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
| `ADMIN_APP_URL` | ไม่บังคับ — URL เว็บหลังร้าน · ตั้งแล้วข้อความ LINE ถึงเจ้าของร้านแนบลิงก์ `🔗` ไปหน้าที่เกี่ยวข้อง (§9.12) |
| `LINE_NOTIFY_POS_ORDERS` | ไม่บังคับ — `true` = ออเดอร์ POS ส่ง LINE หาเจ้าของร้านด้วย · ไม่ตั้ง = บันทึกในหน้าแจ้งเตือนเว็บอย่างเดียว (§9.5) |
| `LINE_OWNER_QUOTA_RESERVE` | ไม่บังคับ — จำนวนเต็ม ≥ 0 (ค่าเริ่มต้น 30) · โควตาเดือนนี้เหลือ ≤ ค่านี้ → หยุดส่งหาลูกค้า เก็บไว้ให้แจ้งเตือนร้าน (§9.6) |
| `CRON_SECRET` | ต้องตั้งถ้าจะเรียก `/api/cron/preorder-reminders` — ตัวตั้งเวลาส่ง `Authorization: Bearer <ค่านี้>` · ไม่ตั้ง = ปิด endpoint (สคริปต์ `npm run remind:preorders` ไม่ต้องใช้) (§9.7) |
| `PREORDER_REMINDER_DAYS_BEFORE` | ไม่บังคับ — เตือนก่อนวันรับกี่วัน (ค่าเริ่มต้น 1 · 0 = วันรับ) (§9.7) |
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
| `?line=error&reason=login_required` | ไม่ได้ล็อกอิน / session หมดอายุระหว่างอยู่หน้า LINE (เพิ่ม §9.8) — ไม่ส่ง `reason` = กรณีอื่นข้างบน | "กรุณาเข้าสู่ระบบอีกครั้ง แล้วกดเชื่อม LINE ใหม่" (หรือใช้ข้อความเดียวกับ `error` ก็ได้ — เพิ่ม `reason` แบบไม่ทำให้โค้ดเดิมพัง) |

ไม่ตั้ง `LINE_LINK_RETURN_URL` = ตอบ JSON `{ line: "linked" | ..., reason? }` แทนการ redirect

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
| กลับมาหน้าโปรไฟล์ด้วย `?line=error&reason=login_required` | session หมดอายุ / ล็อกอินคนละเบราว์เซอร์กับที่เปิดหน้า LINE | ล็อกอินใหม่แล้วกดเชื่อม LINE อีกครั้ง (§9.8) |
| ในเว็บขึ้น "โควตา LINE หมดแล้ว (YYYY-MM)" | LINE ตอบ 429 monthly limit | ระบบหยุดยิงหาลูกค้าเองทันที (§9.8) · รอขึ้นเดือนใหม่ หรืออัปเกรดแพ็กเกจ OA · 429 แบบ rate limit ไม่นับ |

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

## 8. ยังไม่ทำ / ข้อจำกัดที่รู้แล้ว

> อัปเดต 2026-09-30 หลังตรวจรอบ 3 — **ไม่มีจุดในโค้ด backend ที่ค้างแก้แล้ว** เหลือ: frontend (§8.2) + ตั้งค่าตอน deploy (§8.3)

### 8.1 สถานะรายการเดิม + ข้อจำกัดที่ตั้งใจไว้

| # | เรื่อง | สถานะ |
|---|---|---|
| 1 | ~~พรีออเดอร์ใหม่ไม่แจ้งเจ้าของร้าน~~ | ✅ แก้แล้ว (§9.2) |
| 2 | ~~สินค้าใกล้หมดแจ้งเฉพาะตอนขาย~~ | ✅ แก้แล้ว (§9.2) |
| 3 | ~~เกณฑ์สินค้าใกล้หมดตายตัว 5 ชิ้นทุกสินค้า~~ | ✅ แก้แล้ว (§9.5) |
| 4 | ~~ออเดอร์ POS แจ้งเจ้าของร้านทุกออเดอร์~~ | ✅ แก้แล้ว (§9.5) |
| 5 | ~~เตือนลูกค้าก่อนวันรับพรีออเดอร์~~ | ✅ ทำแล้ว (§9.7) · **ต้องตั้งตัวตั้งเวลาตอน deploy** (§8.3) |
| 6 | งานฝั่ง frontend | ⏳ ดูรายการครบใน §8.2 |
| 7 | โควตาข้อความ LINE OA ฟรี 300 ข้อความ/เดือน | ✅ รับมือแล้ว (§9.6, §9.8) · ถ้าร้านโตจนไม่พอ ต้องอัปเกรดแพ็กเกจใน LINE Official Account Manager (มีค่าใช้จ่าย — เจ้าของร้านตัดสินใจ) |
| 8 | **ออเดอร์ที่พนักงานสร้างผ่าน `POST /api/admin/orders` ถือเป็น POS โดยค่าเริ่มต้น** (`schemas/order.ts`: `channel` default `"instore"` → เลข `POS-`) | ⚠️ **ตั้งใจ ไม่ใช่บั๊ก** — ลูกค้าไม่ได้ LINE "ได้รับออเดอร์" และเจ้าของร้านไม่ได้ LINE ออเดอร์ใหม่ (พนักงานคีย์เองอยู่แล้ว) · ลูกค้ายังได้ LINE ตอนชำระเงิน / พร้อมรับ / ยกเลิก / จัดส่งตามปกติ · ออเดอร์ที่รับทางโทรศัพท์/แชตแล้วอยากให้ลูกค้าได้ข้อความยืนยัน → frontend ส่ง `channel: "online"` (ได้เลข `ORD-`) |
| 9 | **ข้อความที่ส่งหาลูกค้าไม่ถูกบันทึกลง DB** | ⚠️ ข้อจำกัด — ส่งไม่ถึง (ไม่ได้ผูก / บล็อก OA / โควตา) ดูได้จาก log เท่านั้น (`customer_notify.*`) · ฝั่งเจ้าของร้านบันทึกครบใน notifications (`line_sent` / `line_error`) · ถ้าต้องการหน้าประวัติการส่ง ต้องเพิ่ม collection ใหม่ (ยังไม่ทำ) |
| 10 | ลูกค้าบล็อก OA หลังผูกแล้ว | ⚠️ ข้อจำกัดของ LINE — `linked` ยังเป็น `true` แต่ข้อความไม่ถึง (ต้องรับ webhook `unfollow` ถึงจะรู้ — ยังไม่ทำ) |

### 8.2 สิ่งที่ frontend ต้องทำ

ทุก API ต้องส่ง cookie `session` (`credentials: "include"`) · รูปแบบ response `{ success, data }` เหมือน API อื่น

**ก. หน้าโปรไฟล์ลูกค้า — เชื่อม LINE** (ต้องทำ · §5)

- [ ] เรียก `GET /api/shop/me/line` → `{ linked, authorize_url }`
- [ ] `linked: false` → ปุ่ม "เชื่อม LINE" · `linked: true` → แสดง "เชื่อมแล้ว" + ปุ่ม "ยกเลิกการเชื่อม"
- [ ] `authorize_url: null` → ปิดปุ่ม (server ยังไม่ตั้งค่า LINE Login)
- [ ] กดเชื่อม → เรียก `GET /api/shop/me/line` **ใหม่ทุกครั้ง** (ลิงก์อายุ 10 นาที) แล้ว `window.location.href = data.authorize_url`
  (เปลี่ยนหน้าทั้งหน้า — ห้าม fetch / popup)
- [ ] กดยกเลิก → `DELETE /api/shop/me/line` → `{ linked: false }`
- [ ] ข้อความใต้ปุ่ม เช่น "เชื่อม LINE และเพิ่มเพื่อน MeowMeeCake เพื่อรับแจ้งเตือนออเดอร์" (ไม่เป็นเพื่อน OA = ไม่ได้ข้อความ)
- [ ] หน้าโปรไฟล์อ่าน query ตอน LINE พากลับมา (path ต้องตรงกับ `LINE_LINK_RETURN_URL` — dev = `http://localhost:3001/profile`
  ถ้า path จริงไม่ใช่ `/profile` แจ้ง backend ให้แก้ env):

  | query | แสดง |
  |---|---|
  | `?line=linked` | "เชื่อมต่อ LINE เรียบร้อย" แล้วโหลดสถานะใหม่ |
  | `?line=cancelled` | ไม่ต้องแสดงอะไร |
  | `?line=error&reason=login_required` | "กรุณาเข้าสู่ระบบอีกครั้ง แล้วกดเชื่อม LINE ใหม่" |
  | `?line=error` (ไม่มี `reason`) | "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง" |

- [ ] แสดงผลแล้วล้าง query ออกจาก URL (กันรีเฟรชแล้วขึ้นข้อความซ้ำ)

**ข. ฟอร์มสินค้า (หลังร้าน) — เกณฑ์สินค้าใกล้หมด** (ควรทำ · §9.5)

- [ ] ช่อง "แจ้งเตือนเมื่อเหลือไม่เกิน … ชิ้น (เว้นว่าง = 5)" ใน `POST /api/admin/products` / `PATCH /api/admin/products/[id]`
  ฟิลด์ `low_stock_threshold` — จำนวนเต็ม ≥ 0 หรือ `null` (เว้นว่าง) · ค่าผิดได้ 400
- [ ] แสดงเฉพาะสินค้าปกติ (`is_preorder: false`) — สินค้าพรีออเดอร์ไม่มีช่องนี้ (server เก็บเป็น `null` เสมอ) ·
  ⚠️ ฟิลด์ประเภทสินค้าเปลี่ยนจาก `product_types` เป็น `is_preorder` แล้ว (PR #52 / BACKLOG2 §14.1)
- [ ] (ถ้ามีหน้า "สินค้าใกล้หมด") `GET /api/admin/products/low-stock` **ไม่ส่ง `?threshold=`** แล้ว = ใช้เกณฑ์รายสินค้า ·
  response เพิ่ม `per_product` และ `items[].low_stock_threshold` — ถ้าหน้าเดิมส่ง `?threshold=5` ตายตัวไว้ ให้เอาออก

**ค. หน้าแจ้งเตือนหลังร้าน** (ตรวจว่ายังแสดงถูก · มีฟิลด์ใหม่ `module_label` — §9.10 · หัวข้อเปลี่ยนถ้อยคำ — §9.11)

- [ ] แสดงหมวดด้วย **`module_label`** (คำสั่งซื้อ / วัตถุดิบ / การผลิต / การเงิน / อื่น ๆ) แทน `module` — ไม่ต้องมีตารางแปลเอง ·
  ตัวกรองหมวดยังส่ง `?module=order` ได้เหมือนเดิม (หรือส่งป้ายไทยก็ได้) · หมวด `employee` เลิกใช้แล้ว (เอาตัวเลือกออก)
- [ ] ถ้ามีจุดไหน**ค้น/กรอง/เทียบด้วยข้อความหัวข้อ** ต้องปรับตามถ้อยคำใหม่ (§9.11) เช่น "สินค้าใกล้จะหมด: …", "เปิดพรีออเดอร์รอบใหม่ PRE-…",
  "มีคำสั่งซื้อรอตรวจสอบสลิปโอนเงิน รหัสคำสั่งซื้อ ORD-…" (หัวข้อสลิปมีเลขออเดอร์แล้ว ไม่ใช่ ObjectId)

- [ ] มีแจ้งเตือนหัวข้อใหม่ module `system` type `warning`: "โควตา LINE ใกล้หมด (YYYY-MM)" / "โควตา LINE หมดแล้ว (YYYY-MM)" (§9.6)
- [ ] มีแจ้งเตือน module `order`: "เปิดพรีออเดอร์รอบใหม่ PRE-…" และ "เปิดรับพรีออเดอร์ถึงวันรับ YYYY-MM-DD: N รายการ" — **`link: null`** (§9.2, §9.7)
  ต้องรองรับ `link` เป็น `null` (ไม่ทำลิงก์ / ไม่ error)
- [ ] ออเดอร์หน้าร้าน (`POS-`) ยังขึ้นในหน้าแจ้งเตือนเหมือนเดิม แค่ไม่ส่ง LINE (§9.5)

**ง. ต้องตอบ backend** (ถาม-ตอบ ไม่ต้องเขียนโค้ด)

- [ ] **path หน้าจัดการพรีออเดอร์** ของหลังร้าน (แบบออเดอร์ใช้ `/owner/orders/manageOrders?id=…`) → backend จะใส่ `link` ให้แจ้งเตือนพรีออเดอร์
- [ ] **path หน้าโปรไฟล์ลูกค้า** จริง → ตั้ง `LINE_LINK_RETURN_URL`
- [ ] หน้าสร้างออเดอร์แทนลูกค้า (`POST /api/admin/orders`): ออเดอร์โทรศัพท์/แชตจะส่ง `channel: "online"` ไหม (§8.1 ข้อ 8)

### 8.3 ตั้งค่าตอน deploy (ไม่ใช่โค้ด)

- [ ] ตั้งตัวตั้งเวลาเรียกเตือนพรีออเดอร์วันละครั้ง ~18:00 ไทย (§9.7 "ตั้งค่าให้รันทุกวัน") — ไม่ตั้ง = ไม่มีการเตือนเลย
- [ ] env บนเซิร์ฟเวอร์: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TARGET_ID`, `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET`,
  `LINE_LOGIN_CALLBACK_URL` + `LINE_LINK_RETURN_URL` (**โดเมนจริง https**), `CRON_SECRET` (ถ้าใช้ endpoint) · ตัวเลือก: `LINE_NOTIFY_POS_ORDERS`,
  `LINE_OWNER_QUOTA_RESERVE`, `PREORDER_REMINDER_DAYS_BEFORE` (§3)
- [ ] เพิ่ม Callback URL ของโดเมนจริงในแท็บ **LINE Login** ของ LINE Login channel (เก็บ localhost ไว้ด้วยได้สำหรับ dev) (§4, §6.1)
- [ ] ทดสอบผูกบัญชีจริง end-to-end ด้วยมือ (§7)
- [ ] merge PR #52 ก่อน แล้วค่อย #53

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
| 9.7 | commit ถัดมา (PR #53) | เตือนลูกค้าก่อนวันรับพรีออเดอร์ (cron endpoint + สคริปต์) | `preorderReminderService` / `/api/cron/preorder-reminders` / `scripts/send-preorder-reminders.ts` |
| 9.8 | commit ถัดมา (PR #53) | หลัง 429 หยุดยิงหาลูกค้าทันที + แยก 429 rate limit · callback ไม่มี session พากลับหน้าโปรไฟล์ | `lib/lineQuota` / callback route / `middleware` |
| 9.9 | commit ถัดมา (PR #53) | เอกสาร: §8 แยกเป็นสถานะ + ข้อจำกัดที่ตั้งใจ (8.1) / checklist frontend (8.2) / checklist deploy (8.3) | `docs/LINE.md` |

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
| ข้อความ | — | title `พรีออเดอร์ใหม่ PRE-…` (ตั้งแต่ §9.11: `เปิดพรีออเดอร์รอบใหม่ PRE-…`) · message `รอบ <round_name> · ยอดรวม … บาท` · module `order` · type `info` |

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

---

### 9.7 เตือนลูกค้าก่อนวันรับพรีออเดอร์ (2026-09-30)

**ภาพรวม ก่อน → หลัง**

| | ก่อน | หลัง |
|---|---|---|
| ลูกค้ารู้ว่าพรุ่งนี้ต้องมารับ | ต้องจำเอง / เข้าเว็บดู — พรีออเดอร์สั่งล่วงหน้าหลายวัน ลืมง่าย | ได้ LINE วันก่อนรับ: รับเอง "ถึงวันรับพรีออเดอร์แล้ว — มารับได้ที่ร้านวันศุกร์ที่ 2 ตุลาคม" · จัดส่ง "ร้านจะเริ่มจัดส่งพรีออเดอร์ของคุณ…" · ยังไม่จ่าย + "⚠️ ยังไม่ได้ชำระเงิน กรุณาชำระก่อนวันรับ" |
| ร้านรู้ว่าพรุ่งนี้มีกี่รายการ | ต้องไล่ดูเอง | หน้าแจ้งเตือนเว็บ "พรีออเดอร์ถึงวันรับ 2026-10-02: N รายการ" (ตั้งแต่ §9.11: "เปิดรับพรีออเดอร์ถึงวันรับ …") + เตือนถึงกี่ราย ส่งไม่ถึงกี่ราย + เลขพรีออเดอร์ (ไม่กินโควตา LINE) |
| ระบบตั้งเวลา | ❌ ไม่มีในโปรเจกต์ | endpoint `/api/cron/preorder-reminders` (มี secret) + สคริปต์ `npm run remind:preorders` — ให้ตัวตั้งเวลาภายนอกเรียกวันละครั้ง |

#### เลือกใครบ้าง

- รอบ (`preorderRound.pickup_date`) ตรงกับ **วันนี้ + `PREORDER_REMINDER_DAYS_BEFORE` วัน ตามเวลาไทย** (ค่าเริ่มต้น 1)
  — เทียบเป็นช่วงวันไทย `[00:00, 24:00) +07:00` เช่น รอบรับ 00:30 น. วันที่ 2 นับเป็นวันที่ 2 · 23:30 น. วันที่ 1 นับเป็นวันที่ 1
- ข้าม: รอบ `cancelled` · พรีออเดอร์ `cancelled` / `completed` / ถูกลบ · เคยเตือนแล้ว (`pickup_reminded_at` ไม่ null)
- ส่งผ่าน `customerNotifyService.notifyCustomer` → **ผ่านกลไกโควตา §9.6 ด้วย** (เหลือ ≤ reserve ไม่ส่ง) · ใช้ 1 ข้อความต่อพรีออเดอร์

#### กันส่งซ้ำ

- ฟิลด์ใหม่ `preorders.pickup_reminded_at` · ก่อนส่งแต่ละราย **จองแบบ atomic** `findOneAndUpdate({ _id, pickup_reminded_at: null }, { $set: now })`
  — จองไม่ได้ = อีกตัวส่งไปแล้ว → ข้าม
- ผล: รันซ้ำในวันเดียวกัน / ตัวตั้งเวลายิงซ้ำ / รัน 2 ตัวพร้อมกัน → ลูกค้าได้ข้อความเดียว · สรุปของร้านก็ไม่ซ้ำ (รอบหลังไม่มีรายการ → ไม่สร้าง)
- ส่งไม่ถึง (ไม่ได้ผูก LINE / โควตาใกล้หมด / LINE error) → **ยังทำเครื่องหมาย ไม่ retry** เพราะวันรุ่งขึ้นคือวันรับแล้ว
  (นับเป็น `skipped` + อยู่ในสรุปของร้าน ให้ร้านโทรตามเองถ้าจำเป็น)
- ส่ง**ทีละราย** (ไม่ `Promise.all`) ให้ตัวนับโควตาใน `lib/lineQuota` หยุดตรง reserve ได้แม่น

#### ตั้งค่าให้รันทุกวัน (ต้องทำตอน deploy — ยังไม่ได้ตั้ง)

แนะนำเวลา **18:00 น. เวลาไทย** (ลูกค้าเห็นตอนเย็นก่อนวันรับ) · เลือกทางใดทางหนึ่ง:

| ทาง | ตั้งค่า |
|---|---|
| **Vercel Cron** (deploy บน Vercel) | ตั้ง env `CRON_SECRET` แล้วเพิ่ม `vercel.json`: `{ "crons": [{ "path": "/api/cron/preorder-reminders", "schedule": "0 11 * * *" }] }` (เวลา UTC = 18:00 ไทย) — Vercel ส่ง `Authorization: Bearer <CRON_SECRET>` ให้เอง |
| **บริการตั้งเวลาภายนอก** (cron-job.org, GitHub Actions ฯลฯ) | ยิง `GET https://<โดเมน>/api/cron/preorder-reminders` พร้อม header `Authorization: Bearer <CRON_SECRET>` วันละครั้ง |
| **เซิร์ฟเวอร์ของเราเอง** (Linux crontab) | `0 18 * * * cd /path/to/app && npm run remind:preorders` (เวลาเครื่องเป็นเวลาไทย) — ไม่ต้องใช้ `CRON_SECRET` |
| **Windows Task Scheduler** | Action: `npm` · Arguments: `run remind:preorders` · Start in: โฟลเดอร์โปรเจกต์ · Trigger: ทุกวัน 18:00 |

ตรวจก่อนตั้งจริง: `npm run remind:preorders -- --dry-run` หรือ `GET /api/cron/preorder-reminders?dry_run=true` →
ได้รายชื่อที่จะเตือนโดยไม่ส่ง ไม่ทำเครื่องหมาย (ลองกับ DB จริงแล้ว 2026-09-30: ทำงานได้ ยังไม่มีพรีออเดอร์ที่รับ 2026-10-01)

#### Response / ผลลัพธ์

```json
{ "pickup_date": "2026-10-02", "dry_run": false, "due": 3, "sent": 2, "skipped": 1, "preorder_nos": ["PRE-…", "PRE-…", "PRE-…"] }
```

#### ความปลอดภัยของ endpoint (`src/lib/cronAuth.ts`)

- ต้องมี `Authorization: Bearer <CRON_SECRET>` · เทียบแบบ constant-time (sha256 แล้ว `timingSafeEqual`)
- **ไม่ตั้ง `CRON_SECRET` = ปิด endpoint** (401 เสมอ) — กันเปิดทิ้งไว้ให้ใครก็ยิงได้
- `src/middleware.ts`: เพิ่ม `/api/cron/` ใน `PUBLIC_PREFIXES` — **ก่อน:** path นี้ไม่ต้องล็อกอินอยู่แล้ว แต่ถ้ามี cookie
  session เสียติดมาจะโดน 401 จาก middleware · **หลัง:** ไม่ยุ่งกับ session เลย สิทธิ์ตรวจจาก `CRON_SECRET` ใน route อย่างเดียว

#### รายไฟล์

| ไฟล์ | ก่อน | หลัง |
|---|---|---|
| `src/services/preorderReminderService.ts` (ใหม่) | — | `sendPickupReminders({ now?, daysBefore?, dryRun? })` · `reminderDaysBefore()` |
| `src/services/customerNotifyService.ts` | — | + `customerMessages.pickupReminder(preorderNo, pickupDate, { orderType, unpaid })` (วันที่ภาษาไทย เวลาไทย) |
| `src/models/preorderModel.ts` | — | + `pickup_reminded_at: Date, default null` |
| `src/lib/cronAuth.ts` (ใหม่) | — | `assertCronAuthorized(req)` |
| `src/app/api/cron/preorder-reminders/route.ts` (ใหม่) | — | `GET` / `POST` · `?dry_run=true` |
| `scripts/send-preorder-reminders.ts` (ใหม่) + `package.json` | — | `npm run remind:preorders [-- --dry-run]` |
| `src/middleware.ts` | `/api/cron/` ไม่อยู่ใน public | อยู่ใน public (ดูหัวข้อความปลอดภัย) |
| `.env.example`, `docs/env.md`, §3 | — | + `CRON_SECRET`, `PREORDER_REMINDER_DAYS_BEFORE` |

#### เทส

- `tests/integration/preorderReminder.test.ts` ใหม่ 6 เคส — เลือกถูกตามช่วงวันไทย (รวมขอบ 00:30 / 23:30) + ข้ามยกเลิก/เสร็จแล้ว/
  รอบยกเลิก · ข้อความรับเอง+ยังไม่จ่าย / จัดส่ง+จ่ายแล้ว · ทำเครื่องหมายรวมตัวที่ส่งไม่ถึง · สรุปร้านไม่ push LINE ·
  รันซ้ำไม่ส่งซ้ำ · **รันพร้อมกัน 2 ตัวได้ข้อความเดียว** · dry run · `daysBefore = 0` · env ค่าผิด
- `tests/lib/cronAuth.test.ts` ใหม่ 3 เคส — ไม่ตั้ง secret = ปิด · ถูก = ผ่าน · ไม่มี/ผิด/ผิดรูปแบบ = 401

ผลรวม: unit 209 ✅ · integration 228 ✅ · typecheck ✅ · `next build` ✅ · lint 0 error (warning 5 จุดเดิม)

---

### 9.8 แก้จุดที่เจอตอนตรวจรอบ 2: หลัง 429 + callback ไม่มี session (2026-09-30)

#### ข้อ 5 — หลัง LINE ตอบ 429 (โควตาหมด) หยุดยิงหาลูกค้าทันที (`src/lib/lineQuota.ts`)

| | ก่อน | หลัง |
|---|---|---|
| หลังได้ 429 ครั้งแรก | cache โควตา (5 นาที) ยังเชื่อว่าเหลือ → ยิงหาลูกค้าต่อทุกราย โดน 429 ทุกครั้ง (เปลือง request + log รก) | `markQuotaExhausted()` ตั้ง cache = เหลือ 0 ทันที → ลูกค้ารายถัดไป**ไม่ถูกยิงเลย** จน cache หมดอายุแล้วถาม LINE ใหม่ |
| 429 จากฝั่งเจ้าของร้าน | ไม่กระทบการส่งหาลูกค้า | ตั้ง cache = 0 เหมือนกัน → ลูกค้าหยุดด้วย (เจ้าของร้านยังพยายามส่งตามปกติ — ไม่ถูกเช็คโควตา) |
| แจ้งในเว็บตอนเหลือ 0 | อาจได้ทั้ง "หมดแล้ว" และ "ใกล้หมด เหลือ 0/…" ซ้อนกัน | เหลือ 0 → ไม่สร้าง "ใกล้หมด" (มี "หมดแล้ว" อยู่แล้ว) |
| **429 แบบ rate limit** (`The API rate limit has been exceeded`) | นับว่าโควตาหมด → แจ้ง "โควตา LINE หมดแล้ว" ผิด ๆ | `isQuotaExceededError` ต้องเป็น 429 **และ** มีข้อความ `monthly limit` — rate limit หายเองในไม่กี่วินาที ไม่ปิดการส่ง ไม่แจ้งเว็บ |

```ts
// ก่อน
export function isQuotaExceededError(error) { return /LINE API 429/.test(error); }
export async function alertQuotaExhausted() { await alertOwnerOnce("โควตา LINE หมดแล้ว", …); }

// หลัง
export function isQuotaExceededError(error) { return /LINE API 429/.test(error) && /monthly limit/i.test(error); }
export async function alertQuotaExhausted() { markQuotaExhausted(); await alertOwnerOnce("โควตา LINE หมดแล้ว", …); }
// canSendToCustomer: remaining === 0 → return false (ไม่แจ้ง "ใกล้หมด" ซ้อน)
```

ขึ้นเดือนใหม่ / อัปเกรดแพ็กเกจ → cache หมดอายุ (≤ 5 นาที) → ถาม LINE ได้โควตาใหม่ → กลับมาส่งเอง ไม่ต้อง restart

#### ข้อ 6 — callback ไม่มี session → พากลับหน้าโปรไฟล์ (callback route + `src/middleware.ts`)

| | ก่อน | หลัง |
|---|---|---|
| ลูกค้าอยู่หน้า LINE นานจน session หมดอายุ / ล็อกอินคนละเบราว์เซอร์ แล้ว LINE redirect กลับ | middleware ตัดตั้งแต่ต้น → เบราว์เซอร์โชว์ JSON ดิบ `{"success":false,"error":{"code":"UNAUTHORIZED"…}}` ค้างที่โดเมน API — ดูเหมือนระบบพัง | redirect ไป `LINE_LINK_RETURN_URL?line=error&reason=login_required` → หน้าโปรไฟล์บอกให้ล็อกอินใหม่ได้ |
| cookie session เสีย (ลายเซ็นผิด/หมดอายุ) | middleware ตอบ `SESSION_INVALID` 401 | เหมือนไม่มี session → `login_required` |
| ตรวจสิทธิ์ | `withAuth` (โยน 401) | `route()` + `getSession()` เอง — ไม่มี session → `finish("error", "login_required")` · มี session → ตรวจ `state` ตรงกับ user เหมือนเดิม |

**middleware — ทำไมต้องแก้ด้วย:** `/api/shop/*` ถูก middleware บังคับล็อกอิน (ตอบ JSON 401) **ก่อน**ถึง route เลย แก้แค่ route ไม่พอ
- เพิ่ม `SELF_AUTH_PATHS = new Set(["/api/shop/me/line/callback"])` — **ตรงตัว** ไม่ใช่ prefix (path อื่นใต้ `/api/shop` ยังต้องล็อกอินเหมือนเดิม
  รวม `/api/shop/me/line` และ `/api/shop/me/line/callback/extra`)
- path นี้: ไม่ตัด 401 เมื่อไม่มี user · cookie เสียไม่ตัด `SESSION_INVALID` · **ยังแนบ `x-mmc-user` ตามปกติ**ถ้า cookie ถูกต้อง (route ใช้ตรวจ state)
- ความปลอดภัยไม่ลดลง: route ยังต้องมี session **และ** `state` (JWT ผูก user_id อายุ 10 นาที) ตรงกับ session ถึงจะผูก LINE ได้

**API ที่เปลี่ยน (frontend):** เพิ่ม `reason=login_required` คู่กับ `line=error` (§5) — เพิ่มแบบไม่ทำให้โค้ดเดิมพัง: frontend ที่อ่านแค่ `line`
ยังแสดง "เชื่อมต่อไม่สำเร็จ" ได้เหมือนเดิม · ไม่ตั้ง `LINE_LINK_RETURN_URL` → JSON `{ line: "error", reason: "login_required" }` (400)

#### เทส

- `tests/integration/lineQuota.test.ts` +3 เคส (รวม 12) — 429 โควตาหมด: ลูกค้ารายที่ 2 ไม่ถูกยิง, แจ้ง "หมดแล้ว" 1 ครั้ง ไม่มี "ใกล้หมด",
  cache = 0 · 429 ฝั่งร้าน → ลูกค้าหยุดด้วย · 429 rate limit → ยังส่งต่อ ไม่แจ้งเว็บ cache ไม่เปลี่ยน
- `tests/lib/lineCallback.test.ts` ใหม่ 7 เคส — callback: ไม่มี session → redirect `login_required` · กดยกเลิก → `cancelled` ·
  state ไม่ตรง → `error` ไม่มี reason · ไม่ตั้ง return URL → JSON 400 · middleware: callback ไม่มี cookie / cookie เสีย → ผ่านถึง route ·
  `/api/shop/me/line`, `/api/shop/me`, `/api/shop/me/line/callback/extra` ยังได้ 401

ผลรวม: unit 216 ✅ · integration 231 ✅ · typecheck ✅ · `next build` ✅ · lint 0 error (warning 5 จุดเดิม)

---

### 9.9 เอกสาร: สรุปงานที่เหลือหลังตรวจรอบ 3 (2026-09-30)

ตรวจรอบ 3 (CI `cbf6864` ผ่าน · diff ทั้ง PR ไม่มี `TODO` / `FIXME` / `debugger` / `as any` หลงเหลือ) — **ไม่มีจุดในโค้ดที่ต้องแก้**
แก้เฉพาะเอกสาร §8:

| | ก่อน | หลัง |
|---|---|---|
| โครง §8 | รายการเลข 1–7 ปน ✅ กับงานค้าง | 8.1 ตารางสถานะ · 8.2 checklist frontend · 8.3 checklist deploy |
| ออเดอร์จาก `POST /api/admin/orders` เป็น POS โดยค่าเริ่มต้น | ไม่ได้บันทึก — คนดูแลต่ออาจคิดว่าบั๊ก | 8.1 ข้อ 8: ตั้งใจ + ผลที่เกิด + วิธีเปลี่ยน (`channel: "online"`) |
| ข้อความถึงลูกค้าไม่บันทึก DB | ไม่ได้บันทึก | 8.1 ข้อ 9: ข้อจำกัด + ดูจาก log `customer_notify.*` |
| ลูกค้าบล็อก OA หลังผูก | อยู่แค่ในหมายเหตุ §5 | 8.1 ข้อ 10 |
| งาน frontend | "ปุ่มเชื่อม LINE" บรรทัดเดียว | 8.2 ครบ 4 หมวด: ก. เชื่อม LINE (รวม `reason=login_required`) · ข. `low_stock_threshold` + API low-stock · ค. หน้าแจ้งเตือน (`link: null`, หัวข้อใหม่) · ง. คำถามที่ต้องตอบ backend |
| งาน deploy | กระจายอยู่ §4 / §7 / §9.7 | 8.3 checklist ที่เดียว |

### 9.10 หมวดแจ้งเตือน (module) แสดงเป็นภาษาไทย (2026-10-01)

ค่า `module` เก็บใน DB เป็นภาษาอังกฤษเหมือนเดิม (enum ของ `notificationModel` + ใช้กรอง `?module=`) — แปลงเป็นภาษาไทย **ตอนแสดงผล** เท่านั้น

| | ก่อน | หลัง |
|---|---|---|
| ค่าใน DB | `order` / `ingredient` / `production` / `employee` / `finance` / `system` | เหมือนเดิม (ห้ามเก็บภาษาไทย — enum ไม่รับ บันทึกแจ้งเตือนไม่ได้) · **เลิกใช้ `employee`** (ไม่มีจุดไหนสร้าง — ลบจาก enum/type · เอกสารเก่า 1 รายการใน DB จริงยังอ่าน/ทำเครื่องหมายอ่านได้ แสดงป้าย "พนักงาน") |
| response `/api/admin/notifications` (list / getById / แก้ / ลบ / กู้คืน) และผลของ `notify()` | มีแค่ `module` | เพิ่ม **`module_label`**: คำสั่งซื้อ / วัตถุดิบ / การผลิต / การเงิน / อื่น ๆ (+ พนักงาน เฉพาะเอกสารเก่า) |
| หัวข้อความ LINE ถึงเจ้าของร้าน | `[order] พรีออเดอร์ใหม่ …` | `[คำสั่งซื้อ] พรีออเดอร์ใหม่ …` |
| กรอง `?module=` | ต้องส่ง key อังกฤษ | ส่งได้ทั้ง `order` และ `คำสั่งซื้อ` |

โค้ด: `NOTIFICATION_MODULE_LABELS` / `notificationModuleLabel()` / `parseNotificationModule()` ใน `src/services/notificationService.ts` ·
เทส `notificationModuleLabel.test.ts` 4 เคส · **frontend:** แสดง `module_label` แทน `module` (ไม่ต้องมีตารางแปลเอง)

### 9.11 ปรับถ้อยคำหัวข้อแจ้งเตือนเจ้าของร้าน (2026-10-01)

แก้เฉพาะข้อความ (title/message) — เงื่อนไขการแจ้ง/module/type/link เหมือนเดิม · frontend ที่ค้นหรือกรองด้วยข้อความหัวข้อต้องปรับตาม

| เหตุการณ์ | ก่อน | หลัง | ที่มา |
|---|---|---|---|
| พรีออเดอร์ใหม่ | `พรีออเดอร์ใหม่ PRE-…` | `เปิดพรีออเดอร์รอบใหม่ PRE-…` | `preorderService.createPreorder` |
| สรุปวันรับพรีออเดอร์ (เว็บอย่างเดียว) | `พรีออเดอร์ถึงวันรับ YYYY-MM-DD: N รายการ` · `เตือนลูกค้าทาง LINE แล้ว N ราย · ส่งไม่ถึง M ราย (… / โควตาใกล้หมด)` | `เปิดรับพรีออเดอร์ถึงวันรับ YYYY-MM-DD: N รายการ` · `เตือนลูกค้าทาง LINE แล้ว จำนวน N ราย · ส่งไม่ถึงจำนวน M ราย (… / โควตาการส่งแจ้งเตือนใกล้หมด)` | `preorderReminderService` |
| สลิปรอตรวจ | `มีสลิปโอนเงินรอตรวจสอบ` | `มีคำสั่งซื้อรอตรวจสอบสลิปโอนเงิน รหัสคำสั่งซื้อ <order_no/preorder_no>` เช่น `ORD-20261001-AB12CD` / `PRE-…` | `paymentService.submitSlip` (หาเลขด้วย `paymentDocNo()` หลังตอบลูกค้าแล้ว · หาไม่เจอ = ObjectId) |
| สินค้าใกล้หมด | `สินค้าใกล้หมด: <ชื่อ>` | `สินค้าใกล้จะหมด: <ชื่อ>` | `productService` |
| วัตถุดิบใกล้หมด | `วัตถุดิบใกล้หมด: <ชื่อ>` | `วัตถุดิบใกล้จะหมด: <ชื่อ>` | `ingredientTransactionService` |
| จ่ายช้าหลังสร้างใบผลิต | `เพิ่มยอดเข้าใบสั่งผลิต PO-…` | `เพิ่มยอดสินค้าเข้าใบสั่งผลิต PO-…` | `preorderRoundLifecycleService.onPreorderPaid` |
| ยกเลิกพรีออเดอร์ที่นับเข้าใบผลิต | `ลดยอดใบสั่งผลิต PO-…` | `หักยอดสินค้าในใบสั่งผลิต PO-…` | `preorderRoundLifecycleService.onPreorderCancelled` |

เทสปรับตาม: `ownerLineNotify.test.ts` · `preorderReminder.test.ts` · ใหม่ `slipNotification.test.ts` 2 เคส (ออเดอร์/พรีออเดอร์แสดงเลขเอกสาร ไม่ใช่ ObjectId)

✅ หัวข้อสลิปรอตรวจ: เดิม (รุ่นแรกของถ้อยคำใหม่) แสดง ObjectId 24 ตัวอักษร → แก้ให้แสดงเลขออเดอร์/พรีออเดอร์แล้ว

### 9.12 แนบลิงก์เข้าเว็บหลังร้านท้ายข้อความ LINE (2026-10-02)

ตัดสินใจ 2026-10-02: **แนบลิงก์ให้กดเข้าเว็บไปแก้สถานะ** (ไม่ทำปุ่มเปลี่ยนสถานะในแชต LINE — ต้องมี webhook + ผูกสิทธิ์พนักงาน
และเสี่ยงยืนยันสลิปโดยไม่เห็นรูป) · ไม่เพิ่มแจ้งเตือนออเดอร์ค้างจ่าย (แจ้ง "ออเดอร์ใหม่" ตอนสั่ง + "สลิปรอตรวจ" ตอนแนบ พอแล้ว)

| | ก่อน | หลัง |
|---|---|---|
| ข้อความ LINE ถึงเจ้าของร้าน | `[คำสั่งซื้อ] ออเดอร์ใหม่ ORD-…` + รายละเอียด — ต้องไปหาออเดอร์เองในเว็บ | ต่อท้าย `🔗 https://<ADMIN_APP_URL>/owner/orders/manageOrders?id=…` กดแล้วเปิดหน้านั้นเลย |
| แจ้งเตือนที่มีลิงก์ | ออเดอร์ใหม่ · สลิปรอตรวจ (ออเดอร์) → หน้าออเดอร์ · สินค้าใกล้หมด / ผลิตเสร็จสินค้ามีตัวเลือก / ข้อมูลผิดปกติ → `/owner/products` · วัตถุดิบใกล้หมด → `/owner/ingredients` | เหมือนเดิม — แค่แนบลิงก์เต็มไปกับ LINE ด้วย |
| แจ้งเตือนพรีออเดอร์ / สลิปของพรีออเดอร์ / ใบผลิต / สรุปวันรับ | `link: null` | ยังไม่มีลิงก์ — รอ frontend บอก path หน้าจัดการพรีออเดอร์ (§8.2 ง.) |
| env | — | `ADMIN_APP_URL` (ไม่ตั้ง = ไม่แนบลิงก์ ข้อความเหมือนเดิม) |

- โค้ด: `notificationLineUrl()` ใน `src/services/notificationService.ts` — path ต่อกับ `ADMIN_APP_URL` · link ที่เป็น `http(s)` อยู่แล้วใช้ตรง ๆ · ค่าผิดรูป = ไม่แนบ
- ลิงก์มีแค่ id — หน้าเว็บยังต้องล็อกอิน (เปิดใน browser ของ LINE ครั้งแรกอาจต้องล็อกอินใหม่ เพราะ cookie แยกจาก browser ปกติ)
- **frontend:** path `/owner/orders/manageOrders?id=<orderId>` ต้องเปิดออเดอร์นั้นได้ตรง ๆ (ถ้า path จริงต่างไป บอก backend ให้แก้ `link`)
- เทส `notificationModuleLabel.test.ts` +2 เคส (แนบเมื่อตั้ง env · ไม่แนบเมื่อไม่ตั้ง/ไม่มี link)
