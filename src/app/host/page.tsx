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
    quota: 3,
    remaining: 3,
    taken: 0,
  },
  {
    id: "c",
    name: "命運驚喜包",
    description: "不設限！只要是自己覺得有趣、值得分享，或能帶給別人驚喜的東西都可以。",
    quota: 3,
    remaining: 3,
    taken: 0,
  },
];

export default function HostPage() {
  const [state, setState] = useState<HostState | null>(null);
  const [pin, setPin] = useState("");
  const [themes, setThemes] = useState<Theme[]>(emptyThemes);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<
    { displayName: string; themeName: string; themeDescription?: string }[] | null
  >(null);
  const shareUrl = useMemo(() => (typeof window === "undefined" ? "" : `${window.location.origin}/`), []);

  async function refresh() {
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
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
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
        return data;
      }
      await refresh();
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function onAuth(event: FormEvent) {
    event.preventDefault();
    await post({ action: state?.setup ? "login" : "setup", pin });
    setPin("");
  }

  const quotaSum = themes.reduce((sum, theme) => sum + Number(theme.quota || 0), 0);
  const quotasOk =
    quotaSum === 10 && themes.every((theme) => theme.quota === 3 || theme.quota === 4);

  if (!state) {
    return (
      <main className="shell">
        <h1>主持人</h1>
        <section className="card">載入中…</section>
      </main>
    );
  }

  if (!state.authenticated) {
    return (
      <main className="shell">
        <p className="eyebrow">Host</p>
        <h1>{state.setup ? "主持人登入" : "設定主持人 PIN"}</h1>
        <p className="lede">
          {state.setup
            ? "輸入 PIN 後可以看剩餘名額、開放抽籤，以及在全部抽完後揭示結果。"
            : "先設定 4 到 8 位數字 PIN，再改主題名稱與名額。請不要把 PIN 傳給參加者。"}
        </p>
        <section className="card">
          <form onSubmit={onAuth}>
            <label htmlFor="pin">主持人 PIN</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              maxLength={8}
              placeholder="例如 482910"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              required
            />
            <button className="btn" type="submit" disabled={busy}>
              {state.setup ? "登入" : "儲存 PIN"}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </form>
        </section>
        <Link className="footer-link" href="/">
          回到抽籤頁
        </Link>
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
        <p className="muted">把這個網址傳給 10 位參加者，他們用手機打開就能抽。</p>
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
          {state.participantLimit ?? 10} · 剩餘 {state.remainingTotal ?? 0}
        </p>
        {notice ? <p className="copy-ok">{notice}</p> : null}
      </section>

      <section className="card">
        <h2>主題與名額</h2>
        <p className="muted">
          三個主題已預填名稱與說明，每個名額只能填 3 或 4，合計必須是 10。預設是 4、3、3，開放抽籤前都還可以改。
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
            <label htmlFor={`theme-quota-${theme.id}`}>名額（3 或 4）</label>
            <input
              id={`theme-quota-${theme.id}`}
              type="number"
              min={3}
              max={4}
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
          合計名額：{quotaSum}（必須是 10，且每主題 3 或 4）
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
      <Link className="footer-link" href="/">
        回到抽籤頁
      </Link>
    </main>
  );
}
