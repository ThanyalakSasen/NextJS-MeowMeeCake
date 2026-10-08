/**
 * mailer — ส่งอีเมลยืนยันบัญชี / รีเซ็ตรหัสผ่าน (ย้ายมาจาก backend ฝั่งลูกค้า src/lib/sendEmail.ts · customer-backend-merge.md §8.9)
 *
 * ตั้งค่า (.env.local — docs/env.md):
 *   EMAIL_USER + EMAIL_PASS (จำเป็น) · EMAIL_SERVICE (เช่น "gmail") หรือ EMAIL_HOST + EMAIL_PORT (SMTP เอง)
 *   STOREFRONT_URL = URL หน้าเว็บลูกค้า สำหรับลิงก์ในอีเมล (ไม่ตั้ง = ใช้ NEXTAUTH_URL)
 * ผู้ส่ง = ชื่อร้านจาก StoreProfile (ไม่ได้ตั้ง = "เหมียวมีเค้ก") · Reply-To = อีเมลติดต่อร้าน (ถ้าตั้ง)
 * เทส: setMailTransport() ใส่ transport ปลอม (ไม่ส่งจริง)
 */
import nodemailer, { type Transporter } from "nodemailer";
import dbConnect from "./dbConnect";
import storeProfileModel from "../models/storeProfileModel";
import { storefrontUrl } from "./storefront";

const FALLBACK_STORE_NAME = "เหมียวมีเค้ก";

let transport: Pick<Transporter, "sendMail"> | null = null;

/** ใช้ในเทสเท่านั้น — null = กลับไปสร้างจาก env */
export function setMailTransport(t: Pick<Transporter, "sendMail"> | null): void {
  transport = t;
}

function getTransport(): Pick<Transporter, "sendMail"> {
  if (transport) return transport;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) throw new Error("ยังไม่ได้ตั้งค่าอีเมล (EMAIL_USER / EMAIL_PASS)");
  transport = process.env.EMAIL_HOST
    ? nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT) || 587,
        secure: Number(process.env.EMAIL_PORT) === 465,
        auth: { user, pass },
      })
    : nodemailer.createTransport({ service: process.env.EMAIL_SERVICE || "gmail", auth: { user, pass } });
  return transport;
}

/** URL หน้าเว็บลูกค้าสำหรับลิงก์ในอีเมล (ย้ายไป lib/storefront — ใช้ร่วมกับลิงก์ในข้อความ LINE) */
export { storefrontUrl };

async function getSender(): Promise<{ from: { name: string; address: string }; replyTo?: string; storeName: string }> {
  let storeName = FALLBACK_STORE_NAME;
  let contactEmail = "";
  try {
    await dbConnect();
    const profile = await storeProfileModel
      .findOne()
      .select("store_name contact_email")
      .lean<{ store_name?: string; contact_email?: string } | null>();
    // ตัดขึ้นบรรทัดใหม่ทิ้ง กันชื่อร้านแทรก header อีเมล
    const name = String(profile?.store_name ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 100);
    if (name) storeName = name;
    contactEmail = String(profile?.contact_email ?? "").trim();
  } catch {
    // อ่านชื่อร้านไม่ได้ → ใช้ชื่อสำรอง
  }
  return {
    from: { name: storeName, address: process.env.EMAIL_USER ?? "" },
    ...(contactEmail ? { replyTo: contactEmail } : {}),
    storeName,
  };
}

/** กัน HTML injection — ชื่อร้าน/ชื่อลูกค้ามาจากข้อมูลที่ผู้ใช้กรอก */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(storeName: string, body: string): string {
  const name = escapeHtml(storeName);
  return `
      <p style="font-size:18px;font-weight:bold;color:#4A342E;margin:0 0 16px">${name}</p>
      ${body}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px" />
      <p style="color:#888;font-size:12px;margin:0">ด้วยความขอบคุณ<br />ทีมงาน ${name}</p>
      <p style="color:#aaa;font-size:11px;margin:8px 0 0">หากคุณไม่ได้เป็นผู้ทำรายการนี้ สามารถละเว้นอีเมลฉบับนี้ได้</p>
    `;
}

export async function sendVerificationEmail(toEmail: string, token: string): Promise<void> {
  const url = storefrontUrl(`/customer/verify-email?token=${encodeURIComponent(token)}`);
  const { from, replyTo, storeName } = await getSender();
  await getTransport().sendMail({
    from,
    replyTo,
    to: toEmail,
    subject: `ยืนยันอีเมลของคุณ — ${storeName}`,
    html: layout(
      storeName,
      `
      <h2>ยืนยันอีเมล</h2>
      <p>ขอบคุณที่สมัครสมาชิกกับ ${escapeHtml(storeName)} กดปุ่มด้านล่างเพื่อยืนยันบัญชีของคุณ</p>
      <a href="${url}">ยืนยันอีเมล</a>
      <p>ลิงก์นี้หมดอายุใน 24 ชั่วโมง</p>
    `
    ),
  });
}

export async function sendResetPasswordEmail(toEmail: string, token: string, name: string): Promise<void> {
  const url = storefrontUrl(`/customer/reset-password?token=${encodeURIComponent(token)}`);
  const { from, replyTo, storeName } = await getSender();
  await getTransport().sendMail({
    from,
    replyTo,
    to: toEmail,
    subject: `รีเซ็ตรหัสผ่าน — ${storeName}`,
    html: layout(
      storeName,
      `
      <h2>รีเซ็ตรหัสผ่าน</h2>
      ${name?.trim() ? `<p>สวัสดีคุณ ${escapeHtml(name.trim())}</p>` : ""}
      <p>เราได้รับคำขอรีเซ็ตรหัสผ่านบัญชี ${escapeHtml(storeName)} ของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่</p>
      <a href="${url}">รีเซ็ตรหัสผ่าน</a>
      <p>ลิงก์นี้หมดอายุใน 1 ชั่วโมง</p>
    `
    ),
  });
}
