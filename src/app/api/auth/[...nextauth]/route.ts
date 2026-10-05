/**
 * /api/auth/[...nextauth] — next-auth ของหน้าเว็บลูกค้า (signin · callback/{google,line,credentials} · session · csrf · signout)
 * ย้ายมาจาก backend ฝั่งลูกค้า — config อยู่ที่ src/lib/nextAuth.ts · docs/customer-backend-merge.md §8.9
 * route เฉพาะของหลัก (/api/auth/login · register · google · logout · me · …) ยังใช้ได้ตามเดิม (path ตรงชนะ catch-all)
 */
import NextAuth from "next-auth";
import { authOptions } from "@/lib/nextAuth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
