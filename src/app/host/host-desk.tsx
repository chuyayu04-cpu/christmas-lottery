"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Theme = {
  id: string;
  name: string;
  description: string;
  quota: number;
  remaining: number;
  taken: number;
};

type HostState = {
  setup: boolean;
  authenticated: boolean;
  opened?: boolean;
  locked?: boolean;
  complete?: boolean;
  drawnCount?: number;
  participantLimit?: number;
  remainingTotal?: number;
  themes?: Theme[];
  error?: string;
};

const emptyThemes: Theme[] = [
  {
    id: "a",
    name: "療癒補給站",
    description: "讓收到禮物的人好好放鬆、充電。",
    quota: 4,
    remaining: 4,
    taken: 0,
  },
  {
    id: "b",
    name: "生活升級計畫",
    description: "平常不一定會買，但收到後會覺得生活變得更方便、更有質感。",
    quota: 4,
    remaining: 4,
    taken: 0,
  },
  {
    id: "c",
    name: "命運驚喜包",
    description: "不設限！只要是自己覺得有趣、值得分享，或能帶給別人驚喜的東西都可以。",
    quota: 4,
    remaining: 4,
    taken: 0,
  },
];

function BackLink({ onBack }: { onBack?: () => void }) {
  if (onBack) {
    return (
      <button type="button" className="footer-link" onClick={onBack}>
        回到抽籤頁
      </button>
    );
  }
  return (
    <Link className="footer-link" href="/">
      回到抽籤頁
    </Link>
  );
}

