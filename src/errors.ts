/**
 * Walk the full Error.cause chain, returning every message.
 * Non-Error tail causes (e.g. strings) are stringified rather than dropped.
 * Returns [String(err)] for non-Error thrown values.
 */
export function causeChain(err: unknown): readonly string[] {
  const msgs: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    msgs.push(current.message);
    current = current.cause;
  }
  // Capture non-Error tail cause (e.g. `new Error("x", { cause: "timeout" })`)
  if (current !== undefined && current !== null) {
    msgs.push(String(current));
  }
  if (msgs.length === 0) msgs.push(String(err));
  return msgs;
}
