# แผนสร้างโปรเจกต์ `NextJS-MeowMeeCake` ขึ้นใหม่

> เอกสารวางแผน — **ยังไม่เขียนโค้ด** ตามที่สั่งไว้
> อัปเดตล่าสุด: 2026-08-31

**เอกสารในชุด `docs/`:**
- `REBUILD_PLAN.md` (นี้) — แผนรวม 7 เฟส + การตัดสินใจ D1–D9
- `I18N_PLAN.md` — แผน i18n 2 ภาษา (เฟส 0.5)
- `INVENTORY.md` — แจกแจง 38 model / 6 type file / constant / util
- `CODE_STRUCTURE.md` — MVVM: แยก View + ViewModel ในแต่ละ screen/component (D10)
- `AUTH_PLAN.md` — auth / JWT / session timeout / axios + interceptor / public+protected layout (D11–D14)
- `MOCKS.md` — จุดที่ mock ไว้ (D6) + checklist ถอด
- `COMPONENT_MAP.md` — (สร้างตอนเฟส 3) map component → ที่วาง → ไฟล์ต้นทาง
- `PROMPT_HISTORY.md` — ประวัติคำสั่ง + คำตอบย่อ

---

## 1. เป้าหมาย

| ประเด็น | รายละเอียด |
|---|---|
| ต้นทาง (source of truth ด้าน feature/layout) | `D:\Cream\MeowMeeCake\-MeowMeeCake-NextJS5` |
| ปลายทางที่จะสร้าง | `D:\Cream\MeowMeeCakeV2\NextJS-MeowMeeCake` (โปรเจกต์นี้) |
| เอกสารอ้างอิง component | `D:\Cream\MeowMeeCake_Components.html` (Atomic Design: 18 Atoms / 40 Molecules / 53 Organisms / 5 Templates / 8 Global / 27 Screens) |
| จุดประสงค์หลัก | คัดลอก **feature + การวาง layout ทั้งหมด** จาก `-MeowMeeCake-NextJS5` แต่ **จัด component ให้สอดคล้องกัน** — แยกเป็น component library ตาม Atomic Design แทนการเขียน JSX ซ้ำในแต่ละหน้าแบบต้นทาง |

**หลักการ:** feature/logic/route = เหมือนต้นทาง 1:1 · โครงสร้าง component = จัดใหม่ตาม `MeowMeeCake_Components.html`

---

## 2. สถานะปัจจุบันของโปรเจกต์ปลายทาง

| สิ่งที่มีแล้ว | สิ่งที่ยังขาด |
|---|---|
| `create-next-app` เปล่า — Next **16.3.3**, React **19.2.8** → **จะ downgrade เป็น Next 16.2.6 / React 18.3.1** (D1) | ทุก dependency ของแอปจริง (antd, mongoose, jwt ฯลฯ) |
| `src/models/*` ครบ 38 ไฟล์ (เนื้อหาตรงกับต้นทาง, 5 ไฟล์ต่างแค่ CRLF) | `src/lib`, `src/controllers`, `src/app/api`, `src/types`, `src/proxy.ts`, `src/i18n` |
| `tsconfig.json` มี `@/*` path alias แล้ว | `src/app` ทั้งหมด (มีแต่ boilerplate: layout/page/globals.css) |
| `.gitignore`, `AGENTS.md`, `eslint.config.mjs` | `providers.tsx`, `globals.css` ธีมกาแฟ, `.env.local`, `public/pictures/logoMoewMeeCake.png` |
| git init แล้ว (branch `main`) | `node_modules` (ยังไม่ `npm install` ทั้งสองโปรเจกต์) |

**5 model ที่ "ต่าง" (`attendanceModel`, `bundleModel`, `expenseModel`, `ingredientTransactionModel`, `notificationModel`)** — ตรวจแล้ว **เนื้อหาเหมือนกัน byte-for-byte** ต่างแค่ line ending (ปลายทาง = CRLF, ต้นทาง + อีก 34 ไฟล์ = LF)
→ D2 = ไม่มี schema conflict จริง · แค่ normalize เป็น LF + เพิ่ม `.gitattributes` (`* text=auto eol=lf`)

---

## 3. สถาปัตยกรรมต้นทาง (สรุปเพื่อ clone)

