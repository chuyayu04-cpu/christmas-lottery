import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashSecret, randomToken, secretsMatch, verifySecret } from "./crypto";
import { sql, withTransaction } from "./db";

export const PARTICIPANT_LIMIT = 10;
export const THEME_COUNT = 3;
export const DEFAULT_QUOTAS = [4, 3, 3] as const;
export const DEFAULT_THEMES = [
  {
    id: "a",
    name: "療癒補給站",
    description: "讓收到禮物的人好好放鬆、充電。",
    quota: 4,
  },
  {
    id: "b",
    name: "生活升級計畫",
    description: "平常不一定會買，但收到後會覺得生活變得更方便、更有質感。",
    quota: 3,
  },
  {
    id: "c",
    name: "命運驚喜包",
    description: "不設限！只要是自己覺得有趣、值得分享，或能帶給別人驚喜的東西都可以。",
    quota: 3,
  },
] as const;

export class LotteryError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
    this.name = "LotteryError";
  }
}

export type Theme = {
  id: string;
  name: string;
  description: string;
  quota: number;
  remaining: number;
};

export type Draw = {
  participantKey: string;
  displayName: string;
  token: string;
  themeId: string;
  drawnAt: string;
};

export type LotteryState = {
  hostPinHash: string | null;
  hostSessionHash: string | null;
  hostLoginFailures?: number;
  hostLoginLockedUntil?: number | null;
  opened: boolean;
  themes: Theme[];
  draws: Draw[];
};

const FILE_PATH = path.join(process.cwd(), "data", "lottery.json");
const usePostgres = Boolean(process.env.DATABASE_URL?.trim());
let fileMutex: Promise<void> = Promise.resolve();

function withFileMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileMutex.then(fn, fn);
  fileMutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function defaultState(): LotteryState {
  return {
    hostPinHash: null,
    hostSessionHash: null,
    opened: false,
    themes: DEFAULT_THEMES.map((theme) => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      quota: theme.quota,
      remaining: theme.quota,
    })),
    draws: [],
  };
}

function hydrateThemes(themes: Theme[] | undefined): Theme[] {
  return DEFAULT_THEMES.map((fallback, index) => {
    const current = themes?.[index];
    const placeholder = `主題 ${String.fromCharCode(65 + index)}`;
    const name = current?.name && current.name !== placeholder ? current.name : fallback.name;
    return {
      id: current?.id ?? fallback.id,
      name,
      description: current?.description?.trim() || fallback.description,
      quota: current?.quota ?? fallback.quota,
      remaining: current?.remaining ?? fallback.quota,
    };
  });
}

function cloneState(state: LotteryState): LotteryState {
  return structuredClone(state);
}

async function readFileState(): Promise<LotteryState> {
  try {
    const raw = await readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as LotteryState;
    if (!parsed?.themes?.length) return defaultState();
    parsed.themes = hydrateThemes(parsed.themes);
    return parsed;
  } catch {
    return defaultState();
  }
}

