# ประวัติคำสั่ง & คำตอบ (ย่อ)

บันทึกคำสั่งที่ผู้ใช้สั่ง และคำตอบ/ผลลัพธ์แบบย่อ เรียงตามลำดับเวลา

---

## #1 — 2026-08-31

**ผู้ใช้สั่ง:**
สร้าง clone ของ `D:\Cream\MeowMeeCake\-MeowMeeCake-NextJS5` มาที่โปรเจกต์ `D:\Cream\MeowMeeCakeV2\NextJS-MeowMeeCake`
จุดประสงค์: แก้ให้ component สอดคล้องกันมากขึ้น โดยอ้างอิงจาก `D:\Cream\MeowMeeCake_Components.html`
ให้ **วางแผน** สร้างโปรเจกต์ใหม่โดยอิง feature + layout ทั้งหมดจาก `-MeowMeeCake-NextJS5`
— ยังไม่ต้องเขียนโค้ด — และทำไฟล์ .md บันทึกประวัติคำสั่ง + คำตอบย่อ

**คำตอบย่อ:**
- วิเคราะห์ทั้ง 3 แหล่ง: ต้นทาง (Next 16.2.6 / React 18 / antd 6 / mongoose / JWT auth, ~80 API routes, 38 controllers, 39 models, 27+ screens), ปลายทาง (create-next-app เปล่า + มี `src/models/*` 39 ไฟล์แล้ว โดย 5 ไฟล์ต่างจากต้นทาง), และ `MeowMeeCake_Components.html` (Atomic Design 18/40/53/5/8 + 27 screens)
- สร้างเอกสาร 2 ไฟล์:
  - `docs/REBUILD_PLAN.md` — แผน 6 เฟส (0 setup → 1 data → 2 backend → 3 component library ตาม Atomic → 4 screens 27 หน้า → 5 wiring → 6 verify) + ตาราง screen→route→template→component + รายการเรื่องต้องตัดสินใจ (D1–D7) + ความเสี่ยง
  - `docs/PROMPT_HISTORY.md` — ไฟล์นี้
- ยังไม่เขียนโค้ดจริง ตามที่สั่ง
- **รอผู้ใช้ตัดสินใจ:** D1 เวอร์ชัน Next/React · D2 5 model ที่ต่าง · D3 reactCompiler · D4 material-tailwind · D5 ขอบเขต route (27 ใน reference ก่อน?) · D6 ค่า `.env.local`

---

## #2 — 2026-08-31

**ผู้ใช้สั่ง:**
กำลังตัดสินใจเรื่องโครงสร้าง component: จะใช้ Atomic เต็มรูป หรือแบ่งเป็น
share component (ใช้หลายที่) + base component (atom) + component หน้าเดียวไว้ใน folder ของ page นั้น ๆ

**คำตอบย่อ:**
- แนะนำ **แนวหลัง (reuse-based + colocation)** — เหมาะกับโปรเจกต์นี้กว่า Atomic เต็มรูป
  (เส้นแบ่ง atom/molecule/organism เถียงไม่จบ · reference มี organism ใช้หน้าเดียว 40+ ตัว · ชิ้นส่วนหน้าเดียวกระจายหลายที่)
- โครงที่เสนอ: `src/components/base/` (atoms) + `src/components/shared/<concern>/` (ใช้ ≥2 screen) + `app/owner/<route>/_components/` (ใช้ 1 screen)
- กติกา: UI ล้วน→base · ≥2 screen→shared · 1 screen→page-local · มี consumer ที่ 2→promote ขึ้น shared
- เก็บ Atomic level เป็นแท็กใน `docs/COMPONENT_MAP.md` เพื่อตรวจความสอดคล้อง (ไม่ใช่โครงโฟลเดอร์)
- อัปเดต `REBUILD_PLAN.md`: เขียนเฟส 3 ใหม่ทั้งหมด + เพิ่ม D8 (ตัดสินแล้ว = แนวหลัง)

---

## #3 — 2026-08-31

**ผู้ใช้สั่ง:** D1 = downgrade

