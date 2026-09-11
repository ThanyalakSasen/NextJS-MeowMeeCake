/**
 * logger — จุดออก log จุดเดียวของทั้ง backend (แทน console.* ที่กระจาย)
 *
 *   log.info("order.created", { order_id, total_amount });
 *   log.error("order.auto_refund_failed", { order_id, err });   // err: Error → serialize ให้อัตโนมัติ
 *
 * output = JSON บรรทัดเดียว (พร้อม timestamp + level + event) → parse ต่อด้วย log aggregator ได้
 * level ต่ำกว่า LOG_LEVEL จะถูกข้าม · LOG_LEVEL default: production="info", อื่น ๆ ="debug"
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function resolveMinLevel(): number {
  const env = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (env in RANK) return RANK[env as LogLevel];
  return process.env.NODE_ENV === "production" ? RANK.info : RANK.debug;
}

const MIN_LEVEL = resolveMinLevel();

function serializeErr(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

function emit(level: LogLevel, event: string, ctx?: Record<string, unknown>) {
  if (RANK[level] < MIN_LEVEL) return;

  const record: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    event,
    ...ctx,
  };
  if (ctx && "err" in ctx) record.err = serializeErr(ctx.err);

  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ t: record.t, level, event, note: "log payload not serializable" });
  }

  // eslint-disable-next-line no-console
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const log = {
  debug: (event: string, ctx?: Record<string, unknown>) => emit("debug", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit("info", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit("warn", event, ctx),
  error: (event: string, ctx?: Record<string, unknown>) => emit("error", event, ctx),
};

export default log;
