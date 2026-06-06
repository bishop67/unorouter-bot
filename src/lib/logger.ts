import pino from "pino";

const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === "development";

// Pino root. Stdout JSON in prod (Docker captures), pino-pretty in dev.
const root = pino({
  name: process.env.BOT_NAME?.trim() || "bot",
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  redact: {
    paths: ["token", "TOKEN", "*.token", "*.TOKEN", "password", "*.password"],
    remove: true,
  },
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    },
  }),
});

// Thin facade over pino. Keeps the (msg, attrs) call shape callers already use
// across the codebase and reorders to pino's native (attrs, msg) form.
type Attrs = Record<string, unknown> | undefined;
const adapt =
  (level: "debug" | "info" | "warn" | "error") =>
  (msg: string, attrs?: Attrs) =>
    attrs ? root[level](attrs, msg) : root[level](msg);

export const logger = {
  debug: adapt("debug"),
  info: adapt("info"),
  warn: adapt("warn"),
  error: adapt("error"),
  // Escape hatch for callers that want a scoped child logger.
  child: (bindings: Record<string, unknown>) => {
    const c = root.child(bindings);
    return {
      debug: (msg: string, attrs?: Attrs) =>
        attrs ? c.debug(attrs, msg) : c.debug(msg),
      info: (msg: string, attrs?: Attrs) =>
        attrs ? c.info(attrs, msg) : c.info(msg),
      warn: (msg: string, attrs?: Attrs) =>
        attrs ? c.warn(attrs, msg) : c.warn(msg),
      error: (msg: string, attrs?: Attrs) =>
        attrs ? c.error(attrs, msg) : c.error(msg),
    };
  },
};