```
src/
  app/
    layout.tsx          # <html><body> + <Providers>  (ไม่มี Sidebar/Navbar)
    providers.tsx        # antd ConfigProvider (ธีมน้ำตาล Coffee) + locale th_TH + dayjs.locale("th")
    page.tsx             # อ่าน session cookie → redirect /owner/dashboard หรือ /login
    globals.css          # @theme brown palette, font scale 14–22px, CSS ของ layout/sidebar/navbar/dashboard
    login/page.tsx       # หน้า login (AuthLayout)
    owner/
      layout.tsx         # OwnerLayout: Sidebar + Navbar + PermissionsProvider + mobile drawer + breadcrumb map
      <27 หน้า>          # ดูตาราง Screens ในข้อ 7
    components/           # navbar, sidebar, table, LoadingSpin, OrderStatusStats, PermissionsContext
    api/                 # ~80 resource (route.ts + [id]/route.ts) + auth/ + reports/ + attendances/*
  controllers/           # 38 ไฟล์ — ส่วนใหญ่เป็น wrapper บาง ๆ ของ createCrudController
  lib/                   # createCrudController, dbConnect, session, menuKeys, menuAccess,
                         # alert, entityLabels, fieldLabels, exportCsv, omise, promotionChannel, unitContext
  models/                # 38 mongoose models
  types/                 # index, orderTypes, productionTypes, recipetypes, salesTypes, Ingredienttypes
  proxy.ts               # route guard (ชื่อเดิม middleware) — กัน /owner/* + เช็ค can_view ตาม role
```

**Stack ต้นทาง:** Next 16.2.6 · React 18.3 · antd 6.4 · Tailwind 4 · mongoose 9 · jsonwebtoken · bcryptjs · sweetalert2 · recharts 3 · @heroicons/react · lucide-react · qrcode · dayjs
(`@material-tailwind/react` อยู่ใน package.json แต่ไม่ถูก import ที่ไหนเลย — ปลายทางตัดทิ้ง ดู D4)

**Auth:** JWT ใน httpOnly cookie `mmc_session` (อายุ 7d, ไม่มี refresh/idle timeout) → `verifySession()` ใน `proxy.ts` + `/api/auth/me` ป้อน `currentUser` + `menuAccess` ให้ layout · brute-force lockout ที่ login · **GET API ต้นทางเปิดโล่ง** (mutation เท่านั้นที่เช็ค permission) — รอบนี้เพิ่ม axios+interceptor, session timeout, `requireSession` ให้ GET (ดู `AUTH_PLAN.md`)

**Permissions:** `menu_key` 11 ตัว × 5 action (view/create/update/delete/approve) · role type `owner`/`admin` ข้ามการเช็คทั้งหมด · `proxy.ts` = ตัวกันจริง, sidebar/ปุ่ม = แค่ซ่อน UX

---

## 4. เดิน plan เป็นเฟส

### เฟส 0 — Setup & tooling  ✅ **เสร็จ 2026-08-31** (`npm run build` + `lint` ผ่าน)
> ทำจริง: `package.json` downgrade → next 16.2.6 / react 18.3.1 + deps (antd 6.6.2, mongoose, bcryptjs, jsonwebtoken, dayjs, axios, heroicons, lucide-react, recharts, sweetalert2, qrcode) · `next.config.ts` `reactCompiler:true` · port `globals.css` + `providers.tsx` + favicon + `public/pictures/logoMoewMeeCake.png` + svg · `layout.tsx` ตัด Geist · `page.tsx` placeholder · `.env.local` (mock) + `.env.example` · `.gitignore` `!.env.example` · อ่าน `node_modules/next/dist/docs/` (ยืนยัน `proxy.ts` = convention ถูกต้อง)
> ยังไม่ทำในเฟสนี้: `next-intl` (peer เก่าไม่รับ next 16 → ย้ายไปติดตั้งเวอร์ชันที่รองรับในเฟส 0.5)

1. **Downgrade framework ให้ตรงต้นทาง** (D1 = ตัดสินแล้ว): `next` 16.2.6, `react`/`react-dom` 18.3.1, `eslint-config-next` 16.2.6, `@types/react` ^18.3, `@types/react-dom` ^18.3
   - ลบ `next/font/google` (Geist) ออกจาก `layout.tsx` — ต้นทางไม่ใช้
   - `next dev` จะเขียน `AGENTS.md` block ใหม่ตามเวอร์ชันที่ downgrade แล้ว — commit ไปกับงาน
2. รวม `package.json`: เพิ่ม dependency จากต้นทาง + `@types/*` ที่เกี่ยว
   - deps: `antd`, `mongoose`, `bcryptjs`, `jsonwebtoken`, `@heroicons/react`, `lucide-react`, `recharts`, `sweetalert2`, `qrcode`, `dayjs`, `axios` — `next-intl` เลื่อนไปเฟส 0.5 (v3.26 peer ไม่รับ next 16 → ต้อง v4.x)
   - **ไม่เอา** `@material-tailwind/react` (D4)
   - devDeps: `@types/bcryptjs`, `@types/jsonwebtoken`, `@types/qrcode`, `babel-plugin-react-compiler@1.0.0` (D3)
