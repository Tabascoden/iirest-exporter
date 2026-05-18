import type { LogEntry } from "../messages";
import type { SupplierId } from "../suppliers/types";

export function createLogEntry(
  message: string,
  level: LogEntry["level"] = "info",
  context: { supplierId?: SupplierId; query?: string } = {}
): LogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    level,
    message,
    ...context
  };
}

export function formatLogTime(isoDate: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(isoDate));
}
