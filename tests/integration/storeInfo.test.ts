import { describe, it, expect, afterEach, vi } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import roleModel from "@/models/roleModel";
import storeProfileModel from "@/models/storeProfileModel";
import permissionModel from "@/models/permissionModel";
import { createPermission } from "@/services/permissionService";
import * as storeService from "@/services/storeService";
import type { SessionUser } from "@/lib/session";
import { makeUser } from "./helpers";

/** ข้อมูลร้าน + โลโก้ + หน้าร้านประจำสัปดาห์ + ที่อยู่ร้าน + ลิงก์แผนที่ (customer-backend-merge.md §8.19) */

let created: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(created.map((u) => rm(join(process.cwd(), "public", u), { force: true })));
  created = [];
});

const png = () => {
  const b = Buffer.alloc(20);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  return new File([new Uint8Array(b)], "logo.png", { type: "image/png" });
};

const market = (over: Record<string, unknown> = {}) => ({
  name: "ถนนคนเดิน",
  location: "หน้าศาลากลาง",
  days: ["sat", "fri", "xxx"],
  open_time: "17:00",
  close_time: "22:00",
  ...over,
});

async function staffSession(flags: Record<string, boolean>): Promise<SessionUser> {
  const role = await roleModel.create({ role_name: `staff-${Math.random()}`, role_type: "staff" });
  const admin = await makeUser();
  if (Object.keys(flags).length > 0) {
    await createPermission({ role_id: String(role._id), menu_key: "store_info", granted_by: String(admin._id), ...flags });
  }
  const user = await makeUser({ role_id: role._id });
  return { user_id: String(user._id), role_id: String(role._id), role_type: "staff", email: "s@test.local" };
}

describe("ข้อมูลร้าน", () => {
  it("แก้ข้อมูลร้าน → หน้าสาธารณะเห็นเฉพาะที่ตั้งใจให้ลูกค้าเห็น (ไม่มีพร้อมเพย์/รายการที่ปิดแสดง)", async () => {
    const staff = await makeUser({ user_phone: "0811111111" });
    await storeService.updateProfile({
      store_name: "  เหมียวมี่เค้ก ",
      promptpay_id: "081-234-5678",
      promptpay_account_name: "ร้านเหมียว",
      contact_email: "Shop@Test.local",
      social_links: { facebook: "https://facebook.com/meow", line: "" },
      phone_primary_user_id: String(staff._id),
      phone_secondary_user_id: "",
      weekly_markets: [market(), market({ name: "ตลาดเช้า", is_active: false })],
    });
    await storeService.updateSettings({ province: "เลย", zip_code: "42000", latitude: "17.878", longitude: 102.742 });

    const info = await storeService.getPublicStoreInfo();
    expect(info).toMatchObject({
      store_name: "เหมียวมี่เค้ก",
      logo_url: storeService.DEFAULT_STORE_LOGO,
      phones: ["0811111111"],
      contact_email: "shop@test.local",
      social_links: { facebook: "https://facebook.com/meow", line: "", instagram: "", website: "" },
      address: { province: "เลย", zip_code: "42000" },
      location: { latitude: 17.878, longitude: 102.742 },
    });
    expect(info.weekly_markets).toEqual([
      { name: "ถนนคนเดิน", location: "หน้าศาลากลาง", days: ["fri", "sat"], open_time: "17:00", close_time: "22:00", map_url: "" },
    ]);
    expect(JSON.stringify(info)).not.toContain("0812345678");

    const profile = await storeService.getProfile();
    expect(profile.promptpay_id).toBe("0812345678");
    expect(profile.phone_primary_user_id.user_phone).toBe("0811111111");
  });

  it("ตรวจข้อมูล: พร้อมเพย์/ชื่อบัญชี/อีเมล/URL/ผู้ใช้เบอร์โทร/เวลา/ต้องมีหน้าร้านเปิดแสดง/รหัสไปรษณีย์/พิกัด = 400", async () => {
    const bad = [
      { promptpay_id: "12345" },
      { promptpay_id: "0812345678" },
      { contact_email: "nope" },
      { social_links: { website: "javascript:alert(1)" } },
      { phone_primary_user_id: "665f1b2c3d4e5f6a7b8c9d0e" },
      { weekly_markets: [market({ open_time: "22:00", close_time: "17:00" })] },
      { weekly_markets: [market({ is_active: false })] },
      { weekly_markets: [market({ days: [] })] },
    ];
    for (const body of bad) await expect(storeService.updateProfile(body)).rejects.toMatchObject({ status: 400 });
    await expect(storeService.updateSettings({ zip_code: "4200" })).rejects.toMatchObject({ status: 400 });
    await expect(storeService.updateSettings({ latitude: 91 })).rejects.toMatchObject({ status: 400 });
    expect((await storeService.updateSettings({ latitude: null }))!.latitude).toBeNull();
  });
});

describe("โลโก้ร้าน", () => {
  it("ยังไม่อัปโหลด = โลโก้เดิม · อัปโหลด → เก็บ URL · อัปโหลดใหม่ลบไฟล์เก่า · ไม่ใช่รูป = 400 และข้อมูลไม่เปลี่ยน", async () => {
    expect((await storeService.getStoreLogo()).url).toBe("/pictures/logoMoewMeeCake.png");

    const first = await storeService.updateProfile({ store_name: "A" }, png());
    created.push(first.logo_url);
    expect(first.logo_url).toMatch(/^\/uploads\/store\/logo-\d+-[a-f0-9]+\.png$/);
    expect((await storeService.getStoreLogo()).url).toBe(first.logo_url);

    const second = await storeService.updateProfile({}, png());
    created.push(second.logo_url);
    expect(second.logo_url).not.toBe(first.logo_url);
    expect(existsSync(join(process.cwd(), "public", first.logo_url))).toBe(false);
    expect(existsSync(join(process.cwd(), "public", second.logo_url))).toBe(true);

    const notImage = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], "x.png");
    await expect(storeService.updateProfile({ store_name: "B" }, notImage)).rejects.toMatchObject({ status: 400 });
    // ข้อมูลผิด → ไม่อัปโหลดเลย
    await expect(storeService.updateProfile({ contact_email: "bad" }, png())).rejects.toMatchObject({ status: 400 });
    const doc = await storeProfileModel.findOne().lean<{ store_name: string; logo_url: string }>();
    expect(doc).toMatchObject({ store_name: "A", logo_url: second.logo_url });
  });
});

