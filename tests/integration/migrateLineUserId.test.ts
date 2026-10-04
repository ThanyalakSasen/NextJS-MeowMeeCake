import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLineMigration } from "../../scripts/migrate-line-user-id";
import { makeUser } from "./helpers";

/** docs/customer-backend-merge.md §8.2 ขั้น 2 — lineId (ฝั่งลูกค้า) → line_user_id (หลัก) */

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});
const users = () => mongoose.connection.db!.collection("users");
const setRaw = (id: unknown, fields: Record<string, unknown>) =>
  users().updateOne({ _id: id as mongoose.Types.ObjectId }, { $set: fields });
const raw = async (id: unknown) => (await users().findOne({ _id: id as mongoose.Types.ObjectId }))!;

describe("scripts/migrate-line-user-id", () => {
  it("dry-run ไม่เขียน · --apply คัดลอกเฉพาะที่ปลอดภัย · ขัดกันรายงานไม่แตะ · เก็บ lineId ไว้", async () => {
    const copy = await makeUser();
    const same = await makeUser();
    const differ = await makeUser();
    const taken = await makeUser();
    const holder = await makeUser();
    const deleted = await makeUser();
    const oldUpdated = new Date("2026-09-01T00:00:00Z");
    await setRaw(copy._id, { lineId: "Ucopy000001", line_user_id: null, updated_at: oldUpdated });
    await setRaw(same._id, { lineId: "Usame000001", line_user_id: "Usame000001" });
    await setRaw(differ._id, { lineId: "Unew0000001", line_user_id: "Uold0000001" });
    await setRaw(taken._id, { lineId: "Utaken00001" });
    await setRaw(holder._id, { line_user_id: "Utaken00001" });
    await setRaw(deleted._id, { lineId: "Udel0000001", deleted_at: new Date() });

    const dry = await runLineMigration();
    expect(dry.planned.map((r) => r._id)).toEqual([String(copy._id)]);
    expect(dry.already.map((r) => r._id)).toEqual([String(same._id)]);
    expect(dry.conflicts.map((r) => r._id).sort()).toEqual([String(differ._id), String(taken._id)].sort());
    expect((await raw(copy._id)).line_user_id).toBeNull();

    dir = mkdtempSync(join(tmpdir(), "line-"));
    const res = await runLineMigration({ apply: true, backupDir: dir });
    expect(res.copied).toBe(1);
    const after = await raw(copy._id);
    expect(after.line_user_id).toBe("Ucopy000001");
    expect(after.lineId).toBe("Ucopy000001"); // ฝั่งลูกค้ายังใช้
    expect((after.updated_at as Date).toISOString()).toBe(oldUpdated.toISOString());
    expect((await raw(differ._id)).line_user_id).toBe("Uold0000001");
    expect((await raw(taken._id)).line_user_id ?? null).toBeNull();
    expect((await raw(deleted._id)).line_user_id ?? null).toBeNull();

    // รันซ้ำ = ไม่มีงาน
    expect((await runLineMigration({ apply: true, backupDir: dir })).copied).toBe(0);
  });

  it("--remove-old ลบ lineId เฉพาะคนที่ line_user_id ตรงกันแล้ว", async () => {
    const same = await makeUser();
    const differ = await makeUser();
    await setRaw(same._id, { lineId: "Usame000002", line_user_id: "Usame000002" });
    await setRaw(differ._id, { lineId: "Unew0000002", line_user_id: "Uold0000002" });

    dir = mkdtempSync(join(tmpdir(), "line-"));
    const res = await runLineMigration({ apply: true, removeOld: true, backupDir: dir });
    expect(res.removedOld).toBe(1);
    expect("lineId" in (await raw(same._id))).toBe(false);
    expect((await raw(differ._id)).lineId).toBe("Unew0000002");
  });
});
