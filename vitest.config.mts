import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/lib/**/*.test.ts"],
          // service บางตัว import src/lib/dbConnect ที่ throw ถ้าไม่มี MONGODB_URI ตั้งแต่ตอน load module
          // unit test ในกลุ่มนี้ไม่ได้ต่อ DB จริง
          env: { MONGODB_URI: "mongodb://127.0.0.1:27017/meowmeecake_test", NODE_ENV: "test" },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          env: { NODE_ENV: "test" },
          setupFiles: ["tests/integration/setup.ts"], // เริ่ม mongodb-memory-server + ตั้ง MONGODB_URI
          testTimeout: 30_000,
          hookTimeout: 60_000, // ครั้งแรก mongodb-memory-server ต้องโหลด binary
          fileParallelism: false, // server 1 ตัว/ไฟล์ — ไม่ต้องแย่งกัน
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/services/**"],
      reportsDirectory: "coverage",
    },
  },
});