describe("หน้าร้านประจำสัปดาห์ — สิทธิ์ store_info ตามสิ่งที่เปลี่ยน", () => {
  it("คง _id เดิม · เพิ่ม/แก้/ลบ ต้องมีสิทธิ์ create/update/delete · ไม่มีอะไรเปลี่ยน = ไม่ต้องมีสิทธิ์", async () => {
    await storeService.updateProfile({ weekly_markets: [market()] });
    const [m0] = (await storeService.getWeeklyMarkets()).weekly_markets as Array<Record<string, unknown>>;
    const keep = { ...m0, _id: String(m0._id) };

    const viewer = await staffSession({ can_view: true });
    await expect(storeService.updateWeeklyMarkets(viewer, { weekly_markets: [keep] })).resolves.toBeTruthy();
    await expect(
      storeService.updateWeeklyMarkets(viewer, { weekly_markets: [keep, market({ name: "ใหม่" })] })
    ).rejects.toMatchObject({ status: 403, message: expect.stringContaining("เพิ่ม") });

    const editor = await staffSession({ can_view: true, can_update: true, can_create: true });
    const res = await storeService.updateWeeklyMarkets(editor, {
      weekly_markets: [{ ...keep, close_time: "23:00" }, market({ name: "ใหม่" })],
    });
    const list = res.weekly_markets as Array<{ _id: unknown; close_time: string }>;
    expect(String(list[0]._id)).toBe(keep._id);
    expect(list[0].close_time).toBe("23:00");

    await expect(
      storeService.updateWeeklyMarkets(editor, { weekly_markets: [{ ...keep, close_time: "23:00" }] })
    ).rejects.toMatchObject({ status: 403, message: expect.stringContaining("ลบ") });

    const owner: SessionUser = { ...editor, role_type: "owner" };
    const after = await storeService.updateWeeklyMarkets(owner, { weekly_markets: [{ ...keep, close_time: "23:00" }] });
    expect(after.weekly_markets).toHaveLength(1);
  });

  it("แก้ซ้อนกัน (ข้อมูลเปลี่ยนหลังอ่าน) = 409", async () => {
    await storeService.updateProfile({ weekly_markets: [market()] });
    const owner: SessionUser = { ...(await staffSession({})), role_type: "owner" };
    const realUpdate = storeProfileModel.findOneAndUpdate.bind(storeProfileModel);
    const spy = vi.spyOn(storeProfileModel, "findOneAndUpdate").mockImplementationOnce(((...args: unknown[]) => ({
      // มีคนบันทึกตัดหน้าไปก่อน (หลังตรวจสิทธิ์) → updated_at เปลี่ยน
      lean: async () => {
        await new Promise((r) => setTimeout(r, 5));
        await storeProfileModel.updateOne({}, { $set: { store_name: "ตัดหน้า" } });
        return (realUpdate as (...a: unknown[]) => { lean: () => unknown })(...args).lean();
      },
    })) as never);
    await expect(storeService.updateWeeklyMarkets(owner, { weekly_markets: [market()] })).rejects.toMatchObject({ status: 409 });
    spy.mockRestore();
  });

  it("สิทธิ์เมนู store_info บันทึกลง Permissions ได้ (enum) — รวม preorder ที่เคยตกหล่น", async () => {
    const role = await roleModel.create({ role_name: `r-${Math.random()}`, role_type: "staff" });
    for (const menu_key of ["store_info", "preorder"]) {
      await expect(permissionModel.create({ role_id: role._id, menu_key, can_view: true, granted_by: role._id })).resolves.toBeTruthy();
    }
  });
});

describe("แปลงลิงก์ Google Maps แบบย่อ", () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it("ตาม redirect ไปโดเมน Google แล้วอ่านพิกัด", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("https://www.google.com/maps/place/x/@17.8781,102.7421,17z"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(storeService.resolveMapLink("https://maps.app.goo.gl/abc123")).resolves.toMatchObject({ lat: 17.8781, lng: 102.7421 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("กัน SSRF: ไม่ใช่ลิงก์ย่อ = 400 · redirect ออกนอก Google = 400 · ไม่มีพิกัด = 422 · เปิดไม่ได้ = 502", async () => {
    await expect(storeService.resolveMapLink("http://169.254.169.254/latest")).rejects.toMatchObject({ status: 400 });
    await expect(storeService.resolveMapLink("http://maps.app.goo.gl/abc")).rejects.toMatchObject({ status: 400 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirect("http://127.0.0.1:27017/")));
    await expect(storeService.resolveMapLink("https://maps.app.goo.gl/abc")).rejects.toMatchObject({ status: 400 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirect("https://evil.google.com.attacker.io/@1,2")));
    await expect(storeService.resolveMapLink("https://maps.app.goo.gl/abc")).rejects.toMatchObject({ status: 400 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    await expect(storeService.resolveMapLink("https://maps.app.goo.gl/abc")).rejects.toMatchObject({ status: 422 });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(storeService.resolveMapLink("https://maps.app.goo.gl/abc")).rejects.toMatchObject({ status: 502 });
  });
});