export default function HostDesk({ onBack }: { onBack?: () => void }) {
  const [state, setState] = useState<HostState | null>(null);
  const [pin, setPin] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [themes, setThemes] = useState<Theme[]>(emptyThemes);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<
    { displayName: string; themeName: string; themeDescription?: string }[] | null
  >(null);
  const shareUrl = useMemo(() => (typeof window === "undefined" ? "" : `${window.location.origin}/`), []);

  async function refresh() {
    try {
      const response = await fetch("/api/host", { cache: "no-store" });
      const data = (await response.json()) as HostState;
      if (response.ok) {
        setState(data);
        if (data.themes) {
          setThemes(
            data.themes.map((theme, index) => ({
              ...emptyThemes[index],
              ...theme,
              description: theme.description || emptyThemes[index].description,
            })),
          );
        }
        if (data.error) setError(data.error);
      } else if (response.status === 401) {
        setState({ setup: true, authenticated: false });
      } else {
        setError(data.error || "無法載入主持人頁面");
      }
    } catch {
      setError("網路不穩，請再試一次");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/host", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        error?: string;
        draws?: { displayName: string; themeName: string; themeDescription?: string }[];
      };
      if (!response.ok) {
        setError(data.error || "操作失敗");
        await refresh();
        return data;
      }
      await refresh();
      return data;
    } catch {
      setError("網路不穩，請再試一次");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function onAuth(event: FormEvent) {
    event.preventDefault();
    await post(
      state?.setup ? { action: "login", pin } : { action: "setup", pin, setupSecret },
    );
    setPin("");
    setSetupSecret("");
  }

  const quotaSum = themes.reduce((sum, theme) => sum + Number(theme.quota || 0), 0);
  const quotasOk =
    quotaSum === 12 && themes.every((theme) => Number.isInteger(theme.quota) && theme.quota >= 1);

  if (!state) {
    return (
      <main className="shell">
        <h1>主持人</h1>
        <section className="card">{error ? <p className="error">{error}</p> : "載入中…"}</section>
        <BackLink onBack={onBack} />
      </main>
    );
  }

  if (!state.authenticated) {
    return (
      <main className="shell">
        <p className="eyebrow">Host</p>
        <h1>{state.setup ? "主持人登入" : "第一次設定"}</h1>
        <p className="lede">
          {state.setup
            ? "輸入你當初自己設定的 PIN。沒有預設 PIN。"
            : "先填主辦人設定密鑰，再自己想一組 6 到 8 位數字 PIN。沒有預設 PIN。密鑰與 PIN 都不要傳給參加者。"}
        </p>
        <section className="card">
          <form onSubmit={onAuth}>
            {state.setup ? null : (
              <>
                <p className="muted">正式網站不會顯示密鑰，請用你在 Cursor Secrets 設的那一組。本機預覽請用 .env.local 裡的 HOST_SETUP_SECRET。</p>
                <label htmlFor="setupSecret">主辦人設定密鑰</label>
                <input
                  id="setupSecret"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={setupSecret}
                  onChange={(event) => setSetupSecret(event.target.value)}
                  required
                />
              </>
            )}
            <label htmlFor="pin">{state.setup ? "主持人 PIN" : "建立你的主持人 PIN"}</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              pattern={state.setup ? "\\d{4,8}" : "\\d{6,8}"}
              minLength={state.setup ? 4 : 6}
              maxLength={8}
              placeholder={state.setup ? "你當初設定的數字 PIN" : "6 到 8 位數字"}
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              required
            />
            <button className="btn" type="submit" disabled={busy}>
              {state.setup ? "登入" : "建立 PIN 並進入"}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </form>
        </section>
        <BackLink onBack={onBack} />
      </main>
    );
  }

  return (
    <main className="shell">
      <p className="eyebrow">Host desk</p>
      <h1>抽籤控制台</h1>
      <p className="lede">
        參加者只看得到自己的結果。你會看到各主題剩餘名額與已抽人數，不會看到是誰抽到什麼（抽完後才能揭示）。
      </p>

      <section className="card">
        <h2>活動連結</h2>
        <p className="muted">把這個網址傳給 12 位參加者，他們用手機打開就能抽。</p>
        <input type="text" readOnly value={shareUrl} />
        <button
          className="btn secondary"
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(shareUrl);
            setNotice("已複製參加連結");
          }}
        >
          複製參加連結
        </button>
        <p className="muted" style={{ marginTop: 12 }}>
          狀態：{state.opened ? "已開放抽籤" : "尚未開放"} · 已抽 {state.drawnCount ?? 0} /{" "}
          {state.participantLimit ?? 12} · 剩餘 {state.remainingTotal ?? 0}
        </p>
        {notice ? <p className="copy-ok">{notice}</p> : null}
      </section>

      <section className="card">
        <h2>主題與名額</h2>
        <p className="muted">
          三個主題已預填名稱與說明，名額為正整數，合計必須是 12。預設是 4、4、4。已有人抽過就不能再改，重置後可以再改。
        </p>
        {themes.map((theme, index) => (
          <div className="theme-edit" key={theme.id}>
            <label htmlFor={`theme-name-${theme.id}`}>名稱</label>
            <input
              id={`theme-name-${theme.id}`}
              type="text"
              maxLength={20}
              value={theme.name}
              disabled={state.locked}
              onChange={(event) => {
                const next = [...themes];
                next[index] = { ...theme, name: event.target.value };
                setThemes(next);
              }}
            />
            <label htmlFor={`theme-copy-${theme.id}`}>說明</label>
            <textarea
              id={`theme-copy-${theme.id}`}
              maxLength={80}
              value={theme.description ?? ""}
              disabled={state.locked}
              onChange={(event) => {
                const next = [...themes];
                next[index] = { ...theme, description: event.target.value };
                setThemes(next);
              }}
            />
            <label htmlFor={`theme-quota-${theme.id}`}>名額</label>
            <input
              id={`theme-quota-${theme.id}`}
              type="number"
              min={1}
              max={10}
              value={theme.quota}
              disabled={state.locked}
              onChange={(event) => {
                const next = [...themes];
                next[index] = { ...theme, quota: Number(event.target.value) };
                setThemes(next);
              }}
            />
          </div>
        ))}
        <p className={quotasOk ? "note" : "error"}>
          合計名額：{quotaSum}（必須是 12）
        </p>
        <button
          className="btn secondary"
          type="button"
          disabled={busy || state.locked || !quotasOk}
          onClick={() => post({ action: "save", themes, open: false })}
        >
          儲存主題與名額
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy || state.opened}
          onClick={() => post({ action: "save", themes, open: true })}
        >
          {state.opened ? "已開放抽籤" : "儲存並開放抽籤"}
        </button>
      </section>

      <section className="card">
        <h2>剩餘名額</h2>
        <div className="slots">
          {themes.map((theme) => (
            <div className="slot" key={theme.id}>
              <div>
                <strong>{theme.name}</strong>
                {theme.description ? <p className="note">{theme.description}</p> : null}
                <div className="bar">
                  <span style={{ width: `${theme.quota ? (theme.remaining / theme.quota) * 100 : 0}%` }} />
                </div>
              </div>
              <span>
                剩 {theme.remaining} / {theme.quota}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>抽完後揭示</h2>
        <p className="muted">全部名額抽完後，才能用主持人 PIN 的登入狀態查看誰抽到什麼，方便之後發禮物。</p>
        <button
          className="btn secondary"
          type="button"
          disabled={busy || !state.complete}
          onClick={async () => {
            const data = await post({ action: "reveal" });
            if (data?.draws) setRevealed(data.draws);
          }}
        >
          {state.complete ? "揭示結果" : "抽完後才可揭示"}
        </button>
        {revealed ? (
          <ul className="reveal-list">
            {revealed.map((row) => (
              <li key={row.displayName}>
                <div>
                  <strong>{row.displayName}</strong>
                </div>
                <div>
                  <strong>{row.themeName}</strong>
                  {row.themeDescription ? <p className="note">{row.themeDescription}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <button
          className="btn ghost"
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirm("確定要清空所有抽籤紀錄並回到尚未開放？PIN 會保留。")) {
              setRevealed(null);
              void post({ action: "reset" });
            }
          }}
        >
          重置活動
        </button>
        {error ? <p className="error">{error}</p> : null}
      </section>
      <BackLink onBack={onBack} />
    </main>
  );
}
