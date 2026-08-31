# แผน Authentication / Session / HTTP layer

> ตรวจของเดิมในต้นทาง `-MeowMeeCake-NextJS5` + วางแผนส่วนที่ต้องเพิ่ม (axios/interceptor, session timeout)

---

## 1. ของเดิมในต้นทาง (as-is)

### 1.1 JWT / session — `src/lib/session.ts`
| รายการ | ค่า |
|---|---|
| Cookie | `mmc_session` · `httpOnly` · `secure` (prod) · `sameSite=lax` · `path=/` |
| Token | JWT เซ็นด้วย `JWT_SECRET` |
| Payload | `{ userId, roleId, roleType, email, fullname }` |
| อายุ token | `JWT_EXPIRE` (default **7d**) |
| อายุ cookie | `JWT_COOKIE_EXPIRE` วัน (default 7) → `maxAge` |
| helper | `signSession`, `verifySession` (คืน `null` ไม่ throw), `setSessionCookie`, `clearSessionCookie` |
| **ไม่มี** | refresh token · sliding expiry · idle/inactivity timeout · token rotation |

### 1.2 Login — `POST /api/auth/login`
- bcrypt compare + fallback plaintext เก่า → auto-upgrade เป็น hash (`pre("save")` / `pre("findOneAndUpdate")` ใน `userModel`)
- brute-force: `failed_login_attempts` ≥ 5 → ล็อก `lockout_until` 15 นาที
- ตรวจ: user มีจริง · `auth_provider==="local"` · มี password · `is_active` · ไม่ถูกล็อก · `role_type !== "customer"`
- error รวม (`"อีเมลหรือรหัสผ่านไม่ถูกต้อง"`) กัน user-enumeration
- สำเร็จ → set `last_login_at`, reset counter, ออก session cookie
- IP: `getClientIp` อ่าน `cf-connecting-ip` / `x-forwarded-for` / `x-real-ip` (ใช้ใน audit log)

### 1.3 Logout — `POST /api/auth/logout`
- clear cookie อย่างเดียว (ไม่มี server-side blacklist)

### 1.4 Me — `GET /api/auth/me`
- `verifySession(cookie)` → 401 ถ้าไม่มี/ไม่ผ่าน
- คืน `{ id, email, fullname, roleId, roleName, menuAccess }` — `menuAccess` = สิทธิ์ทั้ง 5 action ของทุก menu_key (`getFullMenuAccessMap`, owner/admin = full, permission มี `expires_at` ได้)

### 1.5 Route guard — `src/proxy.ts` (Next 16 "proxy" = middleware เดิม, รัน Node runtime)
- `matcher: ["/owner/:path*", "/login"]`
- `/owner/*` ไม่มี session → redirect `/login?next=<path>`
- แล้วเช็ค `can_view` ต่อ route: `resolveMenuKey(pathname)` → `canViewMenu(roleId, menuKey)` → ไม่ผ่าน redirect `/owner/access-denied` (owner/admin ข้าม · `/owner/access-denied` ยกเว้น)
- `/login` ขณะ login อยู่ → redirect `/owner/dashboard`

### 1.6 API-level enforcement — `src/lib/createCrudController.ts`
- `requirePermission(req, menuKey, action)` เรียกใน **POST / PATCH / DELETE** → 401 ถ้าไม่มี session · 403 ถ้า role ไม่มี `can_<action>` (owner/admin ข้าม · permission `expires_at` ได้)
- ⚠️ **`GET` (getAll/getById) ไม่มีการเช็ค session/permission เลย** — `GET /api/products` เปิดโล่ง (ป้องกันแค่หน้าเว็บผ่าน proxy)