3b. `next.config.ts`: `reactCompiler: true` (D3)
3. `npm install` แล้ว **อ่าน `node_modules/next/dist/docs/`** ตามกฎ `AGENTS.md` (จุดที่ API เปลี่ยน: `proxy.ts` vs middleware, `LayoutProps<>`, dynamic route params เป็น Promise ฯลฯ)
4. `next.config.ts`: ตัดสินใจเปิด `reactCompiler` หรือไม่ (ต้นทางเปิด + มี `babel-plugin-react-compiler`)
5. Port `globals.css` ธีมกาแฟทั้งไฟล์ (แทน boilerplate)
6. สร้าง `providers.tsx` (antd ConfigProvider + th_TH + dayjs)
7. `.env.local`: ผู้ใช้ต้องจัดหา `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRE`, `JWT_COOKIE_EXPIRE` (Google OAuth / email / omise = optional ตาม feature ที่จะเปิด)
8. คัดลอก `public/`: `pictures/logoMoewMeeCake.png`, svg ต่าง ๆ (รูปสินค้า/สลิปตัวอย่างเป็น optional สำหรับ demo)

### เฟส 0.5 — i18n foundation  ✅ **เสร็จ 2026-08-31** (`build` + `lint` + `lint:i18n` ผ่าน · smoke test cookie th↔en ผ่าน)
> ทำจริง: ติดตั้ง `next-intl@4.14.1` (v3 peer ไม่รับ next 16) · `src/i18n/{config,request,format,useSetLocale}.ts` + `messages/{th,en}.json` · `next.config.ts` wrap `createNextIntlPlugin("./src/i18n/request.ts")` · `layout.tsx` async + `NextIntlClientProvider` + `<html lang={locale}>` · `providers.tsx` antd locale (thTH/enUS) + `dayjs.locale` ตาม `useLocale()` · `messages` เติม namespace: `common`, `nav`, `auth`, `errors`, `actions`, `entities` (37), `fields` (~130), `enums` (20 กลุ่ม รวม DB-enum แนวทาง A) + screen namespaces ว่าง 13 อัน · `src/components/base/LocaleSwitcher.tsx` (เฟส 3 Navbar จะ mount) · `scripts/check-i18n.mjs` + `npm run lint:i18n`
> ยังไม่ทำ (เลื่อนไปเฟสที่เกี่ยวข้อง): set cookie จาก `Accept-Language` ใน `proxy.ts` (เฟส 2) · port ฟังก์ชัน `entityLabelTh`/`fieldLabelTh`/`formatFieldValue`/`computeFieldDiff` เป็น util + i18n wrapper (เฟส 2 คู่กับ createCrudController) · mount LocaleSwitcher ใน Navbar (เฟส 3)

### เฟส 1 — Data layer
1. Normalize line ending model ทั้ง 38 ไฟล์เป็น LF + เพิ่ม `.gitattributes` (`* text=auto eol=lf`)
2. ตรวจ 38 model ครบว่าตรงกับต้นทาง (ตอนนี้เนื้อหาตรงหมดแล้ว)
3. `src/types/` 6 ไฟล์: port + จัดระเบียบ (แยก `label` ออกจาก `*_CONFIG`, ย้าย `MOCK_*` → `src/mocks/`, ตั้งชื่อไฟล์สม่ำเสมอ) — ดู `INVENTORY.md`
4. Port `lib/dbConnect.ts`

### เฟส 2 — Backend (lib + controllers + API)
1. `lib/`: `createCrudController`, `session`, `menuKeys`, `menuAccess`, `entityLabels`, `fieldLabels`, `exportCsv`, `alert`, `unitContext`, `promotionChannel`, `omise`
2. `controllers/` 38 ไฟล์
3. `src/app/api/` — ~80 resource routes + `auth/{login,logout,me}` + `reports/{sales,order-in-store}` + `attendances/{check-in,check-out,today}`
4. `src/proxy.ts` + `export const config.matcher`
5. **Auth hardening (D14):** เพิ่ม `requireSession` ใน `getAll`/`getById` ของ `createCrudController` + `can_view` เมื่อ route มี `menuKey` + throttle `/api/auth/login` ราย IP — ดู `AUTH_PLAN.md`
6. **Mock (D6):** ยังไม่มี `MONGODB_URI` → เพิ่มชั้น mock — เมื่อ env ไม่มี ให้ `dbConnect`/controller คืน fixture จาก `src/mocks/` แทน query จริง (หรือใช้ `mongodb-memory-server` ตอน dev) · mock auth ให้ login ผ่านด้วย user ปลอม 1 คน (role owner)
7. บันทึกทุกจุด mock ลง `docs/MOCKS.md`
8. ทดสอบ: `GET /api/auth/me`, `GET /api/products` คืน mock ได้

