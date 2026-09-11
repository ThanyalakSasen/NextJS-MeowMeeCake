/**
 * crudRoutes — โรงงานสร้าง route handler (controller) มาตรฐานจาก CrudService
 *
 *   // src/app/api/units/route.ts
 *   export const { GET, POST } = collectionRoutes(unitService, {
 *     sortable: ["created_at", "unit_name"],
 *     defaultSort: "unit_name",
 *     auth: { menu: "products", publicRead: true },   // GET เปิด, POST ต้องมีสิทธิ์ products.create
 *     audit: { entity: "Unit" },                      // บันทึก UserLog เมื่อ create/update/delete/restore
 *   });
 *
 *   // src/app/api/units/[id]/route.ts
 *   export const { GET, PATCH, DELETE } = itemRoutes(unitService, { auth: {...}, audit: { entity: "Unit" } });
 *
 * auth (ไม่ใส่ = เปิดหมด — ใช้กับ endpoint ภายในเท่านั้น):
 *   - publicRead: true  → GET ไม่ต้องล็อกอิน ; POST/PATCH/DELETE ต้องมีสิทธิ์ create/update/delete ของ menu
 *   - publicRead: false → GET ต้องมีสิทธิ์ view ด้วย
 *
 * validate (ไม่ใส่ = รับ body ดิบเหมือนเดิม, service ตรวจเอง):
 *   - validate.create → parse body ของ POST ด้วย zod schema (บาด JSON / schema ผิด → 400 + issues)
 *   - validate.update → parse body ของ PATCH (ปกติเป็น createSchema.partial())
 */
import type { NextRequest } from "next/server";
import type { z } from "zod";
import { ok, okList, created, route } from "./apiResponse";
import { parseBool, parsePagination, parseSort } from "./queryParams";
import { parseBody } from "./validate";
import { requireAuth, requirePermission, type PermAction } from "./authGuard";
import type { SessionUser } from "./session";
import { audit } from "./audit";
import type { MenuKey } from "../services/permissionService";
import type { CrudService } from "./crudService";

type RouteContext = { params: Promise<{ id: string }> };

export interface CrudAuth {
  menu: MenuKey;
  /** GET (list/get) เปิดสาธารณะ ไม่ต้องล็อกอิน */
  publicRead?: boolean;
}

/** zod schema สำหรับ body ของ crud factory (ไม่ใส่ = รับ body ดิบ) */
export interface CrudValidate {
  create?: z.ZodType;
  update?: z.ZodType;
}

/** อ่าน body: มี schema → parseBody (throw 400 ถ้าไม่ผ่าน) · ไม่มี → req.json() แบบ tolerant เดิม
 *  (คืน Record<string, unknown> — ตรงกับ Doc ของ CrudService.create/update) */
