function isIgnorableWarning(warning: { code?: string; message?: string; name?: string }): boolean {
  return warning.code === 'DEP0040' && typeof warning.message === 'string' && warning.message.includes('punycode');
}

function normalizeWarningArgs(args: unknown[]): { code?: string; message?: string; name?: string } {
  const [warningArg, secondArg, thirdArg] = args;

  if (warningArg instanceof Error) {
    return {
      name: warningArg.name,
      message: warningArg.message,
      code: 'code' in warningArg ? String((warningArg as { code?: unknown }).code ?? '') || undefined : undefined,
    };
  }

  let name: string | undefined;
  let code: string | undefined;
  let message: string | undefined;

  if (typeof warningArg === 'string') {
    message = warningArg;
  }

  if (secondArg && typeof secondArg === 'object' && !Array.isArray(secondArg)) {
    const options = secondArg as { type?: unknown; code?: unknown };
    if (typeof options.type === 'string') name = options.type;
    if (typeof options.code === 'string') code = options.code;
  } else {
    if (typeof secondArg === 'string') name = secondArg;
    if (typeof thirdArg === 'string') code = thirdArg;
  }

  return { name, code, message };
}

const warningFilterState = Symbol.for('clawx.warning-filter');
const globalState = globalThis as typeof globalThis & {
  [warningFilterState]?: { installed: boolean };
};

if (!globalState[warningFilterState]?.installed) {
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((...args: unknown[]) => {
    if (isIgnorableWarning(normalizeWarningArgs(args))) {
      return;
    }

    Reflect.apply(originalEmitWarning, process, args);
  }) as typeof process.emitWarning;

  globalState[warningFilterState] = { installed: true };
}
