/**
 * promptpayService — QR พร้อมเพย์แบบระบุยอดเงิน ให้ลูกค้าสแกนจ่ายออเดอร์/พรีออเดอร์จากหน้าเว็บ
 * ย้ายมาจาก backend ฝั่งลูกค้า (src/lib/promptpay.ts · docs/customer-backend-merge.md §8.8)
 *
 * เลขพร้อมเพย์: StoreProfile.promptpay_id (เจ้าของร้านตั้งที่หน้า "ข้อมูลร้านค้า") ก่อน → ไม่ได้ตั้ง = env PROMPTPAY_ID
 * ชื่อบัญชีแสดงเฉพาะเมื่อใช้เลขจาก StoreProfile (เลขจาก env ไม่รู้ชื่อบัญชีที่ถูกต้อง)
 */
import generatePayload from "promptpay-qr";
import QRCode from "qrcode";
import dbConnect from "../lib/dbConnect";
import { unprocessable } from "../lib/httpError";
import storeProfileModel from "../models/storeProfileModel";

export async function getPromptPayAccount(): Promise<{ id: string; accountName: string }> {
  await dbConnect();
  const profile = await storeProfileModel
    .findOne()
    .select("promptpay_id promptpay_account_name")
    .lean<{ promptpay_id?: string; promptpay_account_name?: string } | null>();
  const fromProfile = String(profile?.promptpay_id ?? "").replace(/[\s-]/g, "");
  const id = fromProfile || String(process.env.PROMPTPAY_ID ?? "").replace(/[\s-]/g, "");
  if (!id) throw unprocessable("ร้านยังไม่ได้ตั้งค่าเลขพร้อมเพย์");
  const accountName = fromProfile ? String(profile?.promptpay_account_name ?? "").trim() : "";
  return { id, accountName };
}

/** QR พร้อมเพย์ (data URL รูป PNG) สำหรับยอดเงินที่ระบุ (บาท) */
export async function buildPromptPayQr(amount: number): Promise<{ qr_image: string; account_name: string }> {
  const account = await getPromptPayAccount();
  const payload = generatePayload(account.id, { amount });
  return { qr_image: await QRCode.toDataURL(payload), account_name: account.accountName };
}
