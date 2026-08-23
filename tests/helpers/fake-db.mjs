export function statement(sql, handlers = {}) {
  return { sql, args: [], bind(...args) { this.args = args; return this; },
    first() { return handlers.first?.(this) ?? null; },
    all() { return handlers.all?.(this) ?? { results: [] }; },
    run() { return handlers.run?.(this) ?? { success: true, meta: { changes: 1 } }; } };
}
export function fakeDb(resolve, batch = async statements => statements.map(() => ({ success: true, meta: { changes: 1 } }))) {
  return { prepared: [], batches: [], prepare(sql) { const stmt = statement(sql, resolve(sql)); this.prepared.push(stmt); return stmt; },
    async batch(statements) { this.batches.push(statements); return batch(statements); } };
}
export async function responseJson(response) { return JSON.parse(await response.text()); }
