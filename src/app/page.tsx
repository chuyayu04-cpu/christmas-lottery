"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Mine = { displayName: string; themeName: string };
type PublicState = {
  opened: boolean;
  complete: boolean;
  drawnCount: number;
  participantLimit: number;
  remainingTotal: number;
  setup: boolean;
  mine: Mine | null;
};

const OPENED_KEY = "lottery-gift-opened";

function GiftBox({
  mode,
  label,
  onOpen,
}: {
  mode: "idle" | "drawing" | "wrapped" | "opening" | "opened";
  label?: string;
  onOpen?: () => void;
}) {
  const clickable = mode === "wrapped";
  return (
    <button
      type="button"
      className={`present ${mode === "drawing" ? "shake" : ""} ${mode}`}
      onClick={clickable ? onOpen : undefined}
      disabled={!clickable}
      aria-label={clickable ? "打開禮物" : undefined}
    >
      <div className="secret">{label}</div>
      <div className="present-box">
        <span className="ribbon-v" />
        <span className="ribbon-h" />
      </div>
      <div className="present-lid">
        <span className="ribbon-v" />
        <span className="bow-left" />
        <span className="bow-right" />
      </div>
    </button>
  );
}

export default function HomePage() {
  const [state, setState] = useState<PublicState | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mine, setMine] = useState<Mine | null>(null);
  const [phase, setPhase] = useState<"form" | "drawing" | "wrapped" | "opening" | "revealed">("form");

  async function refresh() {
    const response = await fetch("/api/state", { cache: "no-store" });
    const data = (await response.json()) as PublicState;
    setState(data);
    if (data.mine) {
      setMine(data.mine);
      const opened = localStorage.getItem(OPENED_KEY) === "1";
      setPhase((current) => {
        if (current === "opening" || current === "drawing") return current;
        if (opened) return "revealed";
        if (current === "revealed") return "revealed";
        return "wrapped";
      });
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, []);

  async function onDraw(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    setPhase("drawing");
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const response = await fetch("/api/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await response.json()) as Mine & { error?: string };
      if (!response.ok) {
        setError(data.error || "抽籤失敗");
        setPhase("form");
        return;
      }
      localStorage.removeItem(OPENED_KEY);
      setMine({ displayName: data.displayName, themeName: data.themeName });
      setPhase("wrapped");
      await refresh();
    } catch {
      setError("網路不穩，請再試一次");
      setPhase("form");
    } finally {
      setBusy(false);
    }
  }

  function openGift() {
    if (phase !== "wrapped" || !mine) return;
    setPhase("opening");
    window.setTimeout(() => {
      localStorage.setItem(OPENED_KEY, "1");
      setPhase("revealed");
    }, 1400);
  }

  const waiting = state && !state.opened && phase === "form" && !mine;
  const giftMode =
    phase === "drawing"
      ? "drawing"
      : phase === "wrapped"
        ? "wrapped"
        : phase === "opening"
          ? "opening"
          : phase === "revealed"
            ? "opened"
            : "idle";

  return (
    <main className="shell">
      <p className="eyebrow">Christmas Gift Draw</p>
      <h1>聖誕禮物抽籤</h1>
      <p className="lede">每人只能抽一次。抽中後先是一份還沒打開的禮物，點下去才看得到主題，而且只有你看得到。</p>
      <div className="progress">
        <span>
          已抽出 {state?.drawnCount ?? 0} / {state?.participantLimit ?? 10} 人
        </span>
        <span>剩餘 {state?.remainingTotal ?? 10} 個名額</span>
      </div>

      <section className="card">
        {phase === "wrapped" || phase === "opening" || phase === "revealed" ? (
          <div className="present-wrap">
            <div className="tag" style={{ display: "inline-block" }}>
              僅你可見
            </div>
            <GiftBox mode={giftMode} label={mine?.themeName} onOpen={openGift} />
            {phase === "wrapped" ? (
              <>
                <h2>你抽到一份禮物</h2>
                <p className="muted">主題還包著，點禮物盒打開才看得到。打開前請先確認旁邊沒人偷看。</p>
                <button className="btn" type="button" onClick={openGift}>
                  打開禮物
                </button>
              </>
            ) : phase === "opening" ? (
              <>
                <h2>打開中…</h2>
                <p className="muted">蓋子掀開了。</p>
              </>
            ) : (
              <div className="result">
                <p className="muted" style={{ marginTop: 4 }}>
                  {mine?.displayName} 抽到的禮物主題是
                </p>
                <p className="theme">{mine?.themeName}</p>
                <p className="muted">請保密，等大家抽完再一起拆禮物。</p>
              </div>
            )}
          </div>
        ) : waiting ? (
          <div className="wait">
            <GiftBox mode="idle" />
            <h2>活動尚未開始</h2>
            <p className="muted">主持人正在設定主題與名額，開放後就可以抽了。</p>
          </div>
        ) : state?.complete ? (
          <div className="wait">
            <h2>名額已經抽完</h2>
            <p className="muted">這次抽籤結束了。若你已經抽過，結果仍會留在這台手機上。</p>
          </div>
        ) : (
          <form onSubmit={onDraw}>
            <GiftBox mode={phase === "drawing" ? "drawing" : "idle"} />
            <h2>輪到你抽了</h2>
            <p className="muted">輸入名字後抽出一份還沒打開的禮物。主題要等你親自點開才會出現。</p>
            <label htmlFor="name">你的名字</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              maxLength={20}
              placeholder="例如：小明"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <button className="btn" type="submit" disabled={busy || !name.trim()}>
              {phase === "drawing" ? "正在抽出禮物…" : "抽出我的禮物"}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </form>
        )}
      </section>
      <Link className="footer-link" href="/host">
        我是主持人
      </Link>
    </main>
  );
}
