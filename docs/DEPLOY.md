# Deploy บน VPS — MeowMeeCake Backend

> สร้าง: 2026-10-01 · ใช้กับชุด PR #52 #53 #54 #55 #56 · สิ่งที่ต้องทำก่อนใช้งานจริงทั้งหมด → [`BACKLOG4.md`](BACKLOG4.md) §1
> ตัวอย่างในเอกสารนี้ใช้ `api.example.com` (backend) และ `app.example.com` (frontend) — **แทนด้วยโดเมนจริง**

---

## 0. ภาพรวม

```
 ① เตรียมเซิร์ฟเวอร์ ─▶ ② เตรียมก่อนวัน deploy ─▶ ③ merge PR ─▶ ④ ตั้ง .env.local ─▶ ⑤ build + รัน (pm2)
     (ครั้งแรกครั้งเดียว)    (DNS, backup, LINE, secret)                                          │
                                                                                                    ▼
 ⑨ ตรวจรับ ◀── ⑧ ตั้ง cron 3 ตัว ◀── ⑦ งานข้อมูลหลัง deploy ◀── ⑥ nginx + HTTPS (ครั้งแรก)
```

| องค์ประกอบ | ใช้อะไร |
|---|---|
| OS | Ubuntu 22.04 / 24.04 LTS |
| Node.js | **22** (ตรงกับ CI — `.github/workflows/ci.yml`) |
| รันแอป | `next start` ผ่าน **pm2** (รีสตาร์ทเองเมื่อพัง / บูตเครื่อง) ฟังที่ `127.0.0.1:3000` เท่านั้น |
| หน้าบ้าน | **nginx** (reverse proxy + HTTPS จาก Let's Encrypt + **เสิร์ฟไฟล์ `/uploads/` เอง** — §6 ⚠️) |
| ฐานข้อมูล | MongoDB Atlas (ตัวเดิม) |
| ตั้งเวลา | crontab ของ user ที่รันแอป |

⚠️ **ด่วน:** DB จริงถูก migrate เป็น `is_preorder` แล้ว (2026-10-01 00:11) — โค้ด `main` ปัจจุบันใช้กับ DB นี้ไม่ได้ ทำ ③–⑤ ให้จบในวันเดียว

---

## ① เตรียมเซิร์ฟเวอร์ (ครั้งแรกครั้งเดียว)

```bash
# user แยกสำหรับรันแอป (ไม่รันด้วย root)
sudo adduser --disabled-password --gecos "" meowmee
sudo apt update && sudo apt install -y git nginx certbot python3-certbot-nginx ufw

# Node 22 (NodeSource) + pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# firewall: เปิดแค่ SSH + HTTP/HTTPS (พอร์ต 3000 ไม่เปิดออกนอกเครื่อง)
sudo ufw allow OpenSSH && sudo ufw allow "Nginx Full" && sudo ufw enable

# โฟลเดอร์
sudo mkdir -p /srv/meowmeecake/private && sudo chown -R meowmee:meowmee /srv/meowmeecake
sudo -iu meowmee git clone https://github.com/ThanyalakSasen/NextJS-MeowMeeCake.git /srv/meowmeecake/app
```

| path | เก็บอะไร | สำรอง? |
|---|---|---|
| `/srv/meowmeecake/app` | โค้ด (git) + `.env.local` + `public/uploads/` (รูปสินค้า/แบนเนอร์/ใบเสร็จ) | ✅ `public/uploads/` + `.env.local` |
| `/srv/meowmeecake/private` | สลิปโอนเงิน (ไฟล์ส่วนตัว — `PRIVATE_UPLOAD_DIR`, [`uploads.md`](uploads.md) §6) | ✅ |
| `/srv/meowmeecake/logs` | log ของ cron | — |

`git pull` ไม่ลบไฟล์ใน `public/uploads/` (อยู่ใน `.gitignore`) — รูปที่อัปโหลดไว้อยู่รอดข้ามการ deploy

**MongoDB Atlas:** Network Access → เพิ่ม **IP ของ VPS** (ไม่งั้นต่อ DB ไม่ได้ `/api/health` = 503)

---

## ② เตรียมก่อนวัน deploy

- [ ] **DNS:** A record `api.example.com` → IP ของ VPS (frontend `app.example.com` ตามที่ host frontend)
- [ ] **สำรอง DB:** Atlas → Backup/Snapshot หรือ `mongodump --uri "<MONGODB_URI>" --out backup-$(date +%F)`
- [ ] **LINE Developers Console:** LINE Login channel `2011804283` → แท็บ **LINE Login** → Callback URL เพิ่ม
      `https://api.example.com/api/shop/me/line/callback` (เก็บ localhost ไว้ใช้ dev ได้) — [`LINE.md`](LINE.md) §4, §6.1
- [ ] **สร้าง secret ใหม่** (คนละค่ากับ dev ทุกตัว): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      → `JWT_SECRET`, `SESSION_SECRET`, `NEXTAUTH_SECRET`, `CRON_SECRET`
- [ ] แจ้งทีม frontend: `NEXT_PUBLIC_API_URL` (หรือชื่อที่ใช้) = `https://api.example.com` + งานฝั่ง frontend ใน [`BACKLOG4.md`](BACKLOG4.md) §4

---

## ③ merge PR ตามลำดับ (รอ CI ผ่านทุกขั้น)

```
#56 postcss override ────────────────────────────▶ main   (ไม่ชนกับใคร)
#52 is_preorder + เลขออเดอร์ ────────────────────▶ main   ✔ ติ๊ก "Delete branch"
     └─ #53 แจ้งเตือน LINE (base ย้ายเป็น main เอง) ─▶ main   ✔ Delete branch
           └─ #55 รอบพรีออเดอร์ (base ย้ายเป็น main เอง) ─▶ main
#54 สลิป/ไฟล์ ── merge main เข้า branch ก่อน → แก้ conflict 2 ไฟล์ ─▶ main
                 package.json (scripts) + .env.example (ท้ายไฟล์) — เก็บของทั้งสองฝั่ง
#57 Y7–Y11 + เงินเป็นบาท (base #55) ──────────────▶ main   (หลัง #55)
```

⚠️ ตอนแก้ conflict `package.json` ระหว่าง #54 กับ #57: ใช้ฝั่ง #57 แล้วเพิ่มแค่ `"migrate:upload-files"` —
**ห้ามเก็บ `"migrate:money-to-satang"`** (#57 ลบแล้ว · ระบบเก็บเงินเป็นบาท — [`money-units.md`](money-units.md)) · `.env.example` เก็บทั้งสองฝั่ง

ไม่ได้ติ๊กลบ branch → เปลี่ยน base ของ PR ถัดไปเป็น `main` เอง · ตรวจรวมทุก PR แล้ว (BACKLOG4 §1 R1): unit 223 · integration 271 · build ✅

---

## ④ ตั้ง `.env.local` บนเซิร์ฟเวอร์

ไฟล์ `/srv/meowmeecake/app/.env.local` — ทั้ง `next start` และสคริปต์ (`npm run …`) อ่านไฟล์นี้ · **ห้าม commit**

```bash
sudo -iu meowmee
cd /srv/meowmeecake/app && nano .env.local && chmod 600 .env.local
```

```env
# ── จำเป็น ──
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>
JWT_SECRET=<สุ่มใหม่>
JWT_EXPIRE=7d
JWT_COOKIE_EXPIRE=7
SESSION_SECRET=<สุ่มใหม่>
NEXTAUTH_SECRET=<สุ่มใหม่>
NEXTAUTH_URL=https://api.example.com

# ── frontend / cookie (docs/security-hardening.md §3) ──
ALLOWED_ORIGINS=https://app.example.com
COOKIE_DOMAIN=.example.com

# ── ไฟล์อัปโหลด ──
# ไม่ตั้ง UPLOAD_DRIVER = localDisk (public/uploads/) — ถูกแล้วสำหรับ VPS
PRIVATE_UPLOAD_DIR=/srv/meowmeecake/private

# ── LINE (docs/LINE.md §3) ──
LINE_CHANNEL_ACCESS_TOKEN=<ค่าเดิมที่ใช้งานได้>
LINE_TARGET_ID=<ค่าเดิม>
LINE_LOGIN_CHANNEL_ID=2011804283
LINE_LOGIN_CHANNEL_SECRET=<ค่าของ channel 2011804283>
LINE_LOGIN_CALLBACK_URL=https://api.example.com/api/shop/me/line/callback
LINE_LINK_RETURN_URL=https://app.example.com/profile
ADMIN_APP_URL=https://app.example.com          # ลิงก์ 🔗 ท้ายข้อความ LINE ถึงร้าน (LINE.md §9.12)

# ── cron (สคริปต์ npm ไม่ต้องใช้ แต่ตั้งไว้เผื่อเรียกผ่าน HTTP) ──
CRON_SECRET=<สุ่มใหม่>

# ── ไม่บังคับ (ค่าเริ่มต้นในวงเล็บ) ──
# PREORDER_PAYMENT_DEADLINE_HOURS=     (24)
# PREORDER_REMINDER_DAYS_BEFORE=       (1)
# LINE_OWNER_QUOTA_RESERVE=            (30)
# LINE_NOTIFY_POS_ORDERS=              (ไม่ส่ง LINE ออเดอร์หน้าร้าน)
# GOOGLE_CLIENT_ID= · EMAIL_SERVICE= · EMAIL_USER= · EMAIL_PASS=
```

ตัวแปรทั้งหมด + ความหมาย → [`env.md`](env.md)

---

## ⑤ build + รันด้วย pm2

```bash
sudo -iu meowmee
cd /srv/meowmeecake/app
git checkout main && git pull
npm ci
npm run build

# ครั้งแรก: ฟังแค่ 127.0.0.1 (ให้ nginx เป็นทางเข้าทางเดียว)
pm2 start npm --name meowmeecake-api -- run start -- -H 127.0.0.1 -p 3000
pm2 save
pm2 startup systemd -u meowmee --hp /home/meowmee   # ทำตามคำสั่งที่ pm2 พิมพ์ออกมา (ต้อง sudo)

curl -s http://127.0.0.1:3000/api/health             # → {"ok":true,"db":"connected"}
```

> ⚠️ **รัน instance เดียวเท่านั้น (BACKLOG4 Y8)** — ห้าม `pm2 start ... -i max` / `-i 2` / `exec_mode: cluster`
> rate limit (`src/lib/rateLimit.ts`) · permission cache (30 วิ) · delivery-zone cache · cache โควตา LINE
> (`src/lib/lineQuota.ts`) เก็บในหน่วยความจำของ process — หลาย instance = rate limit หลวมเป็น N เท่า, สิทธิ์ที่เพิ่งถอน
> ยังใช้ได้ใน instance อื่นจน cache หมดอายุ, โควตา LINE ถูกตัดสินจากตัวเลขคนละชุด · ถ้าแอปตรวจพบว่ารันหลาย instance
> จะเขียน log `runtime.multi_instance` ตอนเริ่ม (`src/instrumentation.ts`) — ร้านขนาดนี้ instance เดียวรับได้สบาย
> ถ้าวันหนึ่งต้องขยายจริง ให้ย้าย 4 จุดนี้ไป Redis ก่อน (แก้เฉพาะไฟล์ละตัว)

**deploy รอบถัด ๆ ไป:**

```bash
cd /srv/meowmeecake/app && git pull && npm ci && npm run build && pm2 reload meowmeecake-api
```

---

## ⑥ nginx + HTTPS (ครั้งแรก)

> ⚠️ **สำคัญ — พบตอนเตรียมเอกสารนี้ (2026-10-01, ทดสอบจริง):** `next start` **ไม่เสิร์ฟไฟล์ที่ถูกเขียนลง `public/` หลัง build**
> (ไฟล์ใหม่ใน `public/uploads/` → **404** · ไฟล์ที่มีอยู่ตอน build เช่น favicon → 200) — ใน `npm run dev` ใช้ได้ปกติ จึงไม่เคยเห็นปัญหา
> ระบบนี้เขียนรูปสินค้า/แบนเนอร์/ใบเสร็จลง `public/uploads/` ตอนรัน → **ต้องให้ nginx เสิร์ฟ `/uploads/` เองจากดิสก์**
> (บล็อก `location /uploads/` ด้านล่าง) ไม่งั้นรูปที่อัปโหลดหลัง deploy จะเปิดไม่ได้ทั้งหมด — BACKLOG4 R6

`/etc/nginx/sites-available/meowmeecake-api`

```nginx
server {
    listen 80;
    server_name api.example.com;

    # รูปสินค้า 8 ไฟล์ × 5 MB ต่อคำขอ (src/lib/upload.ts) + เผื่อ
    client_max_body_size 45m;

    # ไฟล์อัปโหลดสาธารณะ (สินค้า / แบนเนอร์ / ใบเสร็จ) — nginx เสิร์ฟเองจากดิสก์ (next start เสิร์ฟไฟล์ใหม่ไม่ได้)
    location /uploads/ {
        alias /srv/meowmeecake/app/public/uploads/;
        access_log off;
        expires 7d;
        add_header X-Content-Type-Options nosniff;
        # สลิปไม่อยู่ที่นี่แล้ว (PR #54 — ไฟล์ส่วนตัว) · กันไฟล์ตกค้างรุ่นเก่า
        location ^~ /uploads/slips/ { return 404; }
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # "ตั้งทับ" ไม่ "ต่อท้าย" — src/lib/request.ts อ่าน IP ตัวแรกของ X-Forwarded-For (ใช้ทำ rate limit)
        # ถ้าต่อท้าย ($proxy_add_x_forwarded_for) ผู้ใช้ปลอม IP ตัวแรกได้ = หลบ rate limit ได้
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/meowmeecake-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.example.com          # HTTPS + ต่ออายุอัตโนมัติ
# nginx (www-data) ต้องอ่าน public/uploads ได้
sudo chmod o+x /srv /srv/meowmeecake /srv/meowmeecake/app /srv/meowmeecake/app/public
```

---

## ⑦ งานข้อมูลหลัง deploy (รันบนเซิร์ฟเวอร์ — ใช้ `.env.local` ของ production)

```bash
cd /srv/meowmeecake/app
npm run migrate:upload-files              # 1) ดูแผน: แบนเนอร์ 11 · สลิปไม่มีไฟล์ 5 · ใบเสร็จไม่มีไฟล์ 3
npm run migrate:upload-files -- --apply   # 2) ย้ายแบนเนอร์ base64 เป็นไฟล์ (backup ใน scripts/backups/)
```

3) แก้สินค้า 2 ตัวที่รหัสยังเป็น `pos-` (ล็อกอินเป็น owner แล้วเรียก):

```
PATCH https://api.example.com/api/admin/products/6a814a054b44d4bf31fb2c49   { "is_preorder": true }
PATCH https://api.example.com/api/admin/products/6a814a064b44d4bf31fb2c4b   { "is_preorder": true }
```
→ รหัสเปลี่ยนเป็น `pre-…` · ⚠️ ป้าย/บาร์โค้ดที่พิมพ์ไว้ต้องพิมพ์ใหม่

- ✅ `migrate:is-preorder` **ไม่ต้องรัน** — รันไปแล้ว 2026-10-01 00:11 (BACKLOG4 R2)
- ลูกค้า 3 รายที่สลิป `pending` ไม่มีไฟล์ → แจ้งให้แนบใหม่ ([`uploads.md`](uploads.md) §3.3)
- กำหนดชำระของพรีออเดอร์เก่า (BACKLOG4 Y7): `npm run backfill:payment-due` (dry-run) — ตรวจ 2026-10-01 ได้ 0 รายการ
  ไม่ต้อง `--apply` · ถ้าวัน deploy มีพรีออเดอร์ค้างจ่ายที่ยังไม่มีกำหนด ค่อย `-- --apply` (รายการที่เลยกำหนดแล้วจะได้ + 24 ชม.)
- ตรวจข้อมูลสินค้า (BACKLOG4 Y11): `npm run check:data-integrity -- --no-notify` → ต้องได้ "ไม่พบข้อมูลผิดปกติ" ก่อนเปิดร้าน
- ⚠️ **ย้ายหน่วยเงินเป็นบาท (BACKLOG4 R7 · [`money-units.md`](money-units.md)) — ต้องทำพร้อม deploy โค้ด #57:**
  ```bash
  # หยุด backend (pm2 stop meowmeecake-api) + FrontOffice ก่อน
  npm run migrate:money-to-baht              # ดูแผน: ÷100 347 ค่า · ไม่แตะ 75 · ต้องดูเอง 1
  npm run migrate:money-to-baht -- --apply   # backup ใน scripts/backups/ · ลง marker (รันซ้ำไม่ได้)
  # build + start โค้ดใหม่ (§⑤) แล้วค่อยเปิด FrontOffice
  npm run cleanup:legacy-product-fields -- --apply   # ลบ delete_at: null ที่ค้าง 4 ตัว (ไม่งั้นแจ้งเตือนทุกเช้า — BACKLOG4 §7.15)
  npm run check:data-integrity -- --no-notify   # ต้องเหลือแค่รหัส pos-/pre- 2 ตัว (แก้ด้วย PATCH ข้อ 3)
  ```

---

## ⑧ ตั้ง cron 3 ตัว

```bash
sudo -iu meowmee
mkdir -p /srv/meowmeecake/logs
crontab -e
```

```cron
# เวลาในไฟล์นี้ = เวลาของเครื่อง → ตั้งเครื่องเป็นเวลาไทย: sudo timedatectl set-timezone Asia/Bangkok
SHELL=/bin/bash
PATH=/usr/bin:/bin:/usr/local/bin

# วงจรรอบพรีออเดอร์ — เปิด/ปิดรอบตามเวลา · ยกเลิกคนไม่จ่ายเกินกำหนด · สร้างใบสั่งผลิตตอนปิดรอบ (preorder-round-flow.md §6)
*/15 * * * * cd /srv/meowmeecake/app && npm run -s cron:preorder-rounds >> /srv/meowmeecake/logs/preorder-rounds.log 2>&1

# เตือนลูกค้าก่อนวันรับพรีออเดอร์ทาง LINE (LINE.md §9.7)
0 18 * * * cd /srv/meowmeecake/app && npm run -s remind:preorders >> /srv/meowmeecake/logs/preorder-reminders.log 2>&1

# ตรวจข้อมูลสินค้าผิดปกติ (ราคาเป็นบาท/ฟิลด์เก่า/สต็อก variant) แล้วแจ้งเจ้าของร้าน — กันการแก้ DB ตรงแบบ BACKLOG2 §16 (BACKLOG4 Y11)
30 7 * * * cd /srv/meowmeecake/app && npm run -s check:data-integrity >> /srv/meowmeecake/logs/data-integrity.log 2>&1
```

- ทั้งสองงานรันซ้ำ/พร้อมกันได้ ไม่ทำซ้ำ · ไม่ต้องใช้ `CRON_SECRET` (รันสคริปต์ตรง ไม่ผ่าน HTTP)
- log โตเรื่อย ๆ → ตั้ง `logrotate` หรือเคลียร์เป็นระยะ
- ทดสอบก่อนรอ: `npm run remind:preorders -- --dry-run` (ดูรายชื่อ ไม่ส่ง) · `npm run check:data-integrity -- --no-notify`
- `check:data-integrity` จบด้วย exit code 2 เมื่อพบปัญหา (ปกติสำหรับ cron — ดูรายละเอียดใน log / หน้าแจ้งเตือน)

---

## ⑨ ตรวจรับหลัง deploy

- [ ] `curl https://api.example.com/api/health` → `{"ok":true,"db":"connected"}`
- [ ] ล็อกอินบัญชี owner ผ่าน frontend ได้ (cookie ข้าม subdomain — ถ้า 401 ตรวจ `COOKIE_DOMAIN`/`ALLOWED_ORIGINS`)
- [ ] รายการสินค้าแสดงครบ 42 · พรีออเดอร์ 10 (`?is_preorder=true`)
- [ ] **หน่วยเงินหลัง `migrate:money-to-baht`** ([`money-units.md`](money-units.md)) — ราคาต้องเป็นบาทตรง ๆ ไม่เพี้ยน ×100 / ÷100:
  - [ ] คัพเค้ก (เช่น `pos-1726265`) ราคา **35** บาท (ไม่ใช่ 0.35 / 3,500) · สินค้าที่มีราคาลด: `sale_price` < `product_price` (เช่น ชิโอะปัง 45 → ลด 40)
  - [ ] เปิดออเดอร์เก่า 1 ใบ (เช่นยอด 105 บาท) → ยอดรวม / ค่าส่ง / รายการ เป็นบาทถูกต้อง (ไม่ใช่ 10,500)
  - [ ] Dashboard ภาพรวม: รายได้ / ค่าใช้จ่าย / COGS อยู่ในหลักเดียวกับยอดขายจริง (ไม่โตผิดปกติ 100 เท่า)
  - [ ] โปรโมชันแบบลดเป็นบาท (เช่น "ลด 50 บาท") แสดง 50 · ขั้นต่ำ 300 · วัตถุดิบ/สูตรแสดงต้นทุนเป็นบาท
  - [ ] FrontOffice เปิดสินค้าเดียวกัน → ราคาตรงกับหลังร้าน
  - [ ] `npm run check:data-integrity -- --no-notify` → ไม่มี `price_too_high` / `price_too_low` / `sale_not_below_price`
- [ ] **อัปโหลดรูปสินค้าใหม่ แล้วเปิด URL ที่ได้ → ต้องเห็นรูป** (ถ้า 404 = nginx `location /uploads/` ยังไม่ทำงาน — §6)
- [ ] แบนเนอร์หน้าเว็บขึ้นครบหลัง `migrate:upload-files --apply`
- [ ] `curl -H "Authorization: Bearer <CRON_SECRET>" "https://api.example.com/api/cron/preorder-reminders?dry_run=true"` → 200 · ไม่ส่ง header → 401
- [ ] หลัง 15 นาที: `tail /srv/meowmeecake/logs/preorder-rounds.log` เห็นผลรัน
- [ ] ส่งข้อความทดสอบเข้า LINE เจ้าของร้าน (สร้างออเดอร์ทดสอบ หรือดูแจ้งเตือนในเว็บว่า `line_sent: true`)
- [ ] ผูก LINE ลูกค้าจริงจบ flow → กลับมาที่ `https://app.example.com/profile?line=linked` (LINE.md §7)
- [ ] ลูกค้าอัปโหลดสลิป → เปิดดูได้เฉพาะเจ้าของรายการ / owner / staff ที่มีสิทธิ์ (`/api/files/slips/…`)
- [ ] `pm2 status` = online · รีบูตเครื่องแล้วแอปกลับมาเอง

---

## สำรองข้อมูล

| อะไร | อย่างไร | ความถี่ |
|---|---|---|
| MongoDB | Atlas backup / `mongodump` | ตามแพ็กเกจ Atlas หรือวันละครั้ง |
| `public/uploads/` + `/srv/meowmeecake/private/` | `rsync -a` / tar ไปเก็บนอกเครื่อง | วันละครั้ง |
| `.env.local` | เก็บในที่ปลอดภัย (password manager) | เมื่อเปลี่ยนค่า |

### ผู้ใช้ DB แยกตามงาน (BACKLOG4 Y11)

FrontOffice ต่อ DB ตรง (BACKLOG4 R7) — แยก user ตามแอป จะได้รู้ว่าใครเขียนอะไร และปิดทีละตัวได้ — ตั้งใน Atlas → **Database Access**:

| user | role | ใช้กับ |
|---|---|---|
| `meowmee-app` | `readWrite` เฉพาะ DB ของร้าน | `MONGODB_URI` ของ backend นี้บน VPS เท่านั้น |
| `meowmee-frontoffice` | `readWrite` เฉพาะ DB ของร้าน | FrontOffice (ต่อ DB ตรง — เขียนเงินเป็น **บาท**) |
| `meowmee-readonly` | `read` เฉพาะ DB ของร้าน | Compass / Atlas Data Explorer / ดูข้อมูล / สคริปต์ audit |

- เปลี่ยนรหัสผ่าน user เดิมที่เคยแจกไป (ถ้าเคยใช้ร่วมกับ Compass) แล้วใช้กับแอปอย่างเดียว
- Atlas **Project Access**: สมาชิกที่ไม่ใช่ผู้ดูแลระบบ = `Project Read Only` (Data Explorer ของ Atlas UI แก้ข้อมูลได้ถ้ามีสิทธิ์เขียน)
- เงินทุกฟิลด์ใน DB เป็น **บาท** ทศนิยมไม่เกิน 2 ตำแหน่ง ([`money-units.md`](money-units.md)) · แก้ราคาผ่านหน้าเว็บ/API จะมี userlog

## ย้อนกลับ (rollback)

```bash
cd /srv/meowmeecake/app
git checkout <commit ก่อนหน้า> && npm ci && npm run build && pm2 reload meowmeecake-api
```
ข้อมูลใน DB ไม่ย้อนตามโค้ด — `is_preorder` / แบนเนอร์ที่ย้ายแล้วอยู่ต่อ (backup ของแต่ละ migration อยู่ใน `scripts/backups/` ถ้าจำเป็นต้องกู้จริง)
· โค้ดก่อน #52 ใช้กับ DB รูปแบบ `is_preorder` ไม่ได้ — ถ้าต้องย้อน ให้ย้อนไม่เกิน commit ของ #52

## แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `/api/health` → 503 | Atlas ไม่อนุญาต IP ของ VPS / `MONGODB_URI` ผิด | เพิ่ม IP ใน Atlas Network Access |
| รูปที่อัปโหลดหลัง deploy → 404 | `next start` ไม่เสิร์ฟไฟล์ใหม่ใน `public/` | nginx `location /uploads/` (§6) + สิทธิ์อ่านโฟลเดอร์ |
| ล็อกอินแล้ว frontend ยังได้ 401 | cookie ไม่ข้าม origin | `COOKIE_DOMAIN=.example.com` + `ALLOWED_ORIGINS=https://app.example.com` · ใช้ HTTPS ทั้งคู่ |
| ผูก LINE ขึ้น `Invalid redirect_uri` | ยังไม่ได้เพิ่ม Callback URL โดเมนจริงในแท็บ LINE Login | ② + [`LINE.md`](LINE.md) §6.1 |
| cron ไม่ทำงาน | PATH ของ cron หา `npm` ไม่เจอ / timezone | ใส่ `PATH` ในหัว crontab · ตั้งเครื่องเป็น `Asia/Bangkok` · ดู log |
| log มี `runtime.multi_instance` | รัน pm2 แบบ cluster / หลาย instance | `pm2 delete meowmeecake-api` แล้ว start ใหม่ตาม §⑤ (fork instance เดียว) |
| แจ้งเตือน "ตรวจพบข้อมูลสินค้าผิดปกติ" | มีการแก้ DB ตรงนอกแอป (ราคาเป็นบาท ฯลฯ) | ดู `logs/data-integrity.log` · แก้ผ่านหน้าหลังบ้าน · หาว่าใครใช้ user ที่เขียนได้ (§ผู้ใช้ DB) |
| อัปโหลดรูปได้ `413` | nginx จำกัดขนาด body | `client_max_body_size 45m` |
