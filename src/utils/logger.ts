type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  return env in LEVELS ? env : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[getConfiguredLevel()];
}

function format(level: LogLevel, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const base = JSON.stringify({ ts, level, message });
  if (meta === undefined) return base;
  try {
    const metaStr = JSON.stringify(meta);
    return base.slice(0, -1) + `,"meta":${metaStr}}`;
  } catch {
    return base;
  }
}

export const logger = {
  debug(message: string, meta?: unknown): void {
    if (shouldLog('debug')) console.debug(format('debug', message, meta));
  },
  info(message: string, meta?: unknown): void {
    if (shouldLog('info')) console.info(format('info', message, meta));
  },
  warn(message: string, meta?: unknown): void {
    if (shouldLog('warn')) console.warn(format('warn', message, meta));
  },
  error(message: string, meta?: unknown): void {
    if (shouldLog('error')) console.error(format('error', message, meta));
  },
};