### เฟส 2.5 — Auth & HTTP foundation (หลัง backend, ก่อน component library — ดู `AUTH_PLAN.md`)
1. `src/lib/http.ts` — axios instance (`baseURL:"/api"`, `withCredentials`) + request interceptor (`Accept-Language`) + response interceptor (401/403/409/422/429/5xx, unwrap `{data,meta}`, single-flight refresh)
2. `src/lib/authClient.ts` (`login`/`logout`/`refresh`/`broadcastLogout`) + `/api/auth/refresh` route + `session.ts` เพิ่ม `absExp` (D11 = แบบ B: access 30 นาที, absolute cap 8 ชม.)
3. `src/hooks/useIdleTimeout.ts` (จับ activity + warn 60 วิ + หมดเวลา → logout) · `src/hooks/useCurrentUser.ts` (`/api/auth/me` + revalidate on focus)
4. `AuthLayout` / `OwnerLayout` templates + `app/login/layout.tsx`
5. cross-tab `BroadcastChannel("mmc-auth")` + `visibilitychange` → revalidate
6. `src/services/<resource>.ts` เรียก `api` (axios) — ViewModel เรียก service

### เฟส 3 — Component library (งานหลักของโปรเจกต์นี้)

**แนวทางที่เลือก: reuse-based + colocation** (ไม่ใช่ Atomic folder เต็มรูป)
เหตุผล: เส้นแบ่ง atom/molecule/organism เถียงไม่จบ · reference มี "organism" ที่ใช้หน้าเดียว 40+ ตัว จะทำให้ `organisms/` บวม · ชิ้นส่วนของหน้าเดียวจะกระจายหลายโฟลเดอร์
→ ใช้ Atomic level เป็น **แท็กใน `docs/COMPONENT_MAP.md`** เพื่อตรวจความสอดคล้อง ไม่ใช่โครงโฟลเดอร์

```
src/
  components/
    base/                 # = atoms (18): primitive / antd wrapper, ไม่มี domain logic
                          #   Button, Input, PasswordInput, InputNumber, Select, Switch, Badge,
                          #   Tag, ProgressBar, Avatar, Spinner, DotIndicator, Icon, Divider,
                          #   ErrorMessage, EmptyState, DatePicker, Logo
                          #   (+ Card primitive ให้ ProductCard/RecipeCard/BannerCard ต่อยอด)
    shared/               # import จาก ≥ 2 screen — แบ่ง subfolder ตามหน้าที่
      layout/             #   OwnerLayout, AuthLayout, ListPageLayout, TabbedPageLayout,
                          #   DashboardPageLayout, Navbar, Sidebar, MenuGroupItem, BreadcrumbItem,
                          #   NotificationDropdown, NotificationItem, UserMenuDropdown
      data/               #   DataTable, FilterToolbar, SearchInput, TypeTabBar, SortDropdown,
                          #   ViewToggle, PaginationBar, AutoCompleteSearch
      feedback/           #   LoadingSpin, ConfirmDeletePopup, DetailDrawer
      stats/              #   StatCard, StatCardsGrid, StatusBadge, KPIStatsRow
      charts/             #   RevenueBarChart, AnalyticsBarChart
      form/               #   FormField, UploadImageBox, ToggleRow, MonthSelector,
                          #   PasswordShuffleButton, AvatarUploader
  hooks/                  # useStaffRoles, useProductionData, useSalesTransactions, ...
  context/                # PermissionsContext + usePermission(key) → {view,create,update,delete,approve}

app/owner/<route>/
  _components/            # component ที่ใช้ screen เดียว (prefix _ = Next.js ไม่ทำ route)
  page.tsx
```

ตัวอย่าง page-local `_components/`:
- `products/_components/` → ProductCard, ProductGrid, CategoryChip, RatingDisplay, ProductFormFields
- `production/_components/` → ProductionTabs, KanbanBoard, ProductionOrderCard, ProductionOrderForm, ProductionStatCards, TeamPerformanceCard
- `recipes/_components/` → RecipeCard, MainRecipeModal, SubRecipeModal, IngredientEditor, StepEditor
- `ingredients/ingredientStock/_components/` → ReceiveModal, AdjustModal, BulkReceiveModal, IngredientStockCard, IngredientStockGrid
- `ingredients/ingredientHistory/_components/` → TransactionTimeline, HistoryItemCard, LogTransactionModal
- `orders/OrderInStore/_components/` → ProductPickerGrid, CartPanel, QRPaymentModal
- `orders/manageOrders/_components/` → OrderStatusFilter, PaymentSlipPreview, OrderLifecycleSteps
- `finance/expenses/_components/` → ExpenseForm, CategoryBreakdownBar, RecurringReminderList, ReceiptImagePreview
- `finance/summary/_components/` → PLStatementTable, ProductRevenueTable, PeriodSelector
- `employees/permissions/_components/` → RoleList, PermissionCollapseSection, PermissionCheckboxGroup, RoleFormModal
- `employees/{addEmployee,editEmployee}/_components/` → EmployeeFormSections, EmployeeSummaryCard, MetaChips, DangerZone
- `dashboard/_components/` → RecentOrdersWidget, LowStockWidget, TopProductsWidget, ProductionStatusWidget
- `store-design/_components/` → BannerCard, BannerGrid, BannerFormModal
- `attendance/_components/` → ClockDisplay, CheckInOutButtons, AttendanceHistoryTable
- `access-denied/_components/` → AccessDeniedCard