**คำตอบย่อ:**
- ยึดเวอร์ชันต้นทาง: `next` 16.2.6 · `react`/`react-dom` 18.3.1 · `eslint-config-next` 16.2.6 · `@types/react(-dom)` ^18
- ผลพลอยได้: ตัด `next/font/google` (Geist) ออกจาก `layout.tsx`, antd v6 peer-dep หมดปัญหา
- อัปเดต `REBUILD_PLAN.md`: D1 = ตัดสินแล้ว, เฟส 0 ข้อ 1 เขียนใหม่, ตัดความเสี่ยง React 19 ออก
- เหลือตัดสิน: D2 · D3 · D4 · D5 · D6

---

## #4 — 2026-08-31

**ผู้ใช้สั่ง:** D2 — model ที่ต่างมีอะไรบ้าง (ขอดูรายละเอียด)

**คำตอบย่อ:**
- diff ทั้ง 5 ไฟล์ (`attendanceModel`, `bundleModel`, `expenseModel`, `ingredientTransactionModel`, `notificationModel`)
- **ผล: เนื้อหาเหมือนกัน byte-for-byte** — ต่างแค่ line ending (ปลายทาง = CRLF, ต้นทาง + อีก 34 ไฟล์ = LF)
- D2 = ไม่มี schema conflict จริง → normalize เป็น LF + เพิ่ม `.gitattributes` (`* text=auto eol=lf`)
- อัปเดต `REBUILD_PLAN.md`: ข้อ 2, D2, เฟส 1
- เหลือตัดสิน: D3 · D4 · D5 · D6

---

## #5 — 2026-08-31

**ผู้ใช้สั่ง:**
- D3: ใช้ตามต้นทาง (เปิด reactCompiler)
- D4: เปิดใช้ (อยากให้ component บางส่วนใช้ Tailwind จัดการ)
- D5: ทำ 27 screen ก่อน
- D6: ค่า env เอามาให้ทีหลัง, mock ไปก่อน + สร้างไฟล์บันทึกว่า mock ตรงไหนบ้าง

**คำตอบย่อ:**
- **D3 = เปิด** `reactCompiler: true` + `babel-plugin-react-compiler@1.0.0` (Next จะใช้ Babel แทน SWC — build ช้าลงบ้าง)
- **D4:** ตรวจแล้ว `@material-tailwind/react` = dead dep ในต้นทาง (ไม่ถูก import เลย) + v2.1.10 ไม่รองรับ Tailwind v4 + เป็น component library ซ้อน antd → ถามผู้ใช้ → **เลือก "Tailwind ล้วน ไม่เอา material-tailwind"** · custom/visual component ใช้ Tailwind v4 utility ตรง ๆ, data/form ใช้ antd (`base/`)
- **D5 = ทำ 27 screen ใน reference ก่อน** · หน้าที่เกิน (promotions, reports, planOrPurchaseOrder ฯลฯ) = นอกขอบเขตรอบนี้
- **D6 = mock ไปก่อน** · เพิ่มชั้น mock ใน `dbConnect`/controller + `src/mocks/` fixtures + mock auth (user owner ปลอม) · **สร้าง `docs/MOCKS.md`** บันทึกทุกจุด mock + checklist ตอนถอด · กติกา: คอมเมนต์ `// MOCK:` ในโค้ดทุกจุด
- อัปเดต `REBUILD_PLAN.md`: D3–D6 + เฟส 0/1/2/4/6 + ข้อ 5/9/10 · สร้าง `docs/MOCKS.md`
- **D1–D8 ครบแล้ว — พร้อมเริ่มเฟส 0 เมื่อผู้ใช้ไฟเขียว**

---

## #6 — 2026-08-31

**ผู้ใช้สั่ง:**
- อยากทำ text localization รองรับ 2 ภาษาด้วย i18n ก่อนเป็นอันดับแรก
- แจกแจง model, type, constant, util ในโปรเจกต์