async function readBody(
  req: NextRequest,
  schema: z.ZodType | undefined
): Promise<Record<string, unknown>> {
  // z.infer<z.ZodType> (base class, ไม่ใช่ schema เฉพาะ) resolve เป็น unknown — cast ให้ตรง signature
  if (schema) return (await parseBody(req, schema)) as Record<string, unknown>;
  return req.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

/** บันทึก audit log สำหรับ mutation ของ crud factory (ถ้าตั้ง opts.audit) */
export interface CrudAudit {
  /** ชื่อ entity ที่จะบันทึกลง UserLog เช่น "Ingredient", "Recipe" */
  entity: string;
}

/** ตรวจสิทธิ์ตาม config — no-op ถ้าไม่ได้ตั้ง auth */
async function guard(
  req: NextRequest,
  auth: CrudAuth | undefined,
  action: PermAction
): Promise<void> {
  if (!auth) return;
  if (action === "view" && auth.publicRead) return;
  const session = requireAuth(req);
  await requirePermission(session, auth.menu, action);
}

const ACTION_LABEL: Record<string, string> = {
  create: "สร้าง",
  update: "แก้ไข",
  delete: "ลบ",
  restore: "กู้คืน",
};

function logMutation(
  req: NextRequest,
  cfg: CrudAudit | undefined,
  op: "create" | "update" | "delete" | "restore",
  doc: { _id?: unknown } | null | undefined
): void {
  if (!cfg) return;
  audit(req, {
    action: `${ACTION_LABEL[op]}${cfg.entity}`,
    action_type: op === "create" ? "CREATE" : op === "delete" ? "DELETE" : "UPDATE",
    entity: cfg.entity,
    entity_id: doc?._id ? String(doc._id) : null,
  });
}

export interface CollectionRoutesOptions {
  sortable: string[];
  defaultSort: string;
  filterFromQuery?: (sp: URLSearchParams) => Record<string, unknown>;
  defaultLimit?: number;
  auth?: CrudAuth;
  audit?: CrudAudit;
  validate?: CrudValidate;
  /** ฟิลด์ที่ inject จาก session ตอน POST (เช่น { created_by: s.user_id }) — merge ทับ body
   *  กัน client ตั้งค่าเอง (mass-assign) · ต้องตั้ง `auth` ด้วยเพื่อให้มี session */
  createInject?: (session: SessionUser) => Record<string, unknown>;
}

export function collectionRoutes(
  service: Pick<CrudService, "list" | "create">,
  opts: CollectionRoutesOptions
) {
  const GET = route(async (req: NextRequest) => {
    await guard(req, opts.auth, "view");
    const sp = req.nextUrl.searchParams;
    const rawFilter = opts.filterFromQuery?.(sp) ?? {};
    const filter = Object.fromEntries(
      Object.entries(rawFilter).filter(([, v]) => v !== undefined)
    );

    const result = await service.list({
      pagination: parsePagination(sp, opts.defaultLimit),
      search: sp.get("search") ?? undefined,
      sort: parseSort(sp, opts.sortable, opts.defaultSort),
      includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
      filter,
    });
    return okList(result.items, result.meta);
  });

  const POST = route(async (req: NextRequest) => {
    await guard(req, opts.auth, "create");
    const body = await readBody(req, opts.validate?.create);
    const injected = opts.createInject ? opts.createInject(requireAuth(req)) : undefined;
    const doc = await service.create(injected ? { ...body, ...injected } : body);
    logMutation(req, opts.audit, "create", doc);
    return created(doc);
  });

  return { GET, POST };
}

export interface ItemRoutesOptions {
  auth?: CrudAuth;
  audit?: CrudAudit;
  validate?: CrudValidate;
}

export function itemRoutes(
  service: Pick<CrudService, "getById" | "update" | "remove">,
  opts: ItemRoutesOptions = {}
) {
  const GET = route(async (req: NextRequest, ctx: RouteContext) => {
    await guard(req, opts.auth, "view");
    const { id } = await ctx.params;
    const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
    return ok(await service.getById(id, includeDeleted));
  });

  const PATCH = route(async (req: NextRequest, ctx: RouteContext) => {
    await guard(req, opts.auth, "update");
    const { id } = await ctx.params;
    const body = await readBody(req, opts.validate?.update);
    const doc = await service.update(id, body);
    logMutation(req, opts.audit, "update", doc ?? { _id: id });
    return ok(doc);
  });

  const DELETE = route(async (req: NextRequest, ctx: RouteContext) => {
    await guard(req, opts.auth, "delete");
    const { id } = await ctx.params;
    const doc = await service.remove(id);
    logMutation(req, opts.audit, "delete", doc ?? { _id: id });
    return ok(doc);
  });

  return { GET, PATCH, DELETE };
}

/** route สำหรับ POST /api/xxx/[id]/restore */
export function restoreRoute(
  service: Pick<CrudService, "restore">,
  opts: ItemRoutesOptions = {}
) {
  const POST = route(async (req: NextRequest, ctx: RouteContext) => {
    await guard(req, opts.auth, "update");
    const { id } = await ctx.params;
    const doc = await service.restore(id);
    logMutation(req, opts.audit, "restore", doc ?? { _id: id });
    return ok(doc);
  });
  return { POST };
}
