import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import userModel from "@/models/userModel";
import * as userService from "@/services/userService";
import { createUserBody } from "@/schemas/user";
import { makeUser } from "./helpers";

/**
 * วันทำงานพนักงาน
 *   - วันสุดท้ายที่ทำงานต้องไม่ก่อนวันเริ่มงาน (PATCH ข้างเดียวเทียบกับค่าเดิม)
 *   - ตอนเพิ่มพนักงานรับ last_working_date ได้ (เดิม zod ตัดทิ้งเงียบ ๆ)
 */

const d = (s: string) => new Date(s);

describe("วันทำงานพนักงาน", () => {
  it("createUser: เก็บ last_working_date · ก่อนวันเริ่มงาน → 400", async () => {
    const role = await roleModel.create({ role_name: `staff-${Math.random()}`, role_type: "staff" });
    const base = {
      user_fullname: "พนักงาน",
      auth_provider: "local" as const,
      role_id: String(role._id),
      password: "Passw0rd!x",
    };
    const parsed = createUserBody.parse({
      ...base,
      email: `w${Date.now()}@test.local`,
      start_working_date: "2026-01-01",
      last_working_date: "2026-06-30",
    });
    const created = (await userService.createUser(parsed)) as { _id: unknown };
    const raw = await userModel.findById(created._id).lean<{ last_working_date: Date | null }>();
    expect(raw!.last_working_date?.toISOString().slice(0, 10)).toBe("2026-06-30");

    await expect(
      userService.createUser(
        createUserBody.parse({
          ...base,
          email: `x${Date.now()}@test.local`,
          start_working_date: "2026-06-01",
          last_working_date: "2026-05-01",
        })
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it("updateUser: เทียบกับค่าเดิม — ส่งข้างเดียวก็ตรวจ · ล้างวันได้", async () => {
    const user = await makeUser({ start_working_date: d("2026-03-01") });
    const id = String(user._id);
    await expect(userService.updateUser(id, { last_working_date: d("2026-02-01") })).rejects.toMatchObject({ status: 400 });
    await userService.updateUser(id, { last_working_date: d("2026-04-01") });
    await expect(userService.updateUser(id, { start_working_date: d("2026-05-01") })).rejects.toMatchObject({ status: 400 });
    await userService.updateUser(id, { start_working_date: null });
  });
});
