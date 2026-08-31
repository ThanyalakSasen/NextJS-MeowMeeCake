#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// scripts/check-i18n.mjs
// หา string literal ที่มีอักษรไทย (ช่วง U+0E00–U+0E7F) ใน src/**/*.{ts,tsx}
// ที่ "ไม่ได้อยู่ใน" ไดเรกทอรีที่อนุญาต — เตือนว่าควรย้ายไป src/i18n/messages
//
//   node scripts/check-i18n.mjs           → รายงานอย่างเดียว (exit 0)
//   node scripts/check-i18n.mjs --strict  → exit 1 ถ้าเจอ (ใช้ใน CI ตั้งแต่เฟส 3)
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const STRICT = process.argv.includes("--strict");

// ไดเรกทอรี/ไฟล์ที่ยกเว้น (มีอักษรไทยได้โดยตั้งใจ)
const ALLOW_DIRS = [
  "src/i18n",           // ตัว catalog เอง
  "src/mocks",          // fixture (D6) — ชั่วคราว
  "src/models",         // schema enum ค่าไทย (แนวทาง A) — ไม่ใช่ UI
  "src/types",          // *_CONFIG label + RecipeCategory — เฟส 1 จะแยก label ออก
];
const ALLOW_FILES = [
  "src/app/layout.tsx", // metadata.description — จะย้ายไป generateMetadata ทีหลัง
];

const THAI = /[฀-๿]/;
// จับเฉพาะ string / template literal (หยาบ ๆ แต่พอสำหรับ warn)
const STRING_LITERAL = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line (เลี่ยง http://)
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

const hits = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOW_DIRS.some((d) => rel.startsWith(d + "/")) || ALLOW_FILES.includes(rel)) continue;

  const lines = stripComments(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(STRING_LITERAL)) {
      if (THAI.test(m[0])) hits.push({ rel, line: i + 1, text: m[0].slice(0, 80) });
    }
  });
}

if (hits.length === 0) {
  console.log("✓ i18n: ไม่พบ literal อักษรไทยนอก catalog");
  process.exit(0);
}

console.log(`✗ i18n: พบ literal อักษรไทย ${hits.length} จุด — ย้ายไป src/i18n/messages แล้วใช้ t()`);
for (const h of hits) console.log(`  ${h.rel}:${h.line}  ${h.text}`);
process.exit(STRICT ? 1 : 0);
