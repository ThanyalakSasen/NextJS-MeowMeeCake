/**
 * nextAuth — next-auth (v4) สำหรับหน้าเว็บลูกค้า ย้ายมาจาก backend ฝั่งลูกค้า (docs/customer-backend-merge.md §8.9)
 *
 * ผู้ใช้เลือก "เก็บทั้งสองระบบ": หลังร้าน/storefront เดิมใช้ JWT cookie `session` ของหลัก (/api/auth/login) ·
 * หน้าเว็บลูกค้าใช้ next-auth (/api/auth/[...nextauth]) — middleware รับได้ทั้งสองแบบ แล้วแปลงเป็น SessionUser เดียวกัน
 *
 * providers: อีเมล+รหัสผ่าน (userService.verifyCredentials — กติกาเดียวกับ /api/auth/login: 10 ครั้ง/นาที/IP (โควตาเดียวกัน) · ล็อกบัญชี 5 ครั้ง ·
 * ลูกค้าต้องยืนยันอีเมล) · Google · LINE (line_user_id) — provider ที่ไม่ได้ตั้ง client id/secret จะไม่ถูกเปิด
 * token: id · role (role_type) · role_id · email · auth_time (เวลาล็อกอินจริง — เทียบ password_changed_at ใน authGuard)
 *
 * env: NEXTAUTH_SECRET (จำเป็น) · NEXTAUTH_URL · GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET · LINE_LOGIN_CHANNEL_ID/LINE_LOGIN_CHANNEL_SECRET
 * callback ที่ต้องลงทะเบียน: {NEXTAUTH_URL}/api/auth/callback/google · /api/auth/callback/line
 */
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import LineProvider from "next-auth/providers/line";
import { isHttpError } from "./httpError";
import { log } from "./logger";
import { rateLimit } from "./rateLimit";
import { clientIpFromHeaders } from "./request";
import * as userService from "../services/userService";
import { OAuthAccountError, signInWithGoogle, signInWithLine, type OAuthUser } from "../services/oauthService";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 วัน (เท่าฝั่งลูกค้า)

/** หน้าเข้าสู่ระบบของหน้าเว็บลูกค้า พร้อมข้อความ error */
const loginError = (message: string) => `/login?error=${encodeURIComponent(message)}`;

function providers(): NextAuthOptions["providers"] {
  const list: NextAuthOptions["providers"] = [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) throw new Error("กรุณากรอกอีเมลและรหัสผ่าน");
        try {
          // จำกัดต่อ IP โควตาเดียวกับ POST /api/auth/login (กันสุ่มรหัสหลายบัญชีจาก IP เดียว — docs/BACKLOG5.md Y4)
          const headers = (req?.headers ?? {}) as Record<string, string | string[] | undefined>;
          const header = (name: string) => {
            const v = headers[name];
            return Array.isArray(v) ? v[0] : v;
          };
          rateLimit(clientIpFromHeaders(header), "auth:login", { limit: 10, windowMs: 60_000 });
          const user: any = await userService.verifyCredentials(credentials.email, credentials.password);
          const roleType = user.role_id?.role_type === "admin" ? "owner" : user.role_id?.role_type;
          return {
            id: String(user._id),
            email: user.email,
            name: user.user_fullname,
            image: user.user_img ?? null,
            role: roleType,
            role_id: String(user.role_id?._id ?? user.role_id),
            profileCompleted: !!(user.user_phone && user.user_birthdate),
          } as any;
        } catch (err) {
          // ข้อความของ HttpError (รหัสผิด/ล็อก/ยังไม่ยืนยันอีเมล) ส่งให้หน้าเว็บแสดงได้ · error ระบบ → ข้อความกลาง
          if (isHttpError(err)) throw new Error(err.message);
          log.error("nextauth.credentials_failed", { err });
          throw new Error("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        }
      },
    }),
  ];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    list.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        authorization: { params: { prompt: "select_account" } },
      })
    );
  }
  if (process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET) {
    list.push(
      LineProvider({
        clientId: process.env.LINE_LOGIN_CHANNEL_ID,
        clientSecret: process.env.LINE_LOGIN_CHANNEL_SECRET,
        authorization: { params: { scope: "openid profile email", bot_prompt: "aggressive" } },
      })
    );
  }
  return list;
}

/** ใส่ข้อมูลบัญชีในระบบลง user object ของ next-auth (ส่งต่อไป jwt callback) */
function adopt(user: any, dbUser: OAuthUser): void {
  user.id = dbUser.user_id;
  user.name = dbUser.name;
  user.email = dbUser.email || null;
  user.image = dbUser.image ?? undefined;
  user.role = dbUser.role_type;
  user.role_id = dbUser.role_id;
  user.profileCompleted = dbUser.profile_completed;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  providers: providers(),
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google" && account?.provider !== "line") return true;
      try {
        const p = (profile ?? {}) as any;
        const dbUser =
          account.provider === "google"
            ? await signInWithGoogle({
                email: p.email ?? user.email,
                name: p.name ?? user.name,
                sub: String(p.sub ?? account.providerAccountId),
                picture: p.picture ?? user.image,
                email_verified: p.email_verified,
              })
            : await signInWithLine({
                sub: String(p.sub ?? account.providerAccountId ?? ""),
                name: p.name ?? user.name,
                email: p.email ?? user.email ?? null,
                picture: p.picture ?? user.image ?? null,
              });
        adopt(user, dbUser);
        return true;
      } catch (err) {
        if (err instanceof OAuthAccountError) return loginError(err.message);
        log.error("nextauth.oauth_failed", { provider: account.provider, err });
        return loginError("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    },
    async jwt({ token, user }) {
      if (user) {
        const u = user as any;
        token.id = u.id;
        token.role = u.role;
        token.role_id = u.role_id;
        token.email = u.email ?? token.email;
        token.profileCompleted = u.profileCompleted;
        // เวลาที่ล็อกอินจริง (ต่างจาก iat ที่ต่ออายุทุกครั้ง) — authGuard เทียบกับ password_changed_at
        token.auth_time = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as any;
        u.id = token.id;
        u.role = token.role;
        u.profileCompleted = token.profileCompleted;
      }
      return session;
    },
    // redirect ได้เฉพาะในโดเมนเดียวกัน (กัน open redirect)
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return `${baseUrl}/`;
    },
  },
  pages: { signIn: "/login", error: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
};