### 1.7 Layout
| ไฟล์ | บทบาท | auth |
|---|---|---|
| `app/layout.tsx` | shell สาธารณะ (`<html><body><Providers>`) | ไม่มี |
| `app/login/page.tsx` | หน้า login (client, `fetch("/api/auth/login")`) | redirect ออกถ้า login แล้ว (ผ่าน proxy) |
| `app/owner/layout.tsx` | shell ที่ถูกป้องกัน (client) — `fetch("/api/auth/me")` (401 → `/login`), โหลด notifications, render Sidebar+Navbar+PermissionsProvider | proxy = ตัวจริง, layout = re-check ฝั่ง client เพื่อ UX + โหลด user/menu |
| `app/page.tsx` | server — `verifySession(cookie)` → redirect `/owner/dashboard` หรือ `/login` | — |

### 1.8 HTTP
- **ไม่มี axios** — ต้นทางใช้ `fetch()` ล้วน ~36 จุด
- ไม่มี interceptor รวมศูนย์ · จัดการ error/401 กระจายในแต่ละ call site
- Google OAuth: env มี `GOOGLE_CLIENT_*`, `NEXTAUTH_*` แต่ **ไม่มี route/next-auth จริง** → ยังไม่ implement

---

## 2. สิ่งที่ต้องเพิ่ม / ปรับ (รอบนี้)

### 2.1 Public / Protected layout — ทำให้เป็น template ชัดเจน (ตรง `MeowMeeCake_Components.html`)
```
components/shared/layout/
  AuthLayout.tsx        # centered, ไม่มี Sidebar/Navbar — ครอบ /login (+ อนาคต /forgot-password, /reset-password)
  OwnerLayout.tsx       # protected shell — Sidebar + Navbar + PermissionsProvider + IdleTimeout
app/
  login/layout.tsx      # = <AuthLayout>
  owner/layout.tsx      # = <OwnerLayout>  (client, โหลด /api/auth/me)
```
**3 ชั้นป้องกัน (ยึดของเดิม + เสริม):**
1. `proxy.ts` — source of truth ของการเข้าหน้า (`can_view`) — เพิ่ม sliding-refresh (2.3)
2. `OwnerLayout` — client re-check `/api/auth/me` (UX + user/menu) + idle timeout (2.3)
3. API — `requirePermission` สำหรับ mutation + **เพิ่ม `requireSession`/`can_view` ให้ GET** (2.4)

### 2.2 axios + interceptor — `src/lib/http.ts`  (client-only)
```ts
export const api = axios.create({ baseURL: "/api", timeout: 15000, withCredentials: true });
```
**request interceptor**
- แนบ `Accept-Language` = locale ปัจจุบัน (จาก i18n) → ให้ API ตอบ error เป็นภาษาเดียวกัน
- (ถ้าเพิ่ม CSRF ภายหลัง) แนบ token
- cookie `mmc_session` ส่งอัตโนมัติ (httpOnly) — ไม่ต้องแนบ `Authorization`

**response interceptor**
| กรณี | การจัดการ |
|---|---|
| success | unwrap → คืน `res.data` (`{ data, meta }`) |
| **401** | ล้าง client user state · broadcast logout (ทุกแท็บ) · redirect `/login?next=<path>&reason=expired` · กัน loop บน `/login` + `/api/auth/*` · (ถ้าเปิด refresh strategy → ลอง refresh ก่อน — 2.3) |
| **403** | toast `t("errors.forbidden")` · (ออปชัน) redirect `/owner/access-denied` |
| 409 / 422 | โยน `message` จาก body ให้ caller (form validation) |
| 429 | toast ข้อความ rate-limit |
| 5xx / network / timeout | toast `t("errors.network")` แล้ว reject |
- retry 1 ครั้งบน network error / 502–504 (backoff) — ออปชัน
- **single-flight refresh**: 401 → เข้าคิว request, เรียก `/api/auth/refresh` ครั้งเดียว, replay คิว; refresh ล้มเหลว → logout
- `src/services/<resource>.ts` เรียก `api` แทน `fetch` (ผูกกับ `CODE_STRUCTURE.md` D10)
- **ฝั่ง server** (RSC / route handler / proxy) ไม่ใช้ axios — ใช้ `verifySession` + mongoose ตรง ๆ ตามเดิม