**กติกาตัดสินที่วาง:**
1. UI ล้วน ไม่มี domain → `components/base/`
2. ใช้ ≥ 2 screen → `components/shared/<concern>/`
3. ใช้ 1 screen → `app/owner/<route>/_components/`
4. **Promotion:** มี consumer ที่ 2 เมื่อไหร่ → ย้าย page-local ขึ้น `shared/`
5. import: `shared`/`base` ใช้ alias `@/components/...` · page-local ใช้ relative `./_components/...`

**วิธีทำ:**
- ต้นทางมี component กระจัดกระจาย: `src/app/components/*` (6 ไฟล์) + JSX inline ในแต่ละ `page.tsx` + `products/formShared.tsx` + `production/components/ProductionOrderForm.tsx` + hooks (`useStaffRoles.ts`, `useProductionData.ts`, `useSalesTransactions.ts`)
- ทำ `docs/COMPONENT_MAP.md`: `component | atomic level | ที่วาง (base/shared/page-local) | ใช้ในหน้าไหนบ้าง | ไฟล์ต้นทางที่สกัดมา`
- component ใน `base/` ที่ wrap antd (Button/Input/Select/DatePicker/Switch/Tag...) = กำหนด prop + ธีมตัวเดียวทั้งแอป ห้ามเรียก antd ตรง ๆ จากหน้า
- hooks ย้ายไป `src/hooks/`
- **เกณฑ์ผ่าน:** (1) ไม่มี literal ข้อความ — ใช้ `t()` ทุกจุด (ดู `I18N_PLAN.md`) · (2) component ที่มี logic จริงต้อง split เป็น View + ViewModel (ดู `CODE_STRUCTURE.md`) · `COMPONENT_MAP.md` เพิ่มคอลัมน์ "split?"

### เฟส 4 — Screens (27 หน้า)
แต่ละหน้า: `page.tsx` (บาง) + `<X>View.tsx` + `use<X>ViewModel.ts` (เว้นหน้าจิ๋ว) — ViewModel เรียก `src/services/*` — ดู `CODE_STRUCTURE.md` + ตารางข้อ 7
- ทำเฉพาะ 27 screen ใน reference (D5) — `orders/readyReders`, `promotions/*`, `reports/*`, `production/planOrPurchaseOrder`, `employees/attendance`, `recipes/addRecipe` = เลื่อนไปเฟสถัดไป
- ข้ามไฟล์ขยะ `production/productionstatus.zip`
- ข้อมูลบนหน้าดึงจาก mock API (D6) จนกว่าจะได้ DB จริง

### เฟส 5 — Global wiring
- `app/layout.tsx` → `<Providers>` (+ `NextIntlClientProvider`)
- `app/login/layout.tsx` → `<AuthLayout>` · `app/owner/layout.tsx` → `<OwnerLayout>` (breadcrumb + `useCurrentUser` + `useIdleTimeout` + `/api/notifications`)
- `app/page.tsx` redirect ตาม session
- `src/proxy.ts`
- `PermissionsProvider` ครอบ owner tree + gate ปุ่ม/เมนูด้วย `usePermission`

### เฟส 6 — Verify
- `npm run lint` · `npm run build` ผ่าน
- รันสคริปต์ lint i18n — ต้องไม่เหลือ literal ข้อความนอก `messages/`
- ตรวจ MVVM: ไม่มี `fetch` / data-loading `useEffect` ในไฟล์ `*View.tsx` หรือ `page.tsx`
- สลับ locale (th ↔ en) เดินครบ 27 screen — ข้อความครบทั้ง 2 ภาษา, antd/dayjs ตามภาษา
- เดินครบ 27 screen เทียบตาราง `MeowMeeCake_Components.html`: component ที่ระบุว่า "หลายหน้า" ต้องมาจาก library ตัวเดียวกันจริง
- auth (ดู `AUTH_PLAN.md` §5): access token หมด → refresh เนียน · idle เกิน → warn → logout · 401 กลางทาง → refresh แล้ว redirect (ไม่ loop) · logout แท็บเดียว → ทุกแท็บออก · `GET /api/*` ไม่มี cookie → 401
- ทวน `docs/MOCKS.md` ว่าครบทุกจุด
- (เมื่อได้ `.env.local` จริง) ถอด mock → เชื่อม DB + seed ข้อมูลทดสอบ (อย่างน้อย 1 role owner + user login ได้)