**คำตอบย่อ:**
- สร้าง `docs/I18N_PLAN.md`:
  - ไลบรารี = **`next-intl`** (no URL routing, locale ใน cookie `mmc_locale`) · locale: `th` (default) / `en`
  - โครง `src/i18n/` (config/request/format/useLocale + messages/{th,en}.json) · namespace ~22 กลุ่ม (common, nav, breadcrumb, entities, fields, enums, ...)
  - ย้าย label map เดิม (`entityLabels`, `fieldLabels`, `unitContext`, `promotionChannel`, sidebar menu, breadcrumb) → catalog
  - แยก `label` ออกจาก `*_CONFIG` ใน types (เหลือแต่สี) · รวมฟังก์ชัน format ที่กระจาย → `i18n/format.ts`
  - **DB enum ที่เก็บค่าไทย** (`Attendances.status`, `Expenses.category/payment_method`) = แนวทาง A: คงค่าใน DB, map ตอนแสดง (ไม่ migrate)
  - locale switcher ใน `UserMenuDropdown` · สคริปต์ lint หา literal อักษรไทยนอก `messages/`
  - แทรกเป็น **เฟส 0.5** (ทำก่อน component/screen)
- สร้าง `docs/INVENTORY.md`: แจกแจง **38 model** (จัดกลุ่ม 10 โดเมน + ชี้ enum ที่เป็นค่าไทย) · **6 type file** (interface/enum/const/util/mock แต่ละไฟล์) · **constant** (label map + enum config → ปลายทางหลัง i18n) · **util** (12 lib + helper ใน types)
- แก้ตัวเลขในแผน: models = **38** (ไม่ใช่ 39) · lib = 12 · api route.ts = 84
- อัปเดต `REBUILD_PLAN.md`: เพิ่มเฟส 0.5, D9, docs index, เกณฑ์ component "ไม่มี literal ข้อความ", เฟส 6 เพิ่ม i18n verify
- **D1–D9 ครบ — พร้อมเริ่ม เฟส 0 → 0.5 → 1 ...**

---

## #7 — 2026-08-31

**ผู้ใช้สั่ง:**
โครงโค้ดในแต่ละ screen/component แบ่งเป็น "ไฟล์โครงสร้าง" + "viewmodel" — ถามว่าเข้าใจไหม / เรียกว่าอะไร

**คำตอบย่อ:**
- ใช่ เข้าใจ — คือ **MVVM** (Model–View–ViewModel) · ใน React ทำผ่าน **custom hook (ViewModel) + presentational component (View)** · ชื่ออื่น: Container/Presentational (Smart/Dumb), headless component
- ต้นทางมีเค้าอยู่แล้ว: `useStaffRoles.ts`, `useProductionData.ts`, `useSalesTransactions.ts`
- สร้าง `docs/CODE_STRUCTURE.md`:
  - **Screen:** `page.tsx` (บาง เรียก hook + render View) + `<X>View.tsx` (JSX ล้วน) + `use<X>ViewModel.ts` (state/effect/fetch/handler/derived/permission) + `.types.ts`
  - **Component:** atom/presentation = ไฟล์เดียว · ตัวที่มี logic จริง (modal/table/form/kanban/cart) = split เป็นโฟลเดอร์ `<Name>/` + `index.ts` + `<Name>.tsx` + `use<Name>.ts`
  - เกณฑ์ split · ตาราง "อะไรอยู่ VM / อะไรอยู่ View" · `src/services/<resource>.ts` แยก `fetch("/api/*")` ออกจาก VM (จับคู่ mock D6) · naming convention
- **D10:** ทุก screen/component ที่มี logic ใช้ MVVM ตามเอกสารนี้
- อัปเดต `REBUILD_PLAN.md`: D10, docs index, `src/services/`, เกณฑ์เฟส 3 (split + `COMPONENT_MAP` เพิ่มคอลัมน์ split?), เฟส 4 (page+View+ViewModel), เฟส 6 (ตรวจ View ไม่มี fetch)
- **D1–D10 ครบ**

---

## #8 — 2026-08-31

**ผู้ใช้สั่ง:**
เช็ค + วางแผน: authentication, JWT, public layout, protected layout, axios, interceptor, การทำ session, session timeout