### 2.3 Session timeout  (ความต้องการใหม่)
**2 แบบ — เลือกตาม D11:**
| แบบ | กลไก | ข้อดี | ข้อเสีย |
|---|---|---|---|
| A. client-only idle | hook `useIdleTimeout` ใน `OwnerLayout` จับ activity (mousemove/keydown/click/scroll, throttle) → หมดเวลา → warn modal → `POST /logout` + redirect | ทำง่าย | ไม่บังคับฝั่ง server (เปิดแท็บทิ้งไว้ token ยังใช้ได้ถึง 7d) |
| **B. short token + sliding refresh + absolute cap** ← แนะนำ | access token สั้น (เช่น **30 นาที**) · client เรียก `POST /api/auth/refresh` เมื่อมี activity (throttle ~5 นาที) → ออก token ใหม่ · refresh เช็ค `absExp` (เช่น **8 ชม.** จาก login แรก) + user ยัง `is_active`/ไม่ถูกลบ · หยุด refresh → token ตายใน ≤30 นาที = idle timeout จริงที่ server บังคับ | server บังคับได้จริง · ยังมี absolute cap | โค้ดมากกว่า |

**ประกอบทั้ง 2 แบบ:**
- warn modal ก่อนหมด ~60 วินาที: `t("auth.sessionExpiring")` → "ทำงานต่อ" (เรียก refresh) / "ออกจากระบบ"
- redirect ตอนหมด: `/login?reason=timeout` (login page แสดงข้อความว่า session หมดอายุ)
- **cross-tab**: `BroadcastChannel("mmc-auth")` — logout/refresh แท็บเดียว sync ทุกแท็บ
- **`visibilitychange`**: กลับมาโฟกัสแท็บ → เรียก `/api/auth/me` ทันที, 401 → redirect
- `proxy.ts`: ถ้าใช้แบบ B — เพิ่ม re-issue cookie ตอน token เหลืออายุ < ครึ่ง (sliding) ก็ได้ หรือปล่อยให้ `/api/auth/refresh` จัดการอย่างเดียว

**payload เพิ่ม (แบบ B):** `{ ...เดิม, absExp: <epoch> }` · `/api/auth/refresh` = ตรวจ session ปัจจุบัน + `absExp > now` + reload user → `signSession` ใหม่ (คง `absExp` เดิม) → `setSessionCookie`

### 2.4 API session hardening
- เพิ่ม `requireSession(req)` (401 ถ้าไม่มี session ที่ valid) — เรียกใน `getAll` / `getById` ของ `createCrudController`
- ให้ GET ที่มี `menuKey` เช็ค `requirePermission(req, menuKey, "view")` ให้ตรงกับ proxy
- `/api/auth/login`: เพิ่ม throttle ราย IP (นอกเหนือ lockout ราย user) ใช้ `getClientIp` + in-memory/short-TTL store
- พิจารณา `sameSite=strict` สำหรับ cookie (ปัจจุบัน `lax`) — strict ปลอดภัยกว่าแต่ลิงก์ข้ามเว็บมาจะไม่ติด session; คงไว้ `lax` เว้นแต่มีเหตุ

### 2.5 i18n ข้อความ auth (ผูกกับ `I18N_PLAN.md`)
- ย้ายข้อความไทย hardcode ใน `login/route.ts`, `me`, proxy redirect reason, lockout → `messages/*/auth`, `messages/*/validation`, `messages/*/errors`

### 2.6 Google OAuth
- **นอกขอบเขตรอบนี้** (D5 = 27 screen ใน reference; Login มีแค่ email+password)
- คง field `auth_provider` + login ปฏิเสธบัญชี google ด้วยข้อความ stub
- อนาคต: `next-auth`/`@auth/core` หรือ hand-rolled `/api/auth/google/{start,callback}`