---

## 5. โครงสร้างปลายทางที่ต้องการ (สรุป)

```
src/
  app/
    layout.tsx · page.tsx · globals.css · providers.tsx
    login/page.tsx
    owner/layout.tsx + 27 หน้า (แต่ละหน้ามี _components/ ของตัวเอง)
    api/ (เท่าต้นทาง)
  i18n/                         ← next-intl: config · request · format · messages/{th,en}.json  (เฟส 0.5)
  lib/                          ← http.ts (axios+interceptor) · authClient.ts · session.ts · dbConnect · createCrudController · omise · alert   (เฟส 2.5)
  services/                     ← 1 ไฟล์/resource — เรียก api (axios) รวมไว้ที่เดียว (ViewModel เรียกใช้)
  components/
    base/                       ← atoms (ไฟล์เดียว) · shared/_components ที่มี logic → split View+ViewModel (D10)
    shared/ layout|data|feedback|stats|charts|form   ← ใช้ ≥ 2 screen
  context/                      ← PermissionsContext
  hooks/                        ← useIdleTimeout · useCurrentUser · shared hooks (เฟส 2.5)
  constants/                    ← menuKeys + enumConfig (สี/flow เท่านั้น ไม่มี label)
  utils/                        ← lib เดิมที่เป็น pure helper (csv, diff, promotion, unit, status)
  mocks/                        ← fixture data ชั่วคราว (D6) — ถอดออกเมื่อได้ DB จริง
  controllers/ models/ types/
  proxy.ts                      ← route guard + (ออปชัน) sliding re-issue cookie
```

---

## 6. Global components (มากับ Layout อัตโนมัติ — ไม่ต้องใส่ซ้ำในหน้า)

| Component | Level | ที่มา |
|---|---|---|
| OwnerLayout | Template | `app/owner/layout.tsx` |
| AuthLayout | Template | ครอบ `app/login` |
| Navbar / Sidebar | Organism | `app/components/navbar.tsx`, `sidebar.tsx` |
| LoadingSpin | Organism | `app/components/LoadingSpin.tsx` |
| ConfirmDeletePopup | Organism | antd `Popconfirm` มาตรฐาน |
| EmptyState | Atom | antd `Empty` + ข้อความไทย |
| PermissionsContext | Context | `app/components/PermissionsContext.tsx` |

---

## 7. ตาราง Screens (27) → route + template + component เฉพาะหน้า

