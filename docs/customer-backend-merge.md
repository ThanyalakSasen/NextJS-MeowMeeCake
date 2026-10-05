# รวม backend ฝั่งลูกค้าเข้ากับ backend หลัก — ผลวิเคราะห์ (2026-10-04)

> ตรวจ: 2026-10-04 · อ่านอย่างเดียว (ไม่ได้แก้ไฟล์ · ไม่ได้อ่านค่าใน `.env`)
> backend หลัก: `D:\1.2569\MeowMeeCake\NextJS-MeowMeeCake` (branch `fix/backlog4-y7-y11`)
> ฝั่งลูกค้า: `C:\Users\KimThanyalak\Downloads\backend\backend` (ไม่ใช่ git repo — ได้มาเป็นโฟลเดอร์ดาวน์โหลด)
> เกี่ยวข้อง: [`BACKLOG4.md`](BACKLOG4.md) R7 / §8.3 · [`money-units.md`](money-units.md)

## สรุป

**รวมได้ แต่เป็นงานใหญ่** — "ฝั่งลูกค้า" ไม่ใช่หน้าเว็บ แต่เป็น **backend ตัวที่ 2 ที่ต่อ MongoDB ตัวเดียวกัน** (321 ไฟล์ · model ~50 ·
controller ~70 · ไม่มีหน้าเว็บสักหน้า) มีทั้ง API ลูกค้า (`/api/customer/*` ~60 route) **และ** API เจ้าของร้าน (`/api/owner/*`) ซ้อนกับของหลัก
→ การรวม = รวม backend 2 ตัว ไม่ใช่ย้ายหน้าเว็บ · หน้าเว็บที่ลูกค้าใช้จริงน่าจะเป็นอีกโปรเจกต์ที่เรียกพอร์ต 4000 ตัวนี้

ตัวนี้คือที่มาของ "FrontOffice เขียน DB ตรง" ใน R7 (เลขออเดอร์ `ORD-<timestamp>` · เงินเป็นบาท · ไม่มี userlog ของหลัก)

## 1. เทียบ 2 backend

