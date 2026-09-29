# การแจ้งเตือนผ่าน LINE — เจ้าของร้าน + ลูกค้า

> อัปเดตล่าสุด: 2026-09-30 · branch `feat/line-customer-notify`
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
| สลิปรอตรวจ | ลูกค้าแนบ/แก้สลิป | `paymentService.submitSlip` |
| สินค้าใกล้หมด | สต็อกเพิ่งข้ามจาก > 5 ลงมา ≤ 5 (`LOW_STOCK_THRESHOLD`) ตอนตัดสต็อกจากออเดอร์ | `productService.deductStockForOrder` |
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
| หน้า LINE Login ขึ้น `Invalid redirect_uri value` | Callback URL ไม่ได้ลงทะเบียน / ไม่ตรงทุกตัวอักษร / **Channel ID เป็นของ channel อื่น** | เช็ค Channel ID ใน `.env.local` ตรงกับ LINE Login channel ที่ใส่ Callback URL · กด Update แล้ว · ไม่มี `/` ท้าย |
| `authorize_url` เป็น `null` | ยังตั้ง `LINE_LOGIN_*` ไม่ครบ | ข้อ 3 แล้ว restart dev server |
| ผูกแล้วแต่ลูกค้าไม่ได้ข้อความ | ไม่ได้เป็นเพื่อน OA / LINE Login channel อยู่คนละ Provider กับ OA | ให้ลูกค้าเพิ่มเพื่อน OA · ตั้ง Linked OA · ย้าย channel ให้อยู่ Provider เดียวกัน |
| ร้านไม่ได้ข้อความ แต่ในเว็บมีแจ้งเตือน | push ล้มเหลว | ดู `line_error` ใน notification นั้น (`/api/admin/notifications`) |

---

## 7. สถานะการทดสอบ (2026-09-30)

| รายการ | ผล |
|---|---|
| token ของ Messaging API (`GET /v2/bot/info`) | ✅ 200 — OA "MeowMeeCake" |
| push ข้อความทดสอบหาเจ้าของร้าน (`LINE_TARGET_ID`) | ✅ ส่งสำเร็จ |
| env `LINE_LOGIN_*` ครบ | ✅ |
| หน้า authorize ของ LINE Login | ❌ 400 `Invalid redirect_uri value` — ใส่ Callback URL แล้วยังไม่ผ่าน · ต้องเช็ค Channel ID ใน `.env.local` ว่าตรงกับ LINE Login channel ที่ลงทะเบียน Callback URL (ข้อ 6) |
| ผูกบัญชีจริงแบบ end-to-end (ลูกค้ากดยินยอม) | ⏳ รอแก้ข้อบน · ต้องทดสอบด้วยมือผ่านเบราว์เซอร์ |

เทสอัตโนมัติ: `tests/lib/line.test.ts` · `tests/lib/lineLogin.test.ts` · `tests/integration/customerLineNotify.test.ts`

---

## 8. ยังไม่ทำ / ช่องโหว่ที่รู้แล้ว

1. **พรีออเดอร์ใหม่ไม่แจ้งเจ้าของร้าน** — แจ้งแค่ลูกค้า
2. **สินค้าใกล้หมดแจ้งเฉพาะตอนขาย** — ปรับสต็อกเองผ่าน `productService.setStock` / `adjustStock` (นับสต็อก/ตัดของเสีย) ไม่แจ้ง
3. **เกณฑ์สินค้าใกล้หมดตายตัว 5 ชิ้นทุกสินค้า** — ไม่มีฟิลด์เกณฑ์รายสินค้าแบบ `reorder_point` ของวัตถุดิบ
4. **ออเดอร์ POS แจ้งเจ้าของร้านทุกออเดอร์** — ร้านขายหน้าร้านเยอะอาจ spam
5. **เตือนลูกค้าก่อนวันรับพรีออเดอร์** — ต้องมี scheduled job (cron) ซึ่งโปรเจกต์ยังไม่มี
6. **ปุ่ม "เชื่อม LINE" ฝั่ง frontend** — อยู่ใน repo frontend (แยกจาก repo นี้) ใช้ API ข้อ 5
