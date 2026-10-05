import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";

/**
 * docs/customer-backend-merge.md §8.2 ขั้น 2 — ผูก LINE ลูกค้าใช้ฟิลด์เดียว `users.line_user_id`
 * backend ฝั่งลูกค้าเก็บไว้ที่ `users.lineId` → คัดลอกมาที่ `line_user_id` ให้แจ้งเตือนลูกค้าของ backend หลักส่งถึง
 *
 * กติกา (เฉพาะผู้ใช้ที่ยังไม่ถูกลบ · lineId เป็นข้อความไม่ว่าง):
 *   - line_user_id ว่าง                      → คัดลอก lineId มา (planned)
 *   - line_user_id = lineId อยู่แล้ว          → ข้าม (already)
 *   - line_user_id มีค่าอื่น                  → ไม่แตะ รายงาน (conflict: ผูกคนละบัญชี LINE)
 *   - LINE นี้ผูกกับผู้ใช้อื่นใน line_user_id แล้ว → ไม่แตะ รายงาน (conflict: 1 LINE ผูกได้บัญชีเดียว)
 * **ไม่ลบ lineId** โดยค่าเริ่มต้น — backend ฝั่งลูกค้า (พอร์ต 4000) ยังอ่าน lineId ส่ง LINE อยู่ ·
 * `--remove-old` (ใช้หลังปิดพอร์ต 4000) = ลบ lineId ของผู้ใช้ที่ line_user_id ตรงกันแล้ว
 *
 * ความปลอดภัย: dry-run ค่าเริ่มต้น · --apply backup scripts/backups/line-user-id-*.json ก่อน ·
 * เขียนแบบมีเงื่อนไข (ค่ายังเหมือนตอนอ่าน) · ไม่แตะ updated_at · รันซ้ำได้ (ฝั่งลูกค้ายังผูกเพิ่มได้ → รันใหม่เก็บตก)
 *
 * รัน: npm run migrate:line-user-id                        (dry-run)
 *      npm run migrate:line-user-id -- --apply             (คัดลอกจริง)
 *      npm run migrate:line-user-id -- --apply --remove-old (คัดลอก + ลบ lineId — หลังปิดพอร์ต 4000 เท่านั้น)
 */

type Row = { _id: string; email: string | null; lineId: string; line_user_id: string | null };

export interface LineMigrationResult {
  dryRun: boolean;
  removeOld: boolean;
  planned: Row[];
  already: Row[];
  conflicts: Array<Row & { reason: string }>;
  copied: number;
  removedOld: number;
  backupFile: string | null;
}

const mask = (v: string) => (v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : "****");

export async function runLineMigration(
  opts: { apply?: boolean; removeOld?: boolean; backupDir?: string } = {}
): Promise<LineMigrationResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const users = db.collection("users");
  const dryRun = !opts.apply;
  const removeOld = !!opts.removeOld;

  const docs = await users
    .find({ lineId: { $type: "string", $ne: "" }, deleted_at: null })
    .project({ email: 1, lineId: 1, line_user_id: 1 })
    .toArray();

  // LINE userId ที่ผูกอยู่แล้วใน line_user_id → ผู้ใช้คนไหน (กันผูก 1 LINE ซ้ำ 2 บัญชี)
  const owners = await users
    .find({ line_user_id: { $in: docs.map((d) => d.lineId as string) } })
    .project({ line_user_id: 1 })
    .toArray();
  const ownerOf = new Map(owners.map((o) => [o.line_user_id as string, String(o._id)]));

  const planned: Row[] = [];
  const already: Row[] = [];
  const conflicts: LineMigrationResult["conflicts"] = [];
  for (const d of docs) {
    const row: Row = {
      _id: String(d._id),
      email: (d.email as string) ?? null,
      lineId: d.lineId as string,
      line_user_id: (d.line_user_id as string) || null,
    };
    if (row.line_user_id === row.lineId) already.push(row);
    else if (row.line_user_id) conflicts.push({ ...row, reason: "line_user_id มีค่าอื่นอยู่แล้ว (ผูกคนละบัญชี LINE)" });
    else if (ownerOf.has(row.lineId) && ownerOf.get(row.lineId) !== row._id) {
      conflicts.push({ ...row, reason: `LINE นี้ผูกกับผู้ใช้ ${ownerOf.get(row.lineId)} แล้ว` });
    } else planned.push(row);
  }

  let copied = 0;
  let removedOld = 0;
  let backupFile: string | null = null;
  const toRemove = removeOld ? [...already, ...planned] : [];
  if (!dryRun && (planned.length || toRemove.length)) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    backupFile = `${dir}/line-user-id-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(backupFile, JSON.stringify({ planned, already, removeOld }, null, 2));

    for (const p of planned) {
      const res = await users.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id), lineId: p.lineId, line_user_id: { $in: [null, ""] } },
        { $set: { line_user_id: p.lineId } }
      );
      copied += res.modifiedCount;
    }
    for (const p of toRemove) {
      const res = await users.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id), lineId: p.lineId, line_user_id: p.lineId },
        { $unset: { lineId: "" } }
      );
      removedOld += res.modifiedCount;
    }
  }

  const who = (r: Row) => `${r.email ?? r._id} (${mask(r.lineId)})`;
  console.log(`migrate-line-user-id ${dryRun ? "(DRY-RUN — ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}${removeOld ? " + ลบ lineId" : ""}`);
  console.log(`  คัดลอก lineId → line_user_id: ${planned.length} คน${planned.length ? ` — ${planned.map(who).join(", ")}` : ""}`);
  console.log(`  ตรงกันอยู่แล้ว: ${already.length} คน`);
  if (conflicts.length) {
    console.log(`  ไม่แตะ (ต้องตรวจเอง): ${conflicts.length} คน`);
    for (const c of conflicts) console.log(`    - ${who(c)}: ${c.reason}`);
  }
  if (!dryRun) {
    console.log(`  คัดลอกสำเร็จ: ${copied}${removeOld ? ` · ลบ lineId: ${removedOld}` : ""}${backupFile ? ` · backup: ${backupFile}` : ""}`);
  }

  return { dryRun, removeOld, planned, already, conflicts, copied, removedOld, backupFile };
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runLineMigration({ apply: process.argv.includes("--apply"), removeOld: process.argv.includes("--remove-old") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