| เรื่อง | backend หลัก | ฝั่งลูกค้า |
|---|---|---|
| framework | Next 15.5 (App Router) · API + หลังร้าน frontend แยก repo | Next 16.2.6 · API ล้วน · `next dev -p 4000` |
| โครงโค้ด | `src/services/*` + route handler | `src/controllers/{Customer,Owner}/*` + `src/lib/*` (createCrudController) |
| API | `/api/admin/*` · `/api/shop/*` · `/api/catalog/*` · `/api/cron/*` | `/api/customer/*` · `/api/owner/*` · `/api/{products,orders,...}` ทั่วไป |
| ล็อกอิน | JWT cookie ของตัวเอง (`src/lib/session.ts`) · Google | **next-auth** (`/api/auth/[...nextauth]`) · ยืนยันอีเมล / ลืมรหัสผ่าน (nodemailer) |
| เลขออเดอร์ | `ORD-YYYYMMDD-xxxxxx` · `POS-` · `PRE-` | `ORD-<timestamp>-xxxx` · `PRE-<timestamp>-xxxx` (`checkoutController.ts:76`, `preorderController.ts:70`) |
| หน่วยเงิน | บาท (หลัง PR #57) | บาท |
| ประเภทสินค้า | `is_preorder` (boolean) | **`product_type`** แบบเก่า ("ready" / "preorder") |
| ผูก LINE ลูกค้า | `users.line_user_id` | `users.lineId` |
| ค่าส่ง | `DeliveryZones` | `ShippingZones` (+ จุดรับสินค้า / ตลาดนัดรายสัปดาห์) |
| dependencies เด่น | mongoose 9 · zod · LINE Messaging/Login | mongoose 9 · next-auth 4 · nodemailer 7 · promptpay-qr · qrcode |

## 2. 🔴 จุดที่ขัดกันตอนนี้ (กระทบข้อมูลจริงแล้ว)

| # | เรื่อง | ผล |
|---|---|---|
| 1 | **`product_type` กับ `is_preorder`** — DB จริงย้ายเป็น `is_preorder` แล้ว (2026-10-01, R2) แต่ฝั่งลูกค้ายังกรอง `product_type: { $ne: "preorder" }` (`cartItemController.ts:100`, `checkoutController.ts:158`, `posCheckoutController.ts:128`) | สินค้าพรีออเดอร์ถูกมองเป็นสินค้าปกติ → ใส่ตะกร้า/ขายได้ |
| 2 | ตอนปิดรอบ `preorderRoundController.ts:207-208` เขียน **`{ product_type: "ready", product_stock_quantity: 0 }`** กลับลง DB | ฟิลด์เก่ากลับมา (ตัวตรวจ Y11 แจ้ง `legacy_fields`) · **สต็อกถูกตั้งเป็น 0** |
| 3 | ผูก LINE คนละฟิลด์ (`lineId` / `line_user_id`) | ลูกค้าผูกฝั่งหนึ่ง อีกฝั่งไม่เห็น → แจ้งเตือนลูกค้าของหลักไม่ถึง |
| 4 | ค่าส่งคนละระบบ (`ShippingZones` / `DeliveryZones`) | ค่าส่งของออเดอร์จาก 2 ทางคิดคนละตาราง |
| 5 | ตัดสต็อก · แจ้งเตือน · กฎพรีออเดอร์ (กำหนดชำระ #55 · ใบผลิตอัตโนมัติ · ลดใบผลิตเมื่อยกเลิก) คนละชุด | ออเดอร์จากฝั่งลูกค้าไม่เข้ากฎของหลัก (ไม่มี LINE ถึงร้าน · ไม่มี `payment_due_at` · ไม่บวก/ลดใบผลิต) |
| 6 | เลขออเดอร์ `ORD-<timestamp>` · รุ่นเก่า `WEB-<timestamp>` | ✏️ แก้ข้อมูล 2026-10-05: `ORD-<timestamp>` นับเป็น "เว็บ" อยู่แล้ว (ขึ้นต้น `ORD-`) · `WEB-<timestamp>` รุ่นเก่ายังเป็น "อื่น ๆ" (ผู้ใช้เลือกให้เว็บ = `ORD-` เท่านั้น — §8.6) |

## 3. เทียบ model (collection เดียวกันใน MongoDB)

**เฉพาะหลัก:** `Attendances` · `DeliveryZones`
**เฉพาะฝั่งลูกค้า:** `Bundles` · `CustomerNotifications` · `Interactions` · `PointTransactions` · `ProductVariantGroups` · `ReviewPresets` ·
`SearchSynonyms` · `ShippingZones` · `StoreProfile` · `StoreSettings` · `TemporaryPermissions` · `UserCoupons`

**มีทั้งสองฝั่ง — field ต่างกัน** (field ตรงกัน: Addresses · Carts · ComponentCategory · Components · Expenses · IngredientCategory ·
Ingredients · Permissions · PreorderRoundItems · ProductionOrders · PromotionUsages · Recipes · Roles · SentimentResults · Units · UserLogs)

| model | มีเฉพาะหลัก | มีเฉพาะฝั่งลูกค้า |
|---|---|---|
| Products | `product_id` · `purchase_cost` · `is_preorder` · `low_stock_threshold` | `product_type` |
| Orders | — | `bundle_id` · `bundle_lines` · `point_id/point_name` · `pickup_date/pickup_point` · `address` · `note` · `stock_deducted/stock_restored` · `points_redeemed/points_discount` · `user_coupon_id` ฯลฯ |
| OrderItems / CartItems / PreorderItems | — | `group_name` · `variant_price` · `selected_variants` · `bundle_id` · `customization_key` (+ option ใน PreorderItems) |
| Preorders | `pickup_reminded_at` · `payment_due_at` · `added_to_production_at` · `removed_from_production_at` | `point_id/point_name` · `pickup_point` · `points_*` · `user_coupon_id` ฯลฯ |
| Users | `line_user_id` | `lineId` · `refund_promptpay_id/name` · `password_changed_at` |
| Promotions | `applicable_products` · `applicable_categories` · `min_quantity` | `points_cost` · `customer_notified_at` |
| Reviews | — | `video` · `aspect_feedback` · `status` · `is_pinned` · `shop_reply` · `internal_tags/note` · `read_at/by` |
| ProductVariants / ProductOptions | — | `group_id` · `display_order` |
| อื่น ๆ | Notifications `line_sent/line_error` · ProductionItems `product_stock_added_*` · IngredientTransactions `production_item_id` · Banners `banner_description` | ProductCategories `ships_nationwide` · PreorderRounds `customer_notified_at` · Aspects `is_active/display_order/icon/placeholder_text` · SemanticTerms `kind` |

## 4. ฟีเจอร์ที่มีเฉพาะฝั่งลูกค้า (ต้องย้ายถ้ารวม)

> รายละเอียดระดับ route + ตารางเทียบ → [§7](#7-เทียบระดับ-api--ฝั่งลูกค้ามีแต่หลักไม่มี-ตรวจ-2026-10-05)

ชุดสินค้า (bundles) · แต้มสะสม (points + แชร์แต้ม) · คูปองส่วนตัว (`UserCoupons`) · รายการโปรด · จุดรับสินค้า / ตลาดนัดรายสัปดาห์ ·
payment link · แนะนำสินค้า + ตรวจสารก่อภูมิแพ้ · คำค้นหาเทียบเคียง (search synonyms) · ตั้งค่า/ข้อมูลร้าน (store settings/profile/logo/map) ·
แจ้งเตือนถึงลูกค้าในเว็บ (`CustomerNotifications`) · จัดการรีวิว (ปักหมุด · ตอบกลับ · preset · analytics) · ตัวเลือกสินค้าแบบกลุ่ม
(`ProductVariantGroups` · product customization) · ยืนยันอีเมล / ลืมรหัสผ่าน · ติดต่อร้าน · สิทธิ์ชั่วคราว (`TemporaryPermissions`) · QR พร้อมเพย์

## 5. แนวทางที่แนะนำ (เป็นขั้น)

| ขั้น | ทำอะไร | ผล |
|---|---|---|
| **0 (ด่วน)** | ฝั่งลูกค้า: `product_type` → `is_preorder` (กรองตะกร้า/checkout/POS) · เลิกเขียน `product_type`/ตั้งสต็อก 0 ตอนปิดรอบ | หยุดข้อมูลเพี้ยนทันที — แก้ไม่กี่จุด |
| 1 | ขยาย model ของหลักให้มีฟิลด์ฝั่งลูกค้า (bundle · points · pickup · variant groups · review moderation ฯลฯ) · เลือกฟิลด์ผูก LINE ตัวเดียว (+ ย้ายข้อมูล) · เลือกระบบค่าส่งชุดเดียว | schema เดียวกันทั้ง DB |
| 2 | ย้าย `/api/customer/*` เข้า backend หลัก **path เดิม** (หน้าเว็บลูกค้าไม่ต้องแก้) — เรียก service ของหลัก (สต็อก · เงิน · เลขออเดอร์ · แจ้งเตือน LINE · กำหนดชำระ · ใบผลิต) · ฟีเจอร์เฉพาะฝั่งลูกค้าย้ายตามทีละกลุ่ม | กฎธุรกิจชุดเดียว |
| 3 | ล็อกอินลูกค้าจาก next-auth → ระบบของหลัก (มี Google อยู่แล้ว · เพิ่มยืนยันอีเมล/ลืมรหัสผ่าน) · ปิด backend พอร์ต 4000 | เหลือ backend ตัวเดียว |
| — | `/api/owner/*` ของฝั่งลูกค้า **ไม่ต้องย้าย** — หลังร้านใช้ `/api/admin/*` ของหลักอยู่แล้ว · ย้ายเฉพาะฟีเจอร์ที่หลักยังไม่มี (รีวิว moderation · ตั้งค่าร้าน · จุดรับสินค้า) | — |

## 6. ต้องตอบก่อนเริ่ม

1. **หน้าเว็บลูกค้า (ตัวที่เรียกพอร์ต 4000) อยู่ที่ path ไหน** — ต้องดูว่าเรียก API ไหนบ้าง
2. ฝั่งลูกค้ายังมีทีมพัฒนาต่อไหม · โค้ดที่ส่งมา (`Downloads`, ไม่มี git) ตรงกับตัวที่รันจริงหรือเปล่า
3. เริ่ม**ขั้น 0** เลยไหม (แก้ในโปรเจกต์ฝั่งลูกค้า)
4. ฟิลด์ผูก LINE (`lineId` / `line_user_id`) และระบบค่าส่ง (`ShippingZones` / `DeliveryZones`) จะใช้ตัวไหนเป็นหลัก

---

## 7. เทียบระดับ API — ฝั่งลูกค้ามีแต่หลักไม่มี (ตรวจ 2026-10-05)

> ฝั่งลูกค้า 138 route · หลัก 168 route · เทียบ route + model + `src/lib/*` (อ่านอย่างเดียว) · ละเอียดกว่า §4

### 7.1 ❌ ไม่มีในหลักเลย (ต้องย้ายถ้ารวม)

| # | ฟีเจอร์ | route ฝั่งลูกค้า | หมายเหตุ |
|---|---|---|---|
| 1 | ~~ชุดสินค้า (bundle)~~ — **ไม่ย้าย** ร้านเลิกใช้แล้ว (§8.13) | `/bundles` · `/customer/bundles` | ออเดอร์มี `bundle_id` · `bundle_lines` |
| 2 | แต้มสะสม + แชร์แต้ม | `/customer/points` · `/points/share` | model `PointTransactions` · ออเดอร์ `points_redeemed/discount` |
| 3 | คูปองส่วนตัว (ดู/เช็ค/แลก) | `/customer/coupons` · `/check` · `/redeem` | model `UserCoupons` · โปรโมชัน `points_cost` (แลกด้วยแต้ม) |
| 4 | ✅ รายการโปรด — **ย้ายแล้ว (§8.14)** | `/customer/favorites` | |
| 5 | จุดรับสินค้า / ตลาดนัดรายสัปดาห์ | `/customer/pickup-locations` · `/weekly-markets` | ออเดอร์ `pickup_point` · `pickup_date` |
| 6 | payment link | `/customer/payment-link` · `/redeem` | |
| 7 | QR พร้อมเพย์ให้ลูกค้าจ่าย | `/customer/orders/[id]/payment` | ไลบรารี `promptpay-qr` · หลักมีแค่ `promptpay_ref` |
| 8 | ✅ แนะนำสินค้า / สินค้าคล้ายกัน / ตรวจสารก่อภูมิแพ้ — **ย้ายแล้ว (§8.15)** | `/customer/recommendations` · `/similar/[id]` · `/products/recommended` · `/customer/ingredients` | model `Interactions` |
| 9 | ✅ คำค้นหาเทียบเคียง — **ย้ายแล้ว (§8.16)** | `/customer/search-synonyms` · `/owner/search-synonyms` | |
| 10 | ข้อมูล/ตั้งค่าร้าน (โลโก้ · แผนที่) | `/owner/store-profile` · `/store-settings` · `/map-link` · `/customer/store-info` · `/store-logo` | |
| 11 | แจ้งเตือนถึงลูกค้าในเว็บ | `/customer/notifications` | หลักแจ้งลูกค้าทาง LINE อย่างเดียว |
| 12 | ติดต่อร้าน (อีเมล) | `/customer/contact` | nodemailer |
| 13 | ยืนยันอีเมล / ลืมรหัสผ่าน / ตั้งรหัสใหม่ | `/user/verify-email` · `/auth/forgot-password` · `/auth/reset-password` | หลักมี field ใน user model แต่ไม่มี route |
| 14 | จัดการรีวิวขั้นสูง | `/owner/reviews` (+ `bulk` · `analytics` · `dashboard` · `filter-options` · `products/[id]`) · `/owner/review-presets` | ตอบกลับ · ปักหมุด · สถานะ · แท็ก/โน้ตภายใน · อ่านแล้ว — หลักมีแค่ซ่อน + sentiment |
| 15 | อัปโหลดรูป/วิดีโอในรีวิว | `/customer/reviews/upload` | |
| 16 | หมวดรีวิว (aspect) แบบเต็ม | `/owner/aspects/reorder` | เรียงลำดับ · เปิด/ปิด · ไอคอน |
| 17 | ✅ ตัวเลือกสินค้าแบบกลุ่ม — **ย้ายแล้ว (§8.3 ขั้น 1)** | `/owner/products/[id]/customization` | `ProductVariantGroups` (เช่นเลือกครีมชีส/มะยงชิด) · เลิก Y9 แล้ว |
| 18 | แจ้งลูกค้าเมื่อเปิดรอบ/มีโปรใหม่ | (`customerBroadcast`) | `customer_notified_at` ของรอบ/โปรโมชัน |
| 19 | dashboard รอบพรีออเดอร์ + รายชื่อลูกค้าในรอบ | `/owner/preorder-rounds/dashboard` · `/[id]/customers` | หลักกรองพรีออเดอร์ตามรอบได้ แต่ไม่มีหน้าสรุป |
| 20 | ยกเลิกออเดอร์ทั่วไปที่ไม่จ่ายอัตโนมัติ + นโยบายยกเลิกของลูกค้า | (`orderExpiry` · `cancelPolicy`) | หลักมีกำหนดชำระเฉพาะพรีออเดอร์ |
| 21 | ข้อมูลคืนเงินพร้อมเพย์ของลูกค้า | (field user) | `refund_promptpay_id/name` |
| 22 | หมวดสินค้าส่งทั่วประเทศ | (field หมวด) | `ships_nationwide` |

### 7.2 ⚠️ มีในหลัก แต่ออกแบบต่างกัน (ต้องเลือกมาตรฐาน)

| เรื่อง | ฝั่งลูกค้า | หลัก |
|---|---|---|
| ค่าส่ง | `ShippingZones` | `DeliveryZones` + `/admin/delivery-fee` |
| ล็อกอิน | next-auth | JWT cookie + Google |
| ผูก LINE | `/line/connect` · `/callback` · `lineId` | `/shop/me/line` · `line_user_id` |
| ขายหน้าร้าน | เรียกครั้งเดียว `/owner/pos-checkout` | สร้างออเดอร์ → ชำระเงิน → ยืนยัน (หลายครั้ง) |
| สิทธิ์ชั่วคราว | `/permissions/temporary` | `expires_at` บน permission |
| รายงานยอดขาย | `/reports/sales` | `/admin/dashboard/*` |

### 7.3 ✅ มีเทียบเท่ากันแล้ว

สมัคร/ล็อกอิน · ที่อยู่ · ตะกร้า · สั่งซื้อ · พรีออเดอร์ + รอบ · ชำระเงิน/สลิป · แคตตาล็อก/หมวด/รายละเอียดสินค้า/รีวิว · แบนเนอร์ ·
ตรวจโค้ดโปรโมชัน · แจ้งเตือนเจ้าของร้าน · ฝั่งเจ้าของร้านทั้งหมด (สินค้า · หมวด · วัตถุดิบ · สูตร · ส่วนประกอบ · การผลิต · ค่าใช้จ่าย ·
โปรโมชัน · ผู้ใช้ · role · สิทธิ์ · userlog · หน่วย · aspect · คำวิเคราะห์รีวิว)

### 7.4 หลักมี แต่ฝั่งลูกค้าไม่มี (ประกอบการตัดสินใจ)

กำหนดชำระพรีออเดอร์ + ยกเลิกอัตโนมัติ · สร้างใบผลิตอัตโนมัติตอนปิดรอบ · เพิ่มสต็อกเมื่อผลิตเสร็จ · แจ้งเตือน LINE ถึงร้าน (+ ลิงก์ 🔗) ·
สรุปยอดรายเดือน · ตรวจข้อมูลผิดปกติรายวัน · ลงเวลาทำงาน · สลิปเป็นไฟล์ส่วนตัว (#54) · สถานะจัดส่ง/เลขพัสดุ · dashboard แยกช่องทาง

---

## 8. เริ่มรวม (2026-10-05)

### 8.1 ข้อตกลงจุดที่ทับกัน (ผู้ใช้ตอบแล้ว)

| เรื่อง | ตัดสินใจ | ผล |
|---|---|---|
| path API ลูกค้า | ใช้ **`/api/shop/*` ของหลัก** | หน้าเว็บลูกค้าต้องเปลี่ยน path ที่เรียก (ไม่ใช่ `/api/customer/*` เดิม) |
| ล็อกอิน | **เก็บทั้งสองไว้** (next-auth ของฝั่งลูกค้า + JWT ของหลัก) | ต้องให้ route `/api/shop/*` รู้จัก session ของ next-auth ด้วย (ขั้น 3) |
| ตัวเลือกสินค้า | **กลุ่มตัวเลือกบวกราคา ไม่นับสต็อก** (แบบฝั่งลูกค้า) | เลิก Y9 (สต็อกต่อตัวเลือก) — ✅ ทำแล้ว §8.3 |
| ผูก LINE ลูกค้า | **`line_user_id`** + ย้ายค่า `lineId` เดิมมา | ไม่กระทบฝั่งเจ้าของร้าน (แจ้งเตือนร้านใช้ `LINE_TARGET_ID` · `/profile` + `/api/shop/me/line` ใช้ `line_user_id` อยู่แล้ว) · สคริปต์ย้าย = dry-run · ผู้ใช้รัน `--apply` เอง |
| ค่าส่ง | **เก็บทั้งสอง** — ออเดอร์จากหน้าเว็บลูกค้าใช้ `ShippingZones` (+ จุดรับสินค้า/ตลาดนัด) · หลังร้าน/POS ใช้ `DeliveryZones` | ค่าส่งคนละตาราง — ต้องเลือกตารางตามช่องทางให้ชัดในโค้ด |
| API เจ้าของร้านของฝั่งลูกค้า (`/api/owner/*`) | **ไม่ย้ายส่วนที่ซ้ำ** — ย้ายเฉพาะที่หลักไม่มีเข้า `/api/admin/*` | ตั้งค่าร้าน · รีวิวขั้นสูง · ชุดสินค้า · คำค้นเทียบเคียง · กลุ่มตัวเลือก ฯลฯ |
| ยกเลิกออเดอร์ที่ชำระแล้ว | **แบบฝั่งลูกค้า** — ลูกค้ายกเลิกเองได้ (pending/confirmed) · "ยกเลิก + ชำระแล้ว" = รอโอนคืน ร้านกดคืนเงินเอง | §8.8 |
| ส่งฟรีตามยอด (เว็บ) | **ไม่มี** (แบบฝั่งลูกค้า) — ส่งฟรีจากโปรโมชันเท่านั้น | §8.7 |
| จุดรับสินค้า (takeaway เว็บ) | **ไม่บังคับ** — ส่งมาแล้วตรวจ · ไม่ส่ง = รับที่ร้านแบบเดิม | §8.7 |
| แนบสลิปหลังหมดเวลา | **ย้ายมา** — เปิดออเดอร์กลับ (ตัดสต็อกใหม่ · ของไม่พอ = เปิดไม่ได้) | §8.8 |
| สมัครสมาชิก | **แบบฝั่งลูกค้า** — ยืนยันอีเมลก่อน ไม่ล็อกอินให้ (`/api/auth/register` path เดิม) | §8.9 |
| บังคับยืนยันอีเมล | **เฉพาะลูกค้า** — เจ้าของร้าน/พนักงานล็อกอินได้ตามเดิม | §8.9 |
| LINE login (next-auth) | **ย้ายมา** — หา/สร้างบัญชีจาก `line_user_id` | §8.9 |
| ไม่จ่ายเงิน | **พรีออเดอร์ใช้ของหลัก** (กำหนดชำระ + ยกเลิกอัตโนมัติ) · **ออเดอร์ปกติจากเว็บ** เพิ่ม orderExpiry + นโยบายยกเลิกของฝั่งลูกค้า (ไม่ใช้กับ `POS-`) | |
| ขั้น 0 (ด่วน) | **แก้โค้ดฝั่งลูกค้าเลย** (`Downloads/backend`) ระหว่างที่ยังรวมไม่เสร็จ | ใช้ `is_preorder` แทน `product_type` · เลิกเขียน `product_type: "ready"` + สต็อก 0 ตอนปิดรอบ · ผู้ใช้ deploy เอง (ต้องยืนยันว่าโค้ดชุดนี้ = ตัวที่รันจริง) |
| ขอบเขตฟีเจอร์ลูกค้า | **ตามที่หน้าเว็บลูกค้าใช้จริง** — `Downloads/frontend/frontend` (§8.4) | ใช้เกือบครบ §7.1 → ขั้น 6 = ย้ายเกือบทั้งหมด |
| next-auth | **ย้ายมาไว้ใน backend หลัก** (`/api/auth/[...nextauth]`) | `/api/shop/*` รับทั้ง cookie JWT เดิม + session next-auth · users ชุดเดียว |
| หมดเวลาจ่าย (ออเดอร์เว็บ) | **30 นาที** (แบบฝั่งลูกค้า) | ยกเลิก + คืนสต็อก/คูปอง/แต้ม · ไม่ใช้กับ POS และออเดอร์ที่ส่งสลิปแล้ว |
| ส่วนลดซ้อน | **แบบฝั่งลูกค้า** — คูปองส่วนตัว **หรือ** โค้ด 1 อย่าง + ใช้แต้มร่วมได้ | แต้ม: 25 บาท = 1 แต้ม · 10 แต้ม = 1 บาท · ลดได้ ≤ 30% ของยอดสินค้า · ขั้นต่ำ 100 แต้ม · อายุ 365 วัน |
| แจ้งเตือนลูกค้า | **กระดิ่งในเว็บ + LINE** | ทุกคนเห็นในเว็บ (`CustomerNotifications`) · LINE ส่งผ่าน `customerNotifyService` ของหลักครั้งเดียว (มีตัวกันโควตา) — ไม่ส่งซ้ำ 2 ทาง |
| รีวิว | **แสดงทันที** ร้านซ่อนทีหลังได้ | `status` เริ่มต้น `approved` · เพิ่มปักหมุด / ตอบกลับ / แท็ก-โน้ตภายใน / อ่านแล้ว |
| ออเดอร์เก่า `ORD-<timestamp>` | **นับเป็น "เว็บ"** ใน dashboard + สรุปรายเดือน | `ORD-<timestamp>` เป็น "เว็บ" อยู่แล้ว ไม่ต้องแก้โค้ด · ช่องเว็บ = `ORD-` เท่านั้น (`WEB-` ไม่นับ — §8.6) |
| พรีออเดอร์หลายตัวเลือก | **อยู่ใบเดียวได้** | เลิกห้าม `round_item_id` ซ้ำ ถ้าตัวเลือกต่างกัน · โควตารอบ / สูงสุดต่อคน นับรวมทุกแถว |
| ⏳ **หลังร้านตัวไหน** | **ยังไม่ตัดสินใจ — ต้องคุยกับทีม** | หน้าเว็บลูกค้ามี `/owner` + `/employee` ครบชุด (เรียก `/api/owner/*` 43 เส้น + route ทั่วไป) ซ้อนกับ FrontEnd repo · ระหว่างนี้ทำเฉพาะฝั่งลูกค้า (`/api/shop/*`) · **ปิดพอร์ต 4000 ไม่ได้จนกว่าจะตัดสินใจ** |

### 8.2 ลำดับงาน (จัดลำดับใหม่ 2026-10-05)

| ลำดับ | ขั้น | งาน | ต้องรอ | สถานะ |
|---|---|---|---|---|
| — | 1 | กลุ่มตัวเลือก + ออปชัน (ตัวเลือกไม่มีสต็อก) · เลิก Y9 | — | ✅ 2026-10-05 (§8.3) |
| **P0** | 0 | แก้ `Downloads/backend`: `product_type` → `is_preorder` (ตะกร้า · checkout · POS) · ตอนปิดรอบเลิกเขียน `product_type`/สต็อก 0 | ผู้ใช้ deploy เอง | 🟡 แก้แล้ว 2026-10-05 รอ deploy (§8.5) |
| P1 | 2 | สคริปต์ย้าย `lineId` → `line_user_id` (dry-run · ผู้ใช้รัน `--apply`) | ผู้ใช้รัน `--apply` | ✅ สคริปต์พร้อม 2026-10-05 (§8.6) |
| P1 | 3 | next-auth ใน backend หลัก · `/api/shop/*` รับ 2 แบบ · สมัคร/ยืนยันอีเมล/ลืมรหัสผ่าน/ตั้งรหัสใหม่ (nodemailer) | ตั้งค่า SMTP + `NEXTAUTH_SECRET` ใน env ตอน deploy | ✅ 2026-10-05 (§8.9) |
| P1 | — | dashboard: `ORD-<timestamp>` นับเป็น "เว็บ" | — | ✅ เป็นอยู่แล้ว ไม่ต้องแก้ (§8.6) |
| P2 | 4 | `ShippingZones` + จุดรับสินค้า / ตลาดนัด สำหรับออเดอร์เว็บ (POS/หลังร้านใช้ `DeliveryZones`) | — | ✅ 2026-10-05 (§8.7) |
| P2 | 5 | ออเดอร์เว็บ: หมดเวลาจ่าย 30 นาที + นโยบายยกเลิก · QR พร้อมเพย์ · payment link | — | ✅ 2026-10-05 (§8.8) |
| P2 | — | พรีออเดอร์: สินค้าเดียวกันหลายตัวเลือกในใบเดียว | — | ✅ 2026-10-05 (§8.10) |
| P3 | 6 | ฟีเจอร์ลูกค้า (ตาม §8.4): ~~แต้ม + แชร์แต้ม · คูปองส่วนตัว~~ ✅ (§8.11) · ~~กระดิ่งแจ้งเตือน~~ ✅ (§8.12) · ~~ชุดสินค้า~~ ❌ ไม่ย้าย (§8.13) · ~~รายการโปรด~~ ✅ (§8.14) · ~~แนะนำ/สินค้าคล้าย/สารก่อภูมิแพ้~~ ✅ (§8.15) · ~~คำค้นเทียบเคียง~~ ✅ (§8.16) · ติดต่อร้าน · อัปโหลดรูปรีวิว (+ แต้มรีวิว) · ข้อมูลร้าน/โลโก้ | — | 🟡 แต้ม+คูปอง · กระดิ่ง เสร็จ 2026-10-05 |
| P4 | 7 | หลังร้าน: API ที่หน้าเว็บลูกค้าต้องใช้แต่ข้อมูลมาจากร้าน (ตั้งค่าร้าน · โซนค่าส่ง · ตลาดนัด · ชุดสินค้า · คำค้น · รีวิวขั้นสูง) เข้า `/api/admin/*` | ตัดสินใจ "หลังร้านตัวไหน" | ⏸ รอทีม |
| P5 | 8 | ปิด backend พอร์ต 4000 | หน้าเว็บลูกค้าย้าย path ครบ + ตัดสินใจหลังร้าน | ⏸ |

### 8.3 ขั้น 1 — กลุ่มตัวเลือก (ทำแล้ว 2026-10-05)

| | ก่อน (Y9) | หลัง |
|---|---|---|
| ตัวเลือก | `variant_id` ตัวเดียว · มี `variant_stock` แยก | **กลุ่มตัวเลือก** (`ProductVariantGroups`: `min_select`/`max_select`) · เลือกได้หลายกลุ่ม/หลายอย่าง · ราคาบวกเพิ่มอย่างเดียว |
| สต็อก | สต็อกสินค้า = ผลรวม `variant_stock` · ปรับที่ตัวสินค้า = 409 · ไม่เลือกตัวเลือก = 400 | สต็อกอยู่ที่ตัวสินค้าอย่างเดียว · `variant_stock` เลิกใช้ (ยังอยู่ใน DB · API ไม่รับแล้ว) · ปิดงานผลิตเพิ่มสต็อกสินค้าที่มีตัวเลือกได้ตามปกติ · ตัวตรวจรายวันไม่มี `variant_stock_sum` แล้ว |
| ตัวเลือกเก่าไม่มีกลุ่ม | — | นับเป็นกลุ่ม "ตัวเลือก" เลือก 1 (บังคับ) — POS ที่ส่ง `variant_id` ตัวเดียวใช้ได้เหมือนเดิม |
| ออปชันเสริม | ไม่ตรวจ `is_required` ของออปชันแบบเลือก · ข้อความว่างก็คิดเงิน | ออปชันบังคับต้องเลือก/กรอก · ข้อความว่าง = ไม่เลือก (ไม่คิดเงิน) · ตัดช่องว่างซ้ำ |

**API**

- `GET/PUT /api/admin/products/[id]/customization` (products.view / products.update) — PUT ทั้งชุด `{ groups: [{ _id?, group_name, min_select, max_select, variants: [{ _id?, variant_name, variant_price }] }], options: [{ _id?, option_name, is_text_input, max_text_length, extra_price, is_required }] }` · มี `_id` = แก้ · ไม่มี = เพิ่ม · หายไป = ลบ
- `GET /api/catalog/products/[id]/customization` (สาธารณะ) — `{ groups, options }`
- ตะกร้า / ออเดอร์ (เว็บ + POS) / พรีออเดอร์ รับ `variant_ids: [...]` (ทุกกลุ่ม) + `selected_options` · `variant_id` ตัวเดียวยังรับ
- รายการเก็บ snapshot: `selected_variants[{ group_name, variant_id, variant_name, variant_price }]` · `product_snapshot.variant_name` = ข้อความรวม ("ขนาด: 2 ปอนด์ · รสชาติ: วานิลลา, มะยงชิด") · `variant_id` มีค่าเมื่อเลือกอย่างเดียว · ตะกร้ามี `customization_key` (รวมแถวชุดเดียวกัน)
- `POST /api/admin/pos/scan` คืน `customization` เพิ่ม (`variants[]` ไม่มี `variant_stock` แล้ว)
- พรีออเดอร์: ราคา = ราคารอบ + ตัวเลือก · สินค้าเดียวกันหลายตัวเลือกอยู่ใบเดียวได้แล้ว (§8.10)

**ไฟล์:** `src/services/productCustomizationService.ts` (ใหม่) · `src/models/productVariantGroupModel.ts` (ใหม่) · `productVariantModel` (+`group_id`, `display_order`) ·
`productOptionModel` (+`display_order`) · `cartItem/orderItem/preorderItem` (+`selected_variants`…) · `cartService` · `orderService` · `preorderService` · `productService` (ถอด Y9) ·
`productVariantService` · `productionOrderService` · `dataIntegrityService` · เทส `productCustomization.test.ts` 10 เคส (แทน `variantStock.test.ts`)

**frontend หลังร้าน:** POS — สินค้ามีกลุ่มตัวเลือก ให้เลือกตาม `scan.customization` แล้วส่ง `variant_ids` · ไม่ต้องแสดง/ปรับสต็อกต่อตัวเลือก · หน้าแก้สินค้าใช้ `/customization` แทน CRUD ตัวเลือกทีละตัว

### 8.4 หน้าเว็บลูกค้าเรียก API อะไรบ้าง (สแกน `Downloads/frontend/frontend/src` 2026-10-05)

Next 16 + next-auth + antd · `BACKEND_URL` (ค่าเริ่มต้น `http://localhost:4000`) · มี 3 ส่วน: `/customer` · `/owner` · `/employee` · รวม 131 path

- **ลูกค้า (49):** addresses · banners · bundles · cart-items (+my-cart) · checkout · contact · coupons (+check/redeem) · favorites · ingredients ·
  line (+email) · notifications · order-items · orders · payment-link (+redeem) · pickup-locations · points (+share) · preorder-round-items/storefront ·
  preorder-rounds (+storefront) · preorders · product-categories · products (+detail/reviews/recommended) · recommendations (+similar) · review-aspects ·
  reviews (+upload) · search-synonyms · shipping-zones · store-info · store-logo · store-settings · `/api/auth/forgot-password` · `/reset-password` ·
  `/api/user/verify-email` · `/api/line/connect` · `/api/users/:id`
- **หลังร้าน (`/owner` + `/employee`):** `/api/owner/*` 43 path (aspects · banners · ingredients · map-link · orders/items · payments · pos-checkout ·
  preorder-rounds/items (+dashboard/customers) · products (+customization) · product-categories · reviews (+analytics/bulk/dashboard/filter-options/products) ·
  search-synonyms · semantic-terms · shipping-zones · store-profile · store-settings) + route ทั่วไป (bundles · components · expenses · ingredient-* ·
  notifications · permissions (+temporary) · production-* · promotions · recipes · reports/sales · roles · units · user-logs · users · weekly-markets · me/permissions)

### 8.5 ขั้น 0 — แก้ `Downloads/backend` แล้ว (2026-10-05 · รอ deploy)

แก้ 12 ไฟล์ · typecheck 0 error · ทดสอบ hook ของ model กับ MongoDB ชั่วคราวผ่าน 6 กรณี · **สำรองไฟล์เดิม + diff ที่
`Downloads/backend/backup-stage0-2026-10-05/`** (ย้อนกลับ = คัดลอกไฟล์ในนั้นทับคืน)

- `productModel`: เพิ่ม `is_preorder` · `product_type` ไม่บังคับ · hook แปลง `product_type` ที่ส่งมา → `is_preorder` และไม่บันทึก `product_type` (create / save / updateOne / updateMany / findOneAndUpdate) · save ครั้งถัดไปลบ `product_type` ที่ค้าง
- ตะกร้า · checkout · ชุดสินค้า · POS: กรองพรีออเดอร์ด้วย `is_preorder: { $ne: true }`
- ปิดรอบ: **เลิกเขียน `product_type: "ready"` + สต็อก 0**
- เพิ่มสินค้าเข้ารอบ: ต้องเป็น `is_preorder: true` (ไม่งั้น 400) · ไม่พลิกประเภท/ล้างสต็อกให้
- serializer ยังคืน `product_type` (คำนวณจาก `is_preorder`) + `is_preorder` → หน้าเว็บลูกค้าไม่ต้องแก้
- แนะนำสินค้า · รายงานรีวิวรายสินค้า · ฟอร์มสินค้า: ใช้ `is_preorder`

**หลัง deploy ฝั่งลูกค้า:** backend หลัก `npm run cleanup:legacy-product-fields` (dry-run) → `-- --apply` · ตรวจสินค้า 5 ตัวที่ `product_type` เคยขัดกับ `is_preorder` (ต่อไปใช้ `is_preorder`)

### 8.6 ขั้น 2 + ช่องทางออเดอร์ (2026-10-05)

**ขั้น 2 — `npm run migrate:line-user-id`** (`scripts/migrate-line-user-id.ts` · เทส `migrateLineUserId.test.ts` 2 เคส)

| กรณี (ผู้ใช้ที่ยังไม่ถูกลบ + มี `lineId`) | ผล |
|---|---|
| `line_user_id` ว่าง | คัดลอก `lineId` → `line_user_id` |
| ตรงกันอยู่แล้ว | ข้าม |
| `line_user_id` มีค่าอื่น / LINE นี้ผูกกับผู้ใช้อื่นแล้ว | **ไม่แตะ** รายงานให้ตรวจเอง |

- **ไม่ลบ `lineId`** — backend ฝั่งลูกค้า (พอร์ต 4000) ยังอ่าน `lineId` ส่ง LINE · ลูกค้าที่ผูก LINE ผ่านฝั่งลูกค้าหลังรันสคริปต์ → รันซ้ำเพื่อเก็บตก (รันซ้ำได้)
- `-- --apply --remove-old` = ลบ `lineId` ของคนที่ตรงกันแล้ว — **ใช้หลังปิดพอร์ต 4000 เท่านั้น**
- dry-run ค่าเริ่มต้น · backup `scripts/backups/line-user-id-*.json` · เขียนแบบมีเงื่อนไข · ไม่แตะ `updated_at` · log แสดง LINE userId แบบปิดบางส่วน

**ช่องทางออเดอร์ (`orderChannelOf`)** — ไม่แก้โค้ด: `ORD-<timestamp>-xxxx` ของฝั่งลูกค้านับเป็น "เว็บ" อยู่แล้ว (ขึ้นต้น `ORD-`) ·
ช่องเว็บ = `ORD-` เท่านั้น (ผู้ใช้เลือก 2026-10-05) · `PRE-` = พรีออเดอร์ (`orderChannelOf` คืน `preorder` · ยอดพรีออเดอร์ยังนับจาก collection `preorders`) · `WEB-<timestamp>` / `OP-` รุ่นเก่ายังเป็น "อื่น ๆ" · เทส `orderChannelOf` เอาเคส `WEB-` ออก

### 8.7 ขั้น 4 — ค่าส่ง ShippingZones + จุดรับสินค้า (2026-10-05)

ผู้ใช้เลือก: **เก็บทั้งสองระบบ** (เว็บ = ShippingZones · หลังร้าน/POS = DeliveryZones) · **ไม่มีส่งฟรีตามยอด** สำหรับเว็บ (ส่งฟรีจากโปรโมชันเท่านั้น) ·
**จุดรับไม่บังคับ** (ส่งมาแล้วตรวจ — storefront ของทีม FrontEnd ไม่พัง)

| เรื่อง | ทำอะไร |
|---|---|
| ค่าส่งออเดอร์/พรีออเดอร์เว็บ | `storefront: true` (ส่งจาก `/api/shop/orders` · `/api/shop/preorders`) → `shippingService.quoteStorefrontDelivery`: โซน A–D ตามจังหวัด (ไม่ตรง A/B/C = D) · ยังไม่มีโซนใน DB → สร้าง A40 / B60 / C80 / D100 ให้ |
| ขอบเขตจัดส่ง | หมวดที่ `ships_nationwide` ไม่เปิด (ไม่ตั้ง = ดูชื่อหมวด "ซาวโดว์" = ทั่วประเทศ) → ส่งได้เฉพาะจังหวัดร้าน (`StoreSettings.province`) · นอกเขต = 400 |
| จุดรับสินค้า | `StoreProfile.weekly_markets` ที่ `is_active` (ย้ายเวลาทำการเดิมเข้ามาครั้งเดียวแบบเดียวกับฝั่งลูกค้า) · ออเดอร์: วันที่จุดเปิดภายใน 14 วัน · พรีออเดอร์: วันรับของรอบ + 12 วัน เฉพาะวันที่จุดเปิด · บันทึก `pickup_date` + `pickup_point{point_id, point_name, address, note}` |
| หลังร้าน | `ships_nationwide` แก้ได้ที่ `/api/admin/product-categories` · ค่าส่ง/โปรโมชันของหลังร้านใช้ DeliveryZones เหมือนเดิม |

**API:** `GET /api/catalog/shipping-zones` · `GET /api/catalog/pickup-locations` (+ `schedule` · `order_pickup_dates`) ·
`POST /api/shop/orders/delivery-quote` คืน `{ deliverable, message, fee, free, zone, zone_code, free_shipping_min: null }` (+ `product_ids?` สำหรับพรีออเดอร์) ·
`POST /api/shop/orders` / `/api/shop/preorders` รับ `pickup_location_id` + `pickup_date` (YYYY-MM-DD)

**ไฟล์:** `src/lib/shipping.ts` · `src/lib/pickupLocations.ts` · `src/services/shippingService.ts` · model `ShippingZones` / `StoreSettings` / `StoreProfile` (collection เดียวกับฝั่งลูกค้า) ·
`ProductCategories.ships_nationwide` · `Orders/Preorders.pickup_date + pickup_point` · เทส `storefrontShipping.test.ts` 6 เคส

### 8.8 ขั้น 5 — หมดเวลาชำระ · นโยบายยกเลิก · QR พร้อมเพย์ · ลิงก์ชำระเงิน (2026-10-05)

| เรื่อง | ทำอะไร |
|---|---|
| หมดเวลาชำระ 30 นาที | ออเดอร์จากหน้าเว็บได้ `payment_due_at` = สั่ง + 30 นาที · เลยแล้วยังไม่ส่งสลิป → ยกเลิก (`cancelled_reason` = "หมดเวลาชำระเงิน (ระบบยกเลิกอัตโนมัติ)") + คืนสต็อก/สิทธิ์โปรโมชัน + แจ้งลูกค้า · cron `npm run cron:order-expiry` ทุก 5 นาที + lazy ตอนลูกค้าเปิดรายการ/รายละเอียด/หน้าชำระเงิน · POS / แอดมินสร้าง / ออเดอร์เก่า (ไม่มี `payment_due_at`) ไม่ถูกแตะ · พรีออเดอร์ใช้กำหนดชำระของหลักตามเดิม |
| แนบสลิปย้อนหลัง (ผู้ใช้เลือกย้ายมา) | ออเดอร์ที่หมดเวลา + ยังไม่จ่าย → `POST /api/shop/payments` พร้อมสลิป (หรือแนบสลิปกับ payment เดิม) = **ตัดสต็อกใหม่** แล้วกลับเป็น pending รอตรวจ · ไม่แนบสลิป = 400 · ของไม่พอ = 409 (ไม่สร้าง payment) · แจ้งร้าน "เปิดออเดอร์กลับ" · ⚠️ สิทธิ์โปรโมชันที่คืนไปตอนยกเลิกไม่ถูกบันทึกซ้ำ |
| นโยบายยกเลิก (แบบฝั่งลูกค้า) | `POST /api/shop/orders/[id]/cancel` → `cancelOrderByCustomer`: pending/confirmed เท่านั้น · POS- = 409 · **ชำระแล้วก็ยกเลิกได้** → "ยกเลิก + ชำระแล้ว" = รอโอนคืน (**ไม่**ตั้ง refunded อัตโนมัติ) + แจ้งร้าน (finance) · ร้านโอนคืนแล้วกด `POST /api/admin/payments/[id]/refund` · แอดมินยกเลิกยังคืนเงินอัตโนมัติแบบเดิม |
| QR พร้อมเพย์ | `GET /api/shop/orders/[id]/payment` · `/api/shop/preorders/[id]/payment` → QR (data URL) ตามยอด + สถานะ + สลิปล่าสุด + `payment_due_at` + `server_time` + `late_upload` · เลขพร้อมเพย์จาก `StoreProfile.promptpay_id` ก่อน → env `PROMPTPAY_ID` · ไม่ตั้งทั้งคู่ = `qr_image: null` + `qr_error` · ส่งสลิปยังใช้ `/api/shop/payments` เดิม (ไม่ย้าย multipart ของฝั่งลูกค้า) |
| ลิงก์ชำระเงินใช้ครั้งเดียว | `POST /api/shop/payment-link` `{ kind?, id }` → `{ token, expires_at }` (30 นาที) · `POST /api/shop/payment-link/redeem` `{ kind?, token }` → `{ kind, id, orderId }` · ใช้แล้ว/หมดอายุ/คนอื่น = 410 · DB เก็บ SHA-256 (`payment_link_token` select: false) |

**ไฟล์:** `orderService` (`expireUnpaidOrders` · `reopenExpiredOrder` · `cancelOrderByCustomer` · `updateOrderStatus({ skipAutoRefund })`) · `paymentService` (`getPaymentPage` · late slip) ·
`promptpayService` · `paymentLinkService` · `/api/cron/order-expiry` + `scripts/run-order-expiry.ts` · dependency `promptpay-qr` + `qrcode` · เทส `webOrderPayment.test.ts` 6 เคส

**deploy:** cron ตัวที่ 5 (`*/5` — [`DEPLOY.md`](DEPLOY.md) ⑧) · ตั้งเลขพร้อมเพย์ (StoreProfile ผ่านหลังร้านฝั่งลูกค้า หรือ env `PROMPTPAY_ID`)

### 8.9 ขั้น 3 — next-auth ใน backend หลัก + ยืนยันอีเมล + ลืมรหัสผ่าน (2026-10-05)

ผู้ใช้เลือก: **next-auth ย้ายมาไว้ในหลัก** (เก็บทั้งสองระบบ) · **สมัครแบบฝั่งลูกค้า** (ยืนยันอีเมลก่อน ไม่ล็อกอินให้) ·
**บังคับยืนยันอีเมลเฉพาะลูกค้า** (เจ้าของร้าน/พนักงานไม่กระทบ) · **ย้าย LINE login** (เก็บที่ `line_user_id`)

| เรื่อง | ทำอะไร |
|---|---|
| ล็อกอิน 2 ระบบ | cookie `session` ของหลัก (`/api/auth/login`) เหมือนเดิม + next-auth `/api/auth/[...nextauth]` (credentials · Google · LINE — provider ที่ไม่ได้ตั้ง id/secret ไม่เปิด) · middleware ไม่มี cookie ของหลัก → อ่าน token next-auth (Edge `getToken`) แปลงเป็น SessionUser เดียวกัน (`source: "nextauth"` · role `admin` เดิม = owner) |
| ตัด session next-auth | `withAuth` / `withPermission` ตรวจ DB ทุก request (แบบฝั่งลูกค้า): บัญชีถูกลบ/ปิด หรือล็อกอินก่อน `password_changed_at` = 401 · token เก่าจากฝั่งลูกค้าที่ไม่มี `role_id` → เติมจาก DB · เปลี่ยน/รีเซ็ตรหัสผ่าน (ทุกทาง) ตั้ง `password_changed_at` |
| สมัคร `POST /api/auth/register` | รับ body ทั้งสองแบบ (+ `user_birthday`/`user_birthdate` · `user_allergies`) · สร้างบัญชียังไม่ยืนยัน + ส่งลิงก์ (24 ชม.) · **ไม่เซ็ต cookie แล้ว** · ส่งอีเมลไม่ได้ = 502 + ยกเลิกการสมัคร (สมัครใหม่ใช้เอกสารเดิม) |
| ยืนยันอีเมล | `GET/POST /api/auth/verify-email` (ฝั่งลูกค้าเดิม `/api/user/verify-email`) · `POST /api/auth/resend-verification` (ตอบเหมือนกันทุกกรณี — สำหรับลูกค้าเก่าที่สมัครก่อนบังคับยืนยันด้วย) |
| ล็อกอินลูกค้ายังไม่ยืนยัน | 403 `details.reason = "EMAIL_NOT_VERIFIED"` (ทั้ง `/api/auth/login` และ next-auth) — เช็คหลังรหัสถูกเท่านั้น · บัญชีที่มีรหัสผ่านใช้ล็อกอินได้แม้ผูก Google/LINE |
| ลืมรหัสผ่าน | `POST /api/auth/forgot-password` (1 ชม. · ไม่บอกว่ามีอีเมลไหม · บัญชี Google/LINE ไม่มีรหัส = 400) · `GET /api/auth/reset-password?token=` (เช็คลิงก์) · `POST /api/auth/reset-password` `{ token, newPassword }` (ใช้ครั้งเดียว · ห้ามรหัสเดิม · ปลดล็อก) |
| Google (next-auth) | หาจากอีเมล → ผูก `googleId` ให้บัญชีเดิม (ไม่เปลี่ยน auth_provider) · ไม่มี = สร้างลูกค้า (ยืนยันแล้ว) · บัญชีสมัครไม่สำเร็จ → ใช้เอกสารเดิม ล้างรหัสผ่าน |
| LINE (next-auth) | หาจาก `line_user_id` เท่านั้น · อีเมลจาก LINE ซ้ำบัญชีอื่น = ให้ล็อกอินวิธีเดิมแล้วกดเชื่อมต่อ LINE · ไม่มีอีเมล → `line-…@line-user.invalid` แล้วตั้งอีเมลจริงที่ `GET/POST /api/shop/me/email` · `auth_provider: "line"` |
| อีเมล | `src/lib/mailer.ts` (nodemailer 10) · ผู้ส่ง = ชื่อร้าน (StoreProfile) · Reply-To = อีเมลติดต่อร้าน · ลิงก์ไป `STOREFRONT_URL` (ไม่ตั้ง = `NEXTAUTH_URL`) `/customer/verify-email` · `/customer/reset-password` · token เก็บ SHA-256 (ยังรับ token ดิบที่ฝั่งลูกค้าออกไว้) |

**ไฟล์:** `src/lib/nextAuth.ts` · `src/app/api/auth/[...nextauth]` · `src/middleware.ts` · `src/lib/authGuard.ts` (`assertSessionStillValid`) · `src/lib/mailer.ts` ·
`src/services/accountService.ts` · `src/services/oauthService.ts` · `userService.verifyCredentials` (กติกาลูกค้ายืนยันอีเมล) · `userModel` (+`password_changed_at` · auth_provider `line`) ·
`authService.register` เอาออก · dependency `next-auth@4` + `nodemailer@10` (peer optional ของ next-auth = ^7 — ใช้แค่ Email provider ซึ่งไม่ได้เปิด) ·
เทส `accountFlows.test.ts` 8 เคส · smoke test บน `next start` จริง: cookie next-auth ผ่าน `/api/shop` (200) · cookie เสีย / ก่อนเปลี่ยนรหัส = 401 · ลูกค้าเข้า `/api/admin` = 403

**ต้องตั้งตอน deploy:** `NEXTAUTH_SECRET` (ใช้ค่าเดียวกับฝั่งลูกค้าถ้าอยากให้ลูกค้าที่ล็อกอินอยู่ไม่หลุดตอนสลับ) · `NEXTAUTH_URL` = URL หน้าเว็บลูกค้า (เบราว์เซอร์เรียก /api ผ่าน rewrites ของหน้าเว็บ) ·
`STOREFRONT_URL` · `EMAIL_USER` / `EMAIL_PASS` (+ `EMAIL_SERVICE` หรือ `EMAIL_HOST`/`EMAIL_PORT`) · `GOOGLE_CLIENT_SECRET` ·
callback ใน Google Console + LINE Login channel: `{NEXTAUTH_URL}/api/auth/callback/google` · `/api/auth/callback/line`

**frontend:**
- หน้าเว็บลูกค้า: `/api/user/verify-email` → `/api/auth/verify-email` · `/api/customer/line/email` → `/api/shop/me/email` · ที่เหลือ path เดิม
- storefront ของทีม FrontEnd (`/api/auth/register`): สมัครแล้ว**ไม่ได้ล็อกอินอัตโนมัติ** — แสดง "ตรวจอีเมล" · ล็อกอินแล้วได้ 403 `EMAIL_NOT_VERIFIED` → ปุ่มส่งอีเมลยืนยันใหม่

### 8.10 พรีออเดอร์สินค้าเดียวกันหลายตัวเลือกในใบเดียว (2026-10-05)

ผู้ใช้เลือก: **อยู่ใบเดียวได้** (แบบฝั่งลูกค้า) · `preorderService.createPreorder`

| เดิม | ตอนนี้ |
|---|---|
| `round_item_id` ซ้ำใน `items` = 400 "รวมจำนวนเป็นรายการเดียว" | ซ้ำได้ — **ตัวเลือกต่างกัน = แยกแถว** (เช่น ช็อกโกแลต 1 + วานิลลา 1) · **ตัวเลือกเดียวกัน = รวมจำนวนเป็นแถวเดียว** (คำขอพิเศษใช้ค่าล่าสุดที่ไม่ว่าง) |
| ขั้นต่ำต่อรายการ | ขั้นต่ำต่อแถว (หลังรวม) — แบบฝั่งลูกค้า |
| สูงสุดต่อคนต่อรอบ (`preorder_config.max_order_qty`) นับพรีออเดอร์เดิม + แถวนี้ | นับพรีออเดอร์เดิม + **ทุกแถวของสินค้าเดียวกันในใบนี้** |

โควตารอบ (`commitQty` / `releaseQty`) จอง/คืนต่อแถวเหมือนเดิม · ใบผลิต/สรุปรอบรวมตามสินค้าอยู่แล้ว ไม่ต้องแก้ · เทสเพิ่ม 1 เคสใน `productCustomization.test.ts`

### 8.11 ขั้น 6 (ส่วนแรก) — แต้มสะสม + คูปองส่วนตัว (2026-10-05)

กติกา "แบบฝั่งลูกค้า" (§8.1): คูปองของฉัน **หรือ** โค้ดส่วนลด 1 อย่าง + ใช้แต้มร่วมได้ · collection เดียวกับฝั่งลูกค้า (`PointTransactions` · `UserCoupons`)

| เรื่อง | ทำอะไร |
|---|---|
| ได้แต้ม | ออเดอร์/พรีออเดอร์ **completed** → ทุก 25 บาทของยอดสินค้าหลังส่วนลด (ไม่รวมค่าส่ง) = 1 แต้ม · สมัครสมาชิก 50 (ตอน**ยืนยันอีเมล** / สมัครด้วย Google ทันที) · ข้อมูลครบ (วันเกิด + เบอร์ + ที่อยู่) 10 · แชร์สินค้า 5 (ครั้งเดียวต่อสินค้า) · เฉพาะ role ลูกค้า · อายุแต้ม 365 วัน |
| ใช้แต้ม | `points_to_redeem` ตอนสั่ง (`/api/shop/orders` · `/api/shop/preorders`) · ต้องมี ≥ 100 · ทีละ 10 · 10 แต้ม = 1 บาท · ≤ 30% ของยอดสินค้าหลังหักคูปอง/โปร · หักจากล็อตใกล้หมดอายุก่อน (FIFO) |
| คูปอง | ร้านตั้ง `points_cost` ที่โปรโมชัน (`/api/admin/promotions`) → ลูกค้าแลก (`POST /api/shop/coupons/redeem`) ได้ `UserCoupons` 1 ใบ (snapshot เงื่อนไข · หมดอายุสิ้นวันสุดท้ายของโปร · จำกัดต่อคนตาม `max_user_per_user`) → ใช้ด้วย `user_coupon_id` ตอนสั่ง (คิดส่วนลดด้วย discountEngine เดียวกับโปร: ขั้นต่ำ · เพดาน · ส่งฟรีต้องมีค่าส่ง) · โปรที่มี `points_cost` กรอกเป็นโค้ดตรง ๆ ไม่ได้ (422) |
| ยกเลิก / คืนเงิน | คืนแต้มที่ใช้กลับล็อตเดิม · ดึงแต้มที่ได้จากออเดอร์นั้นคืน (ส่วนที่ยังไม่ใช้) · คูปองกลับเป็น available (ไม่คืนแต้มที่ใช้แลก) · สิทธิ์โปร/used_count คืนผ่าน revokeUsage · เรียกซ้ำได้ (dedupe) |
| ไม่มี transaction | หักแต้ม/จองคูปองแบบมีเงื่อนไข + Saga คืนให้ถ้าสร้างออเดอร์ไม่สำเร็จ (สต็อกไม่พอ ฯลฯ) · `_id` ของออเดอร์จองไว้ก่อน |
| แนบสลิปย้อนหลัง (§8.8) | ออเดอร์ที่ใช้แต้ม/คูปองแล้วหมดเวลา → **เปิดกลับไม่ได้** (แต้ม/คูปองถูกคืนไปแล้ว แต่ยอดยังหักส่วนลดอยู่) — ให้สั่งใหม่/ติดต่อร้าน |

**API:** `GET /api/shop/points` (ยอด · ใกล้หมดอายุ · ประวัติ 50 · โบนัส · กติกา) · `POST /api/shop/points/share` `{ product_id }` ·
`GET /api/shop/coupons` (`catalog` + `coupons` พร้อม state) · `POST /api/shop/coupons/redeem` `{ promotion_id }` · `POST /api/shop/coupons/check` `{ code }` ·
ออเดอร์/พรีออเดอร์บันทึก `points_redeemed` · `points_discount` · `user_coupon_id` · `coupon_discount` (รวมอยู่ใน `discount_amount`)

**ต่างจากฝั่งลูกค้า:** ส่วนลดคูปองส่งฟรีนับใน `discount_amount` (แบบโปรของหลัก) ไม่ใช่ลด `delivery_fee` — ยอดรวมเท่ากัน ·
แต้มรีวิว (15/20) ยังไม่ทำ (ไปพร้อมกลุ่มรีวิว)

**ไฟล์:** `src/services/pointsService.ts` · `src/services/couponService.ts` · model `PointTransactions` / `UserCoupons` · `Promotions.points_cost` ·
`orderService` / `preorderService` (checkout + sync ตอน completed/cancelled/refunded) · `promotionService.validateForOrder` (กันโค้ดของโปรแลกแต้ม) ·
`accountService.verifyEmail` · `oauthService` (โบนัสสมัคร) · `/api/shop/addresses` · `/api/shop/me` (โบนัสข้อมูลครบ) · เทส `loyalty.test.ts` 6 เคส + โบนัสใน `accountFlows.test.ts`

### 8.12 ขั้น 6 — กระดิ่งแจ้งเตือนในเว็บของลูกค้า + LINE (2026-10-05)

ผู้ใช้เลือก: แจ้ง**ทั้งในเว็บและ LINE** ทุกสถานะ · **LINE ส่งเฉพาะบางสถานะแบบหลัก** (ประหยัดโควตา LINE OA ฟรี 300/เดือน) · **ไม่รวมบิลหน้าร้าน (POS-)**

| เหตุการณ์ | กระดิ่งในเว็บ | LINE (เดิม) |
|---|---|---|
| สร้างออเดอร์/พรีออเดอร์ | ✅ | ✅ |
| รับออเดอร์ (confirmed) · กำลังเตรียม · สำเร็จ | ✅ | — |
| พร้อมรับ (รับเอง) / พร้อมจัดส่ง | ✅ | ✅ เฉพาะรับเอง |
| ยกเลิก (+ เหตุผล · หมดเวลา = คำแนะนำแนบสลิป · จ่ายแล้ว = จะคืนเงิน) | ✅ | ✅ |
| ชำระสำเร็จ / สลิปไม่ผ่าน / คืนเงิน | ✅ | ✅ |
| จัดส่งแล้ว (+ เลขพัสดุ) / ถึงแล้ว / มีปัญหา | ✅ | ✅ |
| เตือนก่อนวันรับพรีออเดอร์ · ร้านเลื่อนวันรับ | ✅ | ✅ |

- ลูกค้ายกเลิกเอง → ไม่แจ้งกลับทั้งสองทาง (เห็นผลในหน้าเว็บแล้ว · แบบฝั่งลูกค้า) · บิล `POS-` ไม่แจ้งทั้งสองทาง (เดิม POS ยังส่ง LINE ตอนพร้อม/ยกเลิก/ชำระ)
- กระดิ่งบันทึกได้แม้ลูกค้าไม่ได้ผูก LINE หรือไม่ได้ตั้ง LINE token · `link` = `/customer/account/purchases/<id>` (ออเดอร์) · `/customer/account/preorders` (พรีออเดอร์) ตามหน้าเว็บลูกค้า
- collection `CustomerNotifications` เดียวกับฝั่งลูกค้า (รองรับ `visible_at` — รายการที่บันทึกล่วงหน้าโผล่เองเมื่อถึงเวลา)

**API:** `GET /api/shop/notifications?limit=` → `{ items, unread_count }` · `PATCH /api/shop/notifications` (อ่านทั้งหมด) · `PATCH /api/shop/notifications/[id]` (อ่านรายการเดียว)

**ไฟล์:** `customerNotifyService` (`customerWeb` · `notifyCustomer(userId, lineText, webNotice)` · list/markRead) · `src/models/customerNotificationModel.ts` · `src/lib/paymentDeadline.ts` (ค่าคงที่กำหนดชำระ — ใช้ร่วมไม่ import วน) ·
จุดเรียก: `orderService` · `preorderService` · `lib/orderLifecycle` · `preorderReminderService` · `preorderRoundService` · เทส `customerWebNotify.test.ts` 3 เคส

### 8.13 ชุดสินค้า (Bundles) — ไม่ย้าย (ผู้ใช้ตัดสินใจ 2026-10-05)

ร้าน**เลิกใช้ชุดสินค้า / "เซ็ตขนม" แล้ว** → ไม่ย้ายเข้า backend หลัก

- ฟีเจอร์เดิมของฝั่งลูกค้า (อ้างอิง): แพ็กเกจสินค้าหลายอย่างราคาพิเศษ (`Bundles`: รายการสินค้า + ราคาปกติรวม / ราคาแพ็กเกจ · วันหมดเขต · รูป base64 · ยอดขาย) ·
  ลูกค้าดูที่ `/customer/dessert-set` → ใส่ตะกร้า → ตอนชำระแตกเป็นสินค้าจริงรายชิ้น (ราคาลดตามสัดส่วน) + `bundle_lines` ในออเดอร์ ·
  ขายในบิลหน้าร้านได้ · ยกเลิกลด `sold_count` คืน · สร้างใหม่ประกาศลูกค้าทุกคน (กระดิ่ง + LINE) · หลังร้าน `/owner/promotions/bundles`
- ข้อมูลเดิมใน DB (collection `Bundles` · `Orders.bundle_lines` · `CartItems.bundle_id`) **ไม่แตะ** — ออเดอร์เก่าที่มาจากแพ็กเกจยังเป็นรายการสินค้าจริงอยู่แล้ว (แตกไว้ตอนสั่ง) อ่าน/รายงานได้ตามปกติ
- **หน้าเว็บลูกค้า:** ต้องเอาหน้า `/customer/dessert-set` (+ `[id]`) · ปุ่มใส่แพ็กเกจในตะกร้า (`CartItem` แบบ bundle) · เมนูหลังร้าน `/owner`/`/employee` `promotions/bundles` · แพ็กเกจใน POS ของหลังร้านฝั่งลูกค้าออก
- ตะกร้าของหลักไม่รู้จัก `bundle_id` — แถวแพ็กเกจที่ค้างในตะกร้าเดิม (สร้างโดยฝั่งลูกค้า · ไม่มี `product_id`) จะทำให้สั่งจากตะกร้าผ่านหลักได้ 400 จนกว่าลูกค้าจะลบแถวนั้น → ควรล้างแถว `bundle_id` ในตะกร้าก่อนสลับหน้าเว็บไปใช้หลัก

### 8.14 ขั้น 6 — รายการโปรด (2026-10-05)

- เก็บใน `Interactions` (`action_type: "wishlist"`) collection เดียวกับฝั่งลูกค้า — ระบบแนะนำสินค้า (ยังไม่ย้าย) ใช้ข้อมูลชุดนี้ด้วย
- 1 สินค้า = 1 แถวต่อลูกค้า · เอาออก = soft delete · เพิ่มซ้ำ = กู้แถวเดิม · สินค้าที่ถูกลบแล้วไม่แสดง (สินค้าที่ร้านซ่อนแสดงพร้อม `inStock: false`)
- **API:** `GET /api/shop/favorites` → `{ items: [{ id, name, nameeg, category, price, originalPrice, image, inStock, rating, is_preorder }] }` (รูปแบบเดียวกับฝั่งลูกค้า + `is_preorder`) ·
  `POST /api/shop/favorites` `{ productId }` (201 · สินค้าไม่มี = 404) · `DELETE /api/shop/favorites` `{ productId }` หรือ `?productId=` · รับ `product_id` ได้ด้วย
- ต่างจากฝั่งลูกค้า: เพิ่มสินค้าที่ไม่มี/ถูกลบ = 404 (ฝั่งลูกค้าบันทึกได้เลย) · หน้าเว็บลูกค้าเปลี่ยน path `/api/customer/favorites` → `/api/shop/favorites` และอ่านข้อมูลจาก `data.items` (envelope ของหลัก)
- **ไฟล์:** `src/models/interactionModel.ts` · `src/services/favoriteService.ts` · `src/app/api/shop/favorites/route.ts` · เทส `favorites.test.ts` 2 เคส

### 8.15 ขั้น 6 — แนะนำสินค้า · สินค้าคล้ายกัน · ตรวจสารก่อภูมิแพ้ (2026-10-05)

ย้าย engine ของฝั่งลูกค้ามาทั้งชุด (`src/services/recommendation/recommendationEngine.ts` + `allergenChecker.ts` · ปรับ import ให้ใช้ model ของหลัก — ตรรกะเดิม)

| เรื่อง | ทำอะไร |
|---|---|
| คะแนนแนะนำ (hybrid) | collaborative (ลูกค้าที่ซื้อ/ชอบคล้ายกัน) 35% · content (หมวด/ราคา/รสชาติจากสิ่งที่เคยซื้อ) 30% · ยอดนิยม 15% · สารก่อภูมิแพ้ 20% + boost หมวดที่ชอบ/ช่วงวัย · ข้อมูลจาก ออเดอร์ · ตะกร้า · รีวิว · รายการโปรด (`Interactions`) · ลูกค้าใหม่ (< 5 การใช้งาน) = cold start |
| สารก่อภูมิแพ้ | `users.user_allergies` (ชื่อวัตถุดิบ · ใส่ `ชื่อ:severe` ได้ — ตั้งที่ `PATCH /api/shop/me`) เทียบกับวัตถุดิบในสูตร (แบบไม่สนวรรณยุกต์/ชื่อย่อย เช่น "นม" ตรง "นมสด") → `allergenWarning` (caution/warning/danger) + ลดคะแนน · `excludeAllergens=true` ตัดออก |
| ไม่แนะนำ | สินค้าที่ร้านซ่อน · พรีออเดอร์ · สต็อก 0 (ตามตัวกรองเดิมของฝั่งลูกค้า) |
| ความเร็ว | cache แคตตาล็อก 3 นาที (`RECOMMENDATION_CACHE_TTL_MS` · 0 = ปิด) · คำนวณเกิน 4.5 วิ หรือ hybrid ล้ม → ถอยเป็น popular |

**API:**
- `GET /api/shop/recommendations?limit=&strategy=hybrid|collaborative|content|popular&excludeAllergens=` (ล็อกอิน) → `{ recommendations: [{ product, score, reasons, allergenWarning }], meta }`
- `GET /api/catalog/products/recommended` (สาธารณะ · ล็อกอินอยู่ = เฉพาะตัว) → `{ products }` 10 ชิ้น — ไม่ล็อกอินเรียงตามคะแนนรีวิว
- `GET /api/catalog/products/[id]/similar?limit=` (สาธารณะ · ล็อกอิน = เตือนสารก่อภูมิแพ้) → `{ recommendations }`
- `GET /api/catalog/ingredients` (สาธารณะ) → `{ ingredients: [{ _id, ingredient_name }] }` ให้เลือกอาหารที่แพ้ — ไม่ส่งต้นทุน/สต็อก

**หน้าเว็บลูกค้าเปลี่ยน path:** `/api/customer/recommendations` → `/api/shop/recommendations` · `/customer/products/recommended` → `/api/catalog/products/recommended` ·
`/customer/recommendations/similar/:id` → `/api/catalog/products/:id/similar` · `/customer/ingredients` → `/api/catalog/ingredients` · ข้อมูลอยู่ใน `data` (envelope ของหลัก)

**ไฟล์:** `src/services/recommendation/{recommendationEngine,allergenChecker,recommendationService}.ts` · `src/types/recommendation.ts` · route 4 เส้น · `vitest.config.mts` (ปิด cache) · เทส `recommendations.test.ts` 3 เคส

### 8.16 ขั้น 6 — คำค้นเทียบเคียง (คำพ้องค้นหา) (2026-10-05)

- ร้านตั้งกลุ่มคำพ้อง เช่น "ช็อกโกแลต: chocolate, ช็อค" → ลูกค้าพิมพ์คำไหนในกลุ่มก็เจอสินค้าเดียวกัน · collection `SearchSynonyms` เดียวกับฝั่งลูกค้า
- กติกาขยายคำค้น (เหมือนหน้าเว็บลูกค้า `synonymMatch.ts`): คำค้นตรงกับคำในกลุ่ม (ตรงตัว / คำค้นมีคำนั้น / คำนั้นขึ้นต้นด้วยคำค้น ≥ 2 ตัวอักษร) → ค้นด้วยทุกคำในกลุ่ม
- **เพิ่มจากฝั่งลูกค้า:** `GET /api/catalog/products?search=` ขยายคำค้นให้ฝั่ง server ด้วย (storefront ของทีม FrontEnd ได้ผลเลยไม่ต้องทำเอง) · หลังร้าน `/api/admin/products` ค้นตามคำเดิม
- ตรวจข้อมูลแบบฝั่งลูกค้า: คำ ≥ 2 ตัว · ≤ 60 ตัว · ≤ 50 คำพ้อง/กลุ่ม · ตัดคำซ้ำ · คำหลักซ้ำกลุ่มอื่น (ไม่สนตัวพิมพ์/วรรณยุกต์) = 409 · cache 60 วิ ล้างทันทีเมื่อแก้
- **API:** `GET /api/catalog/search-synonyms` (สาธารณะ → `[{ term, synonyms }]`) · `GET/POST /api/admin/search-synonyms` · `PATCH/DELETE /api/admin/search-synonyms/[id]` (สิทธิ์เมนู products · ลบแบบ soft delete · บันทึก userlog)
- หน้าเว็บลูกค้าเปลี่ยน path: `/api/customer/search-synonyms` → `/api/catalog/search-synonyms` · หน้าจัดการ `/api/owner/search-synonyms` → `/api/admin/search-synonyms` (ถ้ายังใช้หลังร้านฝั่งลูกค้า — รอทีมตัดสินใจ §8.1)
- **ไฟล์:** `src/models/searchSynonymModel.ts` · `src/lib/search/normalize.ts` · `src/services/searchSynonymService.ts` · `productService.getProducts({ expandSynonyms })` · เทส `searchSynonyms.test.ts` 3 เคส
