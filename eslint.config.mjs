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
    rules: {
      // fase 4a (3.6): เปิด no-explicit-any กลับเป็น "warn" ทั้ง repo (จากเดิม "off")
      // → any ทุกจุดมองเห็นได้ + directive /* eslint-disable */ เหมาไฟล์ใน service กลับมา "ถูกใช้"
      //   (จึงเอา reportUnusedDisableDirectives: "off" ออก — กลับเป็น default)
      // dir ที่สะอาดแล้วถูกยกเป็น "error" ด้านล่าง · services เก็บเป็น warn ไล่ทีหลัง
      "@typescript-eslint/no-explicit-any": "warn",

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
    // dir ที่เป็นโค้ดใหม่/สะอาด — บังคับห้าม any เพื่อกันถอยหลัง
    files: ["src/schemas/**/*.ts", "tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },

  {
    // scripts/** = CLI (seed / sync-indexes / backfill) — console คือ output ปกติ
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
];