| # | Screen | Route | Template | Component เฉพาะหน้า (unique) |
|---|---|---|---|---|
| 1 | Login | `/login` | AuthLayout | LoginForm, PasswordInput, Logo |
| 2 | Dashboard | `/owner/dashboard` | DashboardPageLayout | RecentOrdersWidget, LowStockWidget, TopProductsWidget, ProductionStatusWidget |
| 3 | Products List | `/owner/products` | ListPageLayout | ProductCard, ProductGrid, CategoryChip, ViewToggle, SortDropdown, RatingDisplay |
| 4 | Add Product | `/owner/products/addProducts` | (form) | ProductFormFields |
| 5 | Edit Product | `/owner/products/[id]/edit` | (form) | ProductFormFields |
| 6 | Product Stock | `/owner/products/productStock` | ListPageLayout | AdjustStockModal, StockProgressRow |
| 7 | Manage Orders | `/owner/orders/manageOrders` | ListPageLayout | OrderStatusFilter, PaymentSlipPreview, OrderLifecycleSteps |
| 8 | POS — In-Store | `/owner/orders/OrderInStore` | (custom 2-pane) | ProductPickerGrid, CartPanel, QRPaymentModal |
| 9 | Ingredients List | `/owner/ingredients` | ListPageLayout | IngredientFormModal |
| 10 | Ingredient Stock Mgmt | `/owner/ingredients/ingredientStock` | (custom) | ReceiveModal, AdjustModal, BulkReceiveModal, IngredientStockCard, AutoCompleteSearch |
| 11 | Ingredient History | `/owner/ingredients/ingredientHistory` | (custom) | TransactionTimeline, HistoryItemCard, AnalyticsBarChart, LogTransactionModal |
| 12 | Manage Units | `/owner/ingredients/units` | (2-col) | UnitListCard, UnitFormModal |
| 13 | Production — Plan | `/owner/production?tab=plan` | TabbedPageLayout | ProductionOrderForm, ProductionStatCards |
| 14 | Production — Status Board | `/owner/production?tab=status` | TabbedPageLayout | KanbanBoard, ProductionOrderCard |
| 15 | Production — History | `/owner/production?tab=history` | TabbedPageLayout | RevenueBarChart, AnalyticsBarChart, TeamPerformanceCard |
| 16 | Recipes | `/owner/recipes` | ListPageLayout (2 tab) | RecipeCard, MainRecipeModal, SubRecipeModal, DetailDrawer, IngredientEditor, StepEditor |
| 17 | Employees List | `/owner/employees` | ListPageLayout | — (ใช้ component กลางล้วน) |
| 18 | Add Employee | `/owner/employees/addEmployee` | (form) | EmployeeFormSections, AvatarUploader, ToggleRow, EmployeeSummaryCard, PasswordShuffleButton |
| 19 | Edit Employee | `/owner/employees/editEmployee` | (form) | + MetaChips, DangerZone |
| 20 | Permissions Mgmt | `/owner/employees/permissions` | (2-pane) | RoleList, PermissionCollapseSection, PermissionCheckboxGroup, RoleFormModal |
| 21 | User Activity Log | `/owner/employees/userLog` | ListPageLayout | DetailDrawer |
| 22 | Attendance | `/owner/attendance` | (custom) | ClockDisplay, CheckInOutButtons, AttendanceHistoryTable |
| 23 | Finance — Expenses | `/owner/finance/expenses` | ListPageLayout | ExpenseForm, CategoryBreakdownBar, RecurringReminderList, MonthSelector, ReceiptImagePreview |
| 24 | Finance — P&L Summary | `/owner/finance/summary` | (custom) | PLStatementTable, KPIStatsRow, RevenueBarChart, ProductRevenueTable, PeriodSelector |
| 25 | Store Design — Banners | `/owner/store-design` | ListPageLayout | BannerCard, BannerFormModal, BannerGrid |
| 26 | Notification History | `/owner/notificationsHistory` | ListPageLayout | DetailDrawer |
| 27 | Access Denied | `/owner/access-denied` | (none) | AccessDeniedCard |

---

## 8. เรื่องที่ต้องตัดสินใจ — **D1–D14 ตัดสินครบแล้ว** (2026-08-31)

| # | หัวข้อ | ตัวเลือก | ผล |
|---|---|---|---|
| D1 | เวอร์ชัน Next/React | (a) คงปลายทาง Next 16.3.3 + React 19  ·  (b) ตรงต้นทาง Next 16.2.6 + React 18 | **(b) — ตัดสินแล้ว: downgrade** ให้ตรงต้นทาง |
| D2 | 5 model ที่ต่าง | — | **ตัดสินแล้ว: ไม่ต่างจริง** (แค่ CRLF vs LF) → normalize เป็น LF + `.gitattributes` |
| D3 | `reactCompiler` | เปิด / ปิด | **ตัดสินแล้ว: เปิด** ตามต้นทาง (`reactCompiler: true` + `babel-plugin-react-compiler@1.0.0`) |
| D4 | Tailwind / `@material-tailwind/react` | เก็บ / ตัด | **ตัดสินแล้ว: Tailwind ล้วน ไม่เอา `@material-tailwind/react`** — dead dep ในต้นทาง + v2 ไม่รองรับ Tailwind v4 + ซ้ำกับ antd · custom/visual component → Tailwind utility, data/form → antd (base/) |
| D5 | ขอบเขต route | ต้นทางมีหน้าเกินจาก reference: `promotions/{pricing,coupons,bundles}`, `reports/{sales,reviews}`, `production/planOrPurchaseOrder`, `orders/readyReders`, `employees/attendance`, `recipes/addRecipe` | **ตัดสินแล้ว: ทำ 27 screen ใน reference ก่อน** · หน้าที่เกิน = เฟสถัดไป (นอกขอบเขตรอบนี้) |
| D6 | `.env.local` / DB | ผู้ใช้จะส่ง `MONGODB_URI`, `JWT_SECRET` ฯลฯ ทีหลัง | **ตัดสินแล้ว: mock ไปก่อน** — ทำ mock data layer + บันทึกทุกจุดที่ mock ใน `docs/MOCKS.md` แล้วถอด mock เมื่อได้ค่าจริง |
| D7 | ที่เก็บเอกสาร plan | `docs/` ในโปรเจกต์ปลายทาง | ใช้ `docs/` |
| D8 | โครงสร้าง component | (a) Atomic folder เต็มรูป · (b) reuse-based: `base/` + `shared/` + page-local `_components/` | **(b)** — ตัดสินแล้ว ดูเฟส 3 |
| D9 | i18n | ไลบรารี + วิธีจัดการ DB-enum ที่เก็บค่าไทย | **`next-intl` (no URL routing, cookie `mmc_locale`)** · DB-enum = **แนวทาง A** (คงค่าใน DB, map ตอนแสดงผ่าน `t('enums.*')`) — ดู `I18N_PLAN.md` |
| D10 | โครงโค้ดใน screen/component | flat / MVVM | **MVVM: `page.tsx` (บาง) + `<X>View.tsx` + `use<X>ViewModel.ts`** · split component เมื่อมี logic จริง · `src/services/<resource>.ts` แยก fetch — ดู `CODE_STRUCTURE.md` |
| D11 | Session timeout | A: client idle · B: short token + sliding refresh + absolute cap | **ตัดสินแล้ว: B** · access 30 นาที · absolute cap 8 ชม. · refresh throttle 5 นาที · warn 60 วิ ก่อนหมด — ดู `AUTH_PLAN.md` |
| D12 | Interceptor เมื่อเจอ 401 | redirect ทันที / ลอง refresh ก่อน | **ตัดสินแล้ว: ลอง refresh ก่อน** แล้วค่อย redirect `/login?reason=expired` (กัน loop) · toast = `lib/alert.ts` |
| D13 | cookie `sameSite` | lax / strict | **ตัดสินแล้ว: คง `lax`** (ตามต้นทาง) |
| D14 | GET API guard | เปิดโล่ง (เดิม) / เพิ่ม session+view check | **ตัดสินแล้ว: เพิ่ม** `requireSession` ทุก GET + `can_view` เมื่อ route มี `menuKey` |

