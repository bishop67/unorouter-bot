type Attrs = Record<string, unknown> | undefined;

function emit(stream: NodeJS.WriteStream, prefix: string, msg: string, attrs: Attrs) {
  stream.write(`${prefix} ${JSON.stringify({ msg, ...attrs })}\n`);
}

export const botLogger = {
  debug: (msg: string, attrs?: Attrs) => emit(process.stdout, "DBG", msg, attrs),
  info: (msg: string, attrs?: Attrs) => emit(process.stdout, "INF", msg, attrs),
  warn: (msg: string, attrs?: Attrs) => emit(process.stderr, "WRN", msg, attrs),
  error: (msg: string, attrs?: Attrs) => emit(process.stderr, "ERR", msg, attrs),
};

export const shutdownTelemetry = async (): Promise<void> => {};
