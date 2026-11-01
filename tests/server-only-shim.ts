import Module from "node:module";
import path from "node:path";

// Test-only: plain Node can't resolve "server-only" (Next replaces it with an
// empty module at build time, and the package in next/dist/compiled throws).
// This points the bare specifier at Next's own empty stub, once per worker,
// then imports the module. Specs that load server-only modules (n8n.ts,
// db/webhooks.ts, db/incidents.ts, ai/incidents.ts) import it through here.
// Importing this file has no side effects.

let patched = false;

export async function importServerModule<T>(specifier: string): Promise<T> {
  if (!patched) {
    const emptyServerOnly = path.join(path.dirname(require.resolve("next/package.json")), "dist/compiled/server-only/empty.js");
    const hooked = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
    const original = hooked._resolveFilename;
    hooked._resolveFilename = function (request: string, ...rest: unknown[]) {
      return original.call(this, request === "server-only" ? emptyServerOnly : request, ...rest);
    };
    patched = true;
  }
  return (await import(specifier)) as T;
}