**คำตอบย่อ:**
- ตรวจของเดิมในต้นทาง → สร้าง `docs/AUTH_PLAN.md`:
  - **มีอยู่แล้ว:** JWT httpOnly cookie `mmc_session` (payload `{userId,roleId,roleType,email,fullname}`, อายุ 7d) · `session.ts` (sign/verify/set/clear) · login (bcrypt + auto-upgrade plaintext, lockout 5 ครั้ง/15 นาที, กัน user-enum, กัน role customer) · logout · `/api/auth/me` (คืน user + `menuAccess`) · `proxy.ts` guard `/owner/*` + `can_view` ต่อ route · `createCrudController` เช็ค `requirePermission` เฉพาะ POST/PATCH/DELETE
  - **ช่องโหว่/ที่ขาด:** ไม่มี refresh/sliding/idle timeout · **GET API เปิดโล่ง** ไม่เช็ค session · ไม่มี axios (ใช้ `fetch` 36 จุด) · Google OAuth env มีแต่ไม่ได้ทำ · public/protected layout ยังไม่เป็น template ชัด
  - **แผนเพิ่ม:** `src/lib/http.ts` axios + request interceptor (`Accept-Language`) + response interceptor (401→refresh→redirect, 403 toast, 409/422 ส่งต่อ, 5xx/network toast, unwrap `{data,meta}`, single-flight refresh) · `src/services/*` เรียก axios แทน fetch · session timeout = **short access token 30 นาที + sliding refresh (`/api/auth/refresh`) + absolute cap 8 ชม.** + `useIdleTimeout` (warn 60 วิ) + cross-tab `BroadcastChannel` + `visibilitychange` revalidate · `AuthLayout`/`OwnerLayout` เป็น template · `requireSession` + `can_view` ให้ GET API · throttle login ราย IP · i18n ข้อความ auth
  - เพิ่ม **เฟส 2.5 (Auth & HTTP foundation)** หลัง backend ก่อน component library
  - **D11** session timeout = แบบ B (short token + refresh + cap) · **D12** 401 → ลอง refresh ก่อน redirect · **D13** cookie `sameSite=lax` (คงเดิม) · **D14** เพิ่ม session guard ให้ GET API — *D11–D14 เป็นค่าแนะนำ รอผู้ใช้ยืนยัน*
- อัปเดต `REBUILD_PLAN.md`: docs index, เฟส 0 (+axios), เฟส 2 (auth hardening), เฟส 2.5 ใหม่, เฟส 5/6, โครงสร้าง, section 10, D11–D14

---

## #9 — 2026-08-31

**ผู้ใช้สั่ง:** ยืนยัน D11–D14

**คำตอบย่อ:**
- D11 = B (access token 30 นาที + sliding refresh throttle 5 นาที + absolute cap 8 ชม. + warn 60 วิ)
- D12 = ลอง refresh ก่อน แล้วค่อย redirect `/login?reason=expired`
- D13 = cookie `sameSite=lax` (คงเดิม)
- D14 = เพิ่ม `requireSession` ทุก GET + `can_view` เมื่อมี `menuKey`
- อัปเดต `REBUILD_PLAN.md` + `AUTH_PLAN.md`: mark ตัดสินแล้ว
- **D1–D14 ครบทั้งหมด — แผนพร้อม เริ่มเฟส 0 ได้เมื่อผู้ใช้ไฟเขียว**

---

## #10 — 2026-08-31  ▶ เริ่มเขียนโค้ด: เฟส 0 (เสร็จ)

**ผู้ใช้สั่ง:** เริ่มเขียนโค้ดเฟส 0

**ทำจริง:**
- `package.json`: downgrade `next` 16.2.6 · `react`/`react-dom` 18.3.1 · `eslint-config-next` 16.2.6 · `@types/react(-dom)` ^18 · เพิ่ม deps: `antd`, `mongoose`, `bcryptjs`, `jsonwebtoken`, `dayjs`, `axios`, `@heroicons/react`, `lucide-react`, `recharts`, `sweetalert2`, `qrcode` · devDeps: `@types/bcryptjs|jsonwebtoken|qrcode`, `babel-plugin-react-compiler@1.0.0`
- `next.config.ts`: `reactCompiler: true` (D3)
- port จากต้นทาง: `src/app/globals.css` (ธีมกาแฟ), `src/app/providers.tsx` (antd ConfigProvider + th_TH + dayjs), `src/app/favicon.ico`, `public/pictures/logoMoewMeeCake.png`, `public/*.svg`
- `src/app/layout.tsx`: ตัด `next/font/google` (Geist), ใช้แบบต้นทาง (`<html lang="th">` + `<Providers>`)
- `src/app/page.tsx`: placeholder (เฟส 5 จะใส่ redirect ตาม session)
- `.env.local` (mock mode — ไม่มี `MONGODB_URI`) + `.env.example` + `.gitignore` เพิ่ม `!.env.example`
- `npm install` สำเร็จ (539 pkg) — ยืนยัน react 18.3.1 / next 16.2.6 / antd 6.6.2
- **อ่าน `node_modules/next/dist/docs/`** (กฎ AGENTS.md): ยืนยัน `proxy.ts` = convention ปัจจุบัน (middleware deprecated v16) → `src/proxy.ts` ของต้นทางถูกต้องแล้ว · runtime = Node.js
- **ผล: `npm run build` ✅ · `npm run lint` ✅**