### 2.7 Mock mode (D6)
- ไม่มี DB → `/api/auth/login` รับ credential dev คงที่ 1 ชุด → ออก JWT จริงให้ mock owner user
- `/api/auth/me` คืน mock user + `menuAccess` = full · `/api/auth/refresh` ทำงานปกติ
- บันทึกใน `MOCKS.md`

---

## 3. ไฟล์ที่เกี่ยวข้อง (port / สร้างใหม่)

| ไฟล์ | สถานะ | หมายเหตุ |
|---|---|---|
| `src/lib/session.ts` | port + เพิ่ม `absExp` (ถ้า D11=B) | |
| `src/proxy.ts` | port + (ออปชัน) sliding re-issue | |
| `src/app/api/auth/login/route.ts` | port + IP throttle + i18n | |
| `src/app/api/auth/logout/route.ts` | port | + broadcast ฝั่ง client |
| `src/app/api/auth/me/route.ts` | port + i18n | |
| `src/app/api/auth/refresh/route.ts` | **ใหม่** (ถ้า D11=B) | |
| `src/lib/http.ts` | **ใหม่** | axios instance + interceptor |
| `src/lib/authClient.ts` | **ใหม่** | `login()`, `logout()`, `refresh()`, `broadcastLogout()`, redirect helper |
| `src/hooks/useIdleTimeout.ts` | **ใหม่** | จับ activity + warn + หมดเวลา |
| `src/hooks/useCurrentUser.ts` | **ใหม่** | อ่าน `/api/auth/me` + cache + revalidate on focus |
| `src/context/PermissionsContext.tsx` | port | `usePermission(key)` |
| `components/shared/layout/AuthLayout.tsx` | **ใหม่** (จาก JSX ใน `login/page.tsx`) | |
| `components/shared/layout/OwnerLayout.tsx` | port จาก `app/owner/layout.tsx` | + `useIdleTimeout` |
| `src/lib/createCrudController.ts` | port + `requireSession` ใน GET | |
| `src/services/*.ts` | **ใหม่** | ใช้ `api` (axios) |

---

## 4. การตัดสินใจ — **ยืนยันแล้ว 2026-08-31**

| # | หัวข้อ | ผล |
|---|---|---|
| D11 | Session timeout | **B: short access token + sliding refresh + absolute cap** · access **30 นาที** · absolute cap **8 ชม.** · refresh throttle **5 นาที** · warn **60 วิ** ก่อนหมด |
| D12 | Interceptor 401 | **ลอง refresh ก่อน** แล้วค่อย redirect `/login?reason=expired` (กัน loop บน `/login` + `/api/auth/*`) · toast = `lib/alert.ts` (sweetalert2) |
| D13 | cookie `sameSite` | คง **`lax`** |
| D14 | GET API guard | **เพิ่ม** `requireSession` ทุก GET · `requirePermission(req, menuKey, "view")` เมื่อ route มี `menuKey` |

---

## 5. เชื่อมกับ REBUILD_PLAN

- **เฟส 2** — port auth API + `requireSession` ใน GET + IP throttle (D14)
- **เฟส 2.5 (ใหม่) — Auth & HTTP foundation** (หลัง backend, ก่อน component library):
  1. `src/lib/http.ts` (axios + interceptor) + `src/lib/authClient.ts`
  2. `/api/auth/refresh` + `session.ts` `absExp` (D11=B)
  3. `useIdleTimeout`, `useCurrentUser`
  4. `AuthLayout` / `OwnerLayout` templates + `login/layout.tsx`
  5. cross-tab `BroadcastChannel` + `visibilitychange` revalidate
- **เฟส 5 (wiring)** — proxy + PermissionsProvider + gate ปุ่มด้วย `usePermission` (เดิม)
- **เฟส 6 (verify)** — เทส: หมด access token → refresh เนียน · idle เกิน → warn → logout · 401 กลางทาง → redirect + กัน loop · logout แท็บเดียว → ทุกแท็บออก · GET API ไม่มี cookie → 401
