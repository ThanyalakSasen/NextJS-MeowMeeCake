import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    // ไม่ต้อง lint ไฟล์ build / generated / config เอง
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "coverage/**",
      "eslint.config.mjs",
    ],
  },

  // preset ของ Next.js (core-web-vitals + typescript) ผ่าน FlatCompat
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    linterOptions: {
      // ไฟล์ service มี /* eslint-disable @typescript-eslint/no-explicit-any */ แบบเหมาว่าทั้งไฟล์
      // เราปิด rule นั้นไว้ก่อน (ด้านล่าง) → directive พวกนั้นเลย "ไม่ถูกใช้" ชั่วคราว
      // ปิดการเตือนไว้ก่อน จะกลับมามีผลเองเมื่อเปิด no-explicit-any เป็น pass แยก
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      // โค้ด backend ปัจจุบันใช้ any เยอะ + มี /* eslint-disable */ อยู่แล้วหลายไฟล์
      // เปิดเป็น pass แยกภายหลัง (ค่อย ๆ ใส่ type ให้ mongoose lean<>)
      "@typescript-eslint/no-explicit-any": "off",

      // unused = เตือน (ไม่บล็อก build) · ขึ้นต้น _ = ตั้งใจไม่ใช้
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // ใช้ src/lib/logger.ts แทน — อนุญาต warn/error ไว้ก่อน (§3.3 จะไล่แทนทีหลัง)
      "no-console": ["warn", { allow: ["warn", "error"] }],

      "prefer-const": "error",
      "no-var": "error",
    },
  },

  {
    // scripts/** = CLI (seed / sync-indexes / backfill) — console คือ output ปกติ
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
];
