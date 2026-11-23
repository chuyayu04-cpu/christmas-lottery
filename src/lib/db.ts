import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
let pool: pg.Pool | undefined;
let local: Promise<PGlite> | undefined;
let mutex: Promise<void> = Promise.resolve();

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn);
  mutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

type QueryFn = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

export const sql: QueryFn = async (text, params = []) => {
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await pool.query(text, params)).rows as never;
  }
  return withMutex(async () => {
    local ??= startLocal().catch((error: unknown) => {
      local = undefined;
      throw error;
    });
    return (await (await local).query(text, params)).rows as never;
  });
};

export async function withTransaction<T>(fn: (query: QueryFn) => Promise<T>): Promise<T> {
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      const query: QueryFn = async (text, params = []) =>
        (await client.query(text, params)).rows as never;
      const result = await fn(query);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // ignore rollback failure
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return withMutex(async () => {
    local ??= startLocal().catch((error: unknown) => {
      local = undefined;
      throw error;
    });
    const db = await local;
    await db.query("begin");
    try {
      const query: QueryFn = async (text, params = []) =>
        (await db.query(text, params)).rows as never;
      const result = await fn(query);
      await db.query("commit");
      return result;
    } catch (error) {
      try {
        await db.query("rollback");
      } catch {
        // ignore
      }
      throw error;
    }
  });
}

async function startLocal(): Promise<PGlite> {
  const db = new PGlite();
  const files = (await readdir("migrations").catch(() => []))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  return db;
}