**ติดปัญหา/เลื่อน:**
- `next-intl@3.26` peer ไม่รับ next 16 → **เลื่อนติดตั้งไปเฟส 0.5** ด้วย `next-intl@^4` (บันทึกใน `I18N_PLAN.md` + `REBUILD_PLAN.md`)
- Git เตือน LF→CRLF — จะแก้ด้วย `.gitattributes` (`eol=lf`) เฟส 1 (D2)

**ถัดไป:** เฟส 0.5 (i18n foundation)

---

## #11 — 2026-08-31  ▶ เฟส 0.5 (i18n foundation) เสร็จ

**ผู้ใช้สั่ง:** เริ่มเฟส 0.5

**ทำจริง:**
- ติดตั้ง **`next-intl@4.14.1`** (v3.26 peer ไม่รับ next 16 → ใช้ v4 ที่รองรับ `next ^16` + `react ^18`)
- `src/i18n/config.ts` — `locales ['th','en']`, `defaultLocale 'th'`, `LOCALE_COOKIE 'mmc_locale'`, `localeNames` (endonym), `resolveLocale()`
- `src/i18n/request.ts` — `getRequestConfig` อ่าน cookie → โหลด `messages/<locale>.json` (แบบไม่มี i18n routing)
- `src/i18n/format.ts` — `formatCurrency` (THB) / `formatNumber` / `formatPercent` / `formatDate` รับ locale (แทน fmtBaht/formatCurrency/fmt/fmtDateTH/fmtPct ที่ต้นทางกระจาย)
- `src/i18n/useSetLocale.ts` — hook สลับภาษา (เขียน cookie + `router.refresh()` ใน `useTransition`)
- `src/i18n/messages/{th,en}.json` — namespace: `common`, `nav` (เมนู+breadcrumb labels), `auth`, `errors`, `actions`, `entities` (37 model), `fields` (~130 field), `enums` (20 กลุ่ม — order/payment/production/stock/unit/promotion/sales/recipe/notification + DB-enum ค่าไทย 3 กลุ่มแบบแนวทาง A) + screen namespace ว่าง 13 อัน
- `next.config.ts` — wrap `createNextIntlPlugin("./src/i18n/request.ts")` (คง `reactCompiler`)
- `src/app/layout.tsx` — async, `getLocale()` → `<html lang={locale}>`, ครอบ `NextIntlClientProvider`
- `src/app/providers.tsx` — antd `ConfigProvider locale` = thTH/enUS + `dayjs.locale` ตาม `useLocale()` (useEffect)
- `src/app/page.tsx` — ใช้ `getTranslations("common")`
- `src/components/base/LocaleSwitcher.tsx` — ปุ่ม TH/EN (เฟส 3 Navbar จะ mount)
- `scripts/check-i18n.mjs` + `npm run lint:i18n` — หา literal อักษรไทยนอก `src/i18n|mocks|models|types`
- **ผล: `npm run build` ✅ · `lint` ✅ · `lint:i18n` ✅ (clean)**
- **smoke test** (`next start` + curl): ไม่มี cookie → `<html lang="th">` + ข้อความไทย · `mmc_locale=en` → `<html lang="en">` + ข้อความอังกฤษ ✅

**เลื่อนไปเฟสถัดไป:** set locale cookie จาก `Accept-Language` ใน `proxy.ts` (เฟส 2) · port `entityLabelTh`/`fieldLabelTh`/`formatFieldValue`/`computeFieldDiff` (เฟส 2) · mount LocaleSwitcher ใน Navbar (เฟส 3)

**ถัดไป:** เฟส 1 (models normalize + types + mocks)