async function writeFileState(state: LotteryState) {
  await mkdir(path.dirname(FILE_PATH), { recursive: true });
  const tmp = `${FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(state), "utf8");
  await rename(tmp, FILE_PATH);
}

async function loadPgState(
  query: typeof sql = sql,
): Promise<{ state: LotteryState; version: number }> {
  const rows = await query<{ data: LotteryState; version: number }>(
    "select data, version from lottery_kv where id = $1",
    ["main"],
  );
  if (!rows[0]) {
    const state = defaultState();
    await query(
      "insert into lottery_kv (id, data, version) values ($1, $2::jsonb, 0) on conflict (id) do nothing",
      ["main", JSON.stringify(state)],
    );
    return loadPgState(query);
  }
  const data = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
  data.themes = hydrateThemes(data.themes);
  return { state: data, version: rows[0].version };
}

async function mutate<T>(fn: (state: LotteryState) => Promise<T> | T): Promise<T> {
  if (usePostgres) {
    return withTransaction(async (query) => {
      await query(
        "insert into lottery_kv (id, data, version) values ($1, $2::jsonb, 0) on conflict (id) do nothing",
        ["main", JSON.stringify(defaultState())],
      );
      await query("select id from lottery_kv where id = $1 for update", ["main"]);
      const { state } = await loadPgState(query);
      const result = await fn(state);
      await query("update lottery_kv set data = $2::jsonb, version = version + 1 where id = $1", [
        "main",
        JSON.stringify(state),
      ]);
      return result;
    });
  }
  return withFileMutex(async () => {
    const state = await readFileState();
    const result = await fn(state);
    await writeFileState(state);
    return result;
  });
}

async function readState(): Promise<LotteryState> {
  if (usePostgres) {
    return (await loadPgState()).state;
  }
  return withFileMutex(() => readFileState());
}

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function participantKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase("zh-Hant");
}

function drawnCount(state: LotteryState): number {
  return state.draws.length;
}

function remainingTotal(state: LotteryState): number {
  return state.themes.reduce((sum, theme) => sum + theme.remaining, 0);
}

function isComplete(state: LotteryState): boolean {
  return remainingTotal(state) <= 0 || drawnCount(state) >= PARTICIPANT_LIMIT;
}

function publicThemes(state: LotteryState) {
  return state.themes.map((theme) => ({ id: theme.id, name: theme.name }));
}

export async function getPublicState() {
  const state = await readState();
  return {
    opened: state.opened,
    complete: isComplete(state),
    drawnCount: drawnCount(state),
    participantLimit: PARTICIPANT_LIMIT,
    remainingTotal: remainingTotal(state),
    themes: publicThemes(state),
    setup: Boolean(state.hostPinHash),
  };
}

export async function getMyResult(token: string | undefined) {
  if (!token) return null;
  const state = await readState();
  const draw = state.draws.find((item) => item.token === token);
  if (!draw) return null;
  const theme = state.themes.find((item) => item.id === draw.themeId);
  return {
    displayName: draw.displayName,
    themeId: draw.themeId,
    themeName: theme?.name ?? draw.themeId,
    themeDescription: theme?.description ?? "",
    drawnAt: draw.drawnAt,
  };
}

function pickTheme(state: LotteryState): Theme {
  const bag = state.themes.flatMap((theme) => Array.from({ length: theme.remaining }, () => theme));
  if (bag.length === 0) {
    throw new LotteryError("名額已經抽完了", "complete", 409);
  }
  const index = Math.floor(Math.random() * bag.length);
  return bag[index];
}

export async function draw(input: { name: string; token?: string }) {
  const displayName = normalizeName(input.name);
  if (displayName.length < 1 || displayName.length > 20) {
    throw new LotteryError("請輸入 1 到 20 字的名字", "invalid_name");
  }
  const key = participantKey(displayName);

  return mutate((state) => {
    if (!state.opened) {
      throw new LotteryError("活動尚未開始，請等主持人開放抽籤", "not_open", 409);
    }
    if (input.token) {
      const mine = state.draws.find((item) => item.token === input.token);
      if (mine) {
        const theme = state.themes.find((item) => item.id === mine.themeId);
        return {
          already: true,
          token: mine.token,
          displayName: mine.displayName,
          themeId: mine.themeId,
          themeName: theme?.name ?? mine.themeId,
          themeDescription: theme?.description ?? "",
        };
      }
    }
    const existing = state.draws.find((item) => item.participantKey === key);
    if (existing) {
      throw new LotteryError("這個名字已經抽過了", "already_drawn", 409);
    }
    if (isComplete(state)) {
      throw new LotteryError("名額已經抽完了", "complete", 409);
    }
    const theme = pickTheme(state);
    if (theme.remaining <= 0) {
      throw new LotteryError("名額已經抽完了", "complete", 409);
    }
    theme.remaining -= 1;
    const token = input.token && input.token.length >= 16 ? input.token : randomToken();
    const record: Draw = {
      participantKey: key,
      displayName,
      token,
      themeId: theme.id,
      drawnAt: new Date().toISOString(),
    };
    state.draws.push(record);
    return {
      already: false,
      token,
      displayName,
      themeId: theme.id,
      themeName: theme.name,
      themeDescription: theme.description,
    };
  });
}

async function requireHost(state: LotteryState, session: string | undefined) {
  if (!state.hostPinHash) {
    throw new LotteryError("尚未設定主持人 PIN", "not_setup", 401);
  }
  if (!session || !state.hostSessionHash) {
    throw new LotteryError("請先輸入主持人 PIN", "unauthorized", 401);
  }
  if (!(await verifySecret(session, state.hostSessionHash))) {
    throw new LotteryError("請先輸入主持人 PIN", "unauthorized", 401);
  }
}

export async function setupHost(pin: string, setupSecret: string) {
  const expected = process.env.HOST_SETUP_SECRET?.trim() ?? "";
  if (expected.length < 8) {
    throw new LotteryError("主持人設定尚未就緒", "setup_unconfigured", 503);
  }
  if (!secretsMatch(setupSecret.trim(), expected)) {
    throw new LotteryError("設定密鑰不正確", "invalid_setup_secret", 401);
  }
  const cleaned = pin.trim();
  if (!/^\d{4,8}$/.test(cleaned)) {
    throw new LotteryError("PIN 請設 4 到 8 位數字", "invalid_pin");
  }
  const session = randomToken();
  await mutate(async (state) => {
    if (state.hostPinHash) {
      throw new LotteryError("主持人 PIN 已設定，請改用登入", "already_setup", 409);
    }
    state.hostPinHash = await hashSecret(cleaned);
    state.hostSessionHash = await hashSecret(session);
  });
  return { session };
}

const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export async function loginHost(pin: string) {
  const cleaned = pin.trim();
  const session = randomToken();
  const outcome = await mutate(async (state) => {
    const now = Date.now();
    if (state.hostLoginLockedUntil && state.hostLoginLockedUntil > now) {
      return { ok: false as const, code: "locked_out" as const, remaining: 0 };
    }
    if (!state.hostPinHash) {
      return { ok: false as const, code: "not_setup" as const };
    }
    if (!(await verifySecret(cleaned, state.hostPinHash))) {
      const failures = (state.hostLoginFailures ?? 0) + 1;
      state.hostLoginFailures = failures;
      if (failures >= LOGIN_MAX_FAILURES) {
        state.hostLoginLockedUntil = now + LOGIN_LOCKOUT_MS;
        state.hostLoginFailures = 0;
        return { ok: false as const, code: "locked_out" as const, remaining: 0 };
      }
      return {
        ok: false as const,
        code: "invalid_pin" as const,
        remaining: LOGIN_MAX_FAILURES - failures,
      };
    }
    state.hostLoginFailures = 0;
    state.hostLoginLockedUntil = null;
    state.hostSessionHash = await hashSecret(session);
    return { ok: true as const };
  });
  if (!outcome.ok) {
    if (outcome.code === "locked_out") {
      throw new LotteryError("嘗試太多次，請 15 分鐘後再試", "locked_out", 429);
    }
    if (outcome.code === "not_setup") {
      throw new LotteryError("尚未設定主持人 PIN", "not_setup", 401);
    }
    const left = outcome.code === "invalid_pin" ? outcome.remaining : 0;
    const hint =
      left <= 1 ? "PIN 不正確，還剩最後 1 次機會" : `PIN 不正確，還剩 ${left} 次機會`;
    throw new LotteryError(hint, "invalid_pin", 401);
  }
  return { session };
}

export async function getHostState(session: string | undefined) {
  const state = cloneState(await readState());
  await requireHost(state, session);
  return {
    opened: state.opened,
    locked: state.draws.length > 0,
    complete: isComplete(state),
    drawnCount: drawnCount(state),
    participantLimit: PARTICIPANT_LIMIT,
    remainingTotal: remainingTotal(state),
    themes: state.themes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      quota: theme.quota,
      remaining: theme.remaining,
      taken: theme.quota - theme.remaining,
    })),
  };
}

export async function saveThemes(
  session: string | undefined,
  themes: { id: string; name: string; description?: string; quota: number }[],
  open: boolean,
) {
  if (!Array.isArray(themes) || themes.length !== THEME_COUNT) {
    throw new LotteryError("需要剛好 3 個主題", "invalid_quotas");
  }
  const quotas = themes.map((theme) => Number(theme.quota));
  if (quotas.some((quota) => !Number.isInteger(quota) || quota < 3 || quota > 4)) {
    throw new LotteryError("每個主題名額只能是 3 或 4", "invalid_quotas");
  }
  const sum = quotas.reduce((a, b) => a + b, 0);
  if (sum !== PARTICIPANT_LIMIT) {
    throw new LotteryError(`三個主題名額合計必須是 ${PARTICIPANT_LIMIT}（目前是 ${sum}）`, "invalid_quotas");
  }
  const names = themes.map((theme) => normalizeName(theme.name));
  if (names.some((name) => name.length < 1 || name.length > 20)) {
    throw new LotteryError("主題名稱請填 1 到 20 字", "invalid_name");
  }
  const descriptions = themes.map((theme, index) => {
    const text = normalizeName(String(theme.description ?? ""));
    return text || DEFAULT_THEMES[index].description;
  });
  if (descriptions.some((text) => text.length < 1 || text.length > 80)) {
    throw new LotteryError("主題說明請填 1 到 80 字", "invalid_name");
  }

  await mutate(async (state) => {
    await requireHost(state, session);
    if (state.draws.length > 0) {
      throw new LotteryError("已有人抽過，無法再改名額", "locked", 409);
    }
    state.themes = themes.map((theme, index) => ({
      id: state.themes[index]?.id ?? theme.id,
      name: names[index],
      description: descriptions[index],
      quota: quotas[index],
      remaining: quotas[index],
    }));
    if (open) state.opened = true;
  });
}

export async function openEvent(session: string | undefined) {
  await mutate(async (state) => {
    await requireHost(state, session);
    state.opened = true;
  });
}

export async function reveal(session: string | undefined) {
  const state = cloneState(await readState());
  await requireHost(state, session);
  if (!isComplete(state)) {
    throw new LotteryError("全部名額抽完後才能揭示結果", "not_complete", 409);
  }
  return {
    draws: state.draws.map((draw) => {
      const theme = state.themes.find((item) => item.id === draw.themeId);
      return {
        displayName: draw.displayName,
        themeName: theme?.name ?? draw.themeId,
        themeDescription: theme?.description ?? "",
        drawnAt: draw.drawnAt,
      };
    }),
  };
}

export async function resetEvent(session: string | undefined) {
  await mutate(async (state) => {
    await requireHost(state, session);
    const pinHash = state.hostPinHash;
    const sessionHash = state.hostSessionHash;
    const next = defaultState();
    next.hostPinHash = pinHash;
    next.hostSessionHash = sessionHash;
    next.opened = false;
    Object.assign(state, next);
  });
}

export function developmentSetupHint(): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  const value = process.env.HOST_SETUP_SECRET?.trim() ?? "";
  return value.length >= 8 ? value : undefined;
}

export async function hostStatus() {
  const state = await readState();
  const now = Date.now();
  const loginLocked = Boolean(state.hostLoginLockedUntil && state.hostLoginLockedUntil > now);
  const failures = state.hostLoginFailures ?? 0;
  return {
    setup: Boolean(state.hostPinHash),
    loginLocked,
    loginAttemptsLeft: loginLocked ? 0 : Math.max(0, LOGIN_MAX_FAILURES - failures),
  };
}
