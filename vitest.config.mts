import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // service บางตัว import src/lib/dbConnect ที่ throw ถ้าไม่มี MONGODB_URI ตั้งแต่ตอน load module
    // ค่านี้แค่ให้ผ่านการ import — unit test ในชุดนี้ไม่ได้ต่อ DB จริง
    env: {
      MONGODB_URI: "mongodb://127.0.0.1:27017/meowmeecake_test",
      NODE_ENV: "test",
    },
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/services/**"],
      reportsDirectory: "coverage",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
