import { describe, it, expect } from "vitest";
import notificationModel from "@/models/notificationModel";
import { notificationModuleLabel } from "@/services/notificationService";
import * as contactService from "@/services/contactService";
import { makeUser } from "./helpers";

/** ฟอร์มติดต่อร้าน (customer-backend-merge.md §8.17) — แจ้งเตือนหลังร้าน หมวด "ลูกค้า" */

describe("ติดต่อร้าน", () => {
  it("ส่งข้อความ → แจ้งเตือนหมวด customer ใช้ชื่อ/เบอร์จากบัญชี · หัวข้อไม่รู้จัก = เรื่องอื่นๆ · ส่งรัวภายใน 1 นาที = 429", async () => {
    const user = await makeUser({ user_fullname: "คุณมะลิ", user_phone: "0812345678", email: "mali@test.local" });
    await contactService.sendContactMessage(String(user._id), { topic: "ไม่มีในรายการ", message: "  อยากสั่งเค้ก 2 ปอนด์  " });
    const n = await notificationModel.findOne({ module: "customer" }).lean<{ title: string; message: string }>();
    expect(n!.title).toBe("ข้อความจากลูกค้า: เรื่องอื่นๆ");
    expect(n!.message).toBe("คุณมะลิ (โทร 0812345678 · อีเมล mali@test.local): อยากสั่งเค้ก 2 ปอนด์");
    expect(notificationModuleLabel("customer")).toBe("ลูกค้า");

    await expect(
      contactService.sendContactMessage(String(user._id), { topic: "สอบถามหน้าร้านประจำสัปดาห์", message: "อีกเรื่อง" })
    ).rejects.toMatchObject({ status: 429 });
  });

  it("ข้อความว่าง/ยาวเกิน = 400 (ไม่นับโควตา)", async () => {
    const user = await makeUser();
    await expect(contactService.sendContactMessage(String(user._id), { message: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(contactService.sendContactMessage(String(user._id), { message: "ก".repeat(1001) })).rejects.toMatchObject({ status: 400 });
    await contactService.sendContactMessage(String(user._id), { topic: "สั่งเค้กจัดเลี้ยง / Snack Box", message: "ok" });
    expect(await notificationModel.countDocuments({ module: "customer" })).toBe(1);
  });
});