---

## 9. ความเสี่ยง / ข้อควรระวัง

- **Next.js เวอร์ชันนี้ต่างจากที่รู้จัก** — ต้องอ่าน `node_modules/next/dist/docs/` ก่อนแตะโค้ด (กฎใน `AGENTS.md`); จุดที่มักเปลี่ยน: `proxy.ts` แทน `middleware.ts`, `params`/`searchParams` เป็น `Promise`, `LayoutProps<"/route">` / `PageProps<>` generated types
- ~~antd v6 + React 19 peer-dep~~ → แก้แล้วด้วย D1 (downgrade เป็น React 18.3.1 ตรงต้นทาง)
- `reactCompiler: true` (D3) ทำให้ Next ใช้ Babel แทน SWC ในการ compile — build ช้าลงบ้าง เป็นเรื่องปกติ
- **D6 mock:** โค้ด backend port มาเต็ม แต่รันด้วย fixture — ตอนถอด mock ต้องเทสว่า query จริง/index/`.populate()` ทำงาน · ทุกจุด mock ต้องอยู่ใน `docs/MOCKS.md` และ `grep`-หาได้ (คอมเมนต์ `// MOCK:`)
- component ต้นทางผูกกับ CSS class ใน `globals.css` (`.sidebar`, `.navbar`, `.stat-card` ฯลฯ) — ต้อง port CSS ให้ครบพร้อม component
- `src/app/components/` (ต้นทาง) → ย้ายไป `src/components/shared/` หรือ page-local ทั้งหมด (อย่าสร้าง `src/app/components/` ในปลายทาง)
- base64 image ใน `productModel` — controller ต้นทางตัด `product_img` ออกจาก list query (`listOnlyExcludeFields`) ต้องคงพฤติกรรมนี้
- ไฟล์ขยะในต้นทาง: `production/productionstatus.zip`, route พิมพ์ผิด `readyReders` (นอกขอบเขต D5)

---

## 10. ลำดับลงมือ (D1–D14 ตัดสินครบแล้ว — พร้อมเริ่ม)

1. **เฟส 0** — downgrade + install deps (+`axios` +`next-intl`) + `reactCompiler` + อ่าน `node_modules/next/dist/docs/`
2. **เฟส 0.5** — i18n foundation: `src/i18n/` + provider wiring + ย้าย label map + `format.ts` + locale switcher
3. **เฟส 1** — normalize models + `.gitattributes` + จัดระเบียบ `types/` + `dbConnect` + `src/mocks/` + `MOCKS.md`
4. **เฟส 2** — lib + controllers + api + proxy + auth hardening (D14) + mock fallback
5. **เฟส 2.5** — auth & HTTP: `http.ts` (axios+interceptor) + `authClient` + `/api/auth/refresh` + `useIdleTimeout`/`useCurrentUser` + `AuthLayout`/`OwnerLayout` + cross-tab
6. **เฟส 3** — component library `base/` + `shared/` + `COMPONENT_MAP.md`
7. **เฟส 4** — 27 screen ทีละกลุ่ม (Auth → Dashboard → Products → Orders → Ingredients → Production → Recipes → Employees → Finance → Store/Notif)
8. **เฟส 5** — global wiring → **เฟส 6** — verify
