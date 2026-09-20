export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type SafeLogContext = Readonly<Record<string, string | number | boolean | null | undefined>>;

export interface Logger {
  log(level: LogLevel, message: string, context?: SafeLogContext): void;
}

export const createJsonLogger = (sink: (record: string) => void = console.log): Logger => ({
  log(level, message, context = {}) {
    sink(JSON.stringify({ level, message, ...context }));
  },
});
