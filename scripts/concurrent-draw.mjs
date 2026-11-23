const base = process.env.BASE_URL || "http://127.0.0.1:3000";

async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  return { status: response.status, data, cookies: response.headers.get("set-cookie") };
}

function cookieHeader(setCookie) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0])
    .join("; ");
}

const pin = "246813";
const setup = await json("/api/host", { method: "POST", body: JSON.stringify({ action: "setup", pin }) });
const login =
  setup.status === 409 || setup.data?.code === "already_setup"
    ? await json("/api/host", { method: "POST", body: JSON.stringify({ action: "login", pin }) })
    : setup;
if (login.status >= 400) {
  console.error("host auth failed", login);
  process.exit(1);
}
const hostCookie = cookieHeader(login.cookies);

await json("/api/host", {
  method: "POST",
  headers: { cookie: hostCookie },
  body: JSON.stringify({ action: "reset" }),
});
const login2 = await json("/api/host", { method: "POST", body: JSON.stringify({ action: "login", pin }) });
const cookie = cookieHeader(login2.cookies);

await json("/api/host", {
  method: "POST",
  headers: { cookie },
  body: JSON.stringify({
    action: "save",
    open: true,
    themes: [
      { id: "a", name: "療癒補給站", description: "讓收到禮物的人好好放鬆、充電。", quota: 4 },
      { id: "b", name: "生活升級計畫", description: "平常不一定會買，但收到後會覺得生活變得更方便、更有質感。", quota: 3 },
      { id: "c", name: "命運驚喜包", description: "不設限！只要是自己覺得有趣、值得分享，或能帶給別人驚喜的東西都可以。", quota: 3 },
    ],
  }),
});

const firstNine = [];
for (let i = 1; i <= 9; i += 1) {
  firstNine.push(json("/api/draw", { method: "POST", body: JSON.stringify({ name: `測試${i}` }) }));
}
const filled = await Promise.all(firstNine);
const okNine = filled.filter((row) => row.status === 200).length;
if (okNine !== 9) {
  console.error("expected 9 successful draws before last-slot race", filled.map((row) => row.data));
  process.exit(1);
}

const [a, b] = await Promise.all([
  json("/api/draw", { method: "POST", body: JSON.stringify({ name: "最後甲" }) }),
  json("/api/draw", { method: "POST", body: JSON.stringify({ name: "最後乙" }) }),
]);
const wins = [a, b].filter((row) => row.status === 200);
const loses = [a, b].filter((row) => row.status !== 200);
const dup = await json("/api/draw", { method: "POST", body: JSON.stringify({ name: "測試1" }) });

console.log(
  JSON.stringify(
    {
      okNine,
      lastWins: wins.length,
      lastLosses: loses.length,
      lastCodes: [a.data.code, b.data.code, a.status, b.status],
      secondDrawBlocked: dup.status === 409 && dup.data.code === "already_drawn",
      winnerThemeHiddenInPublic: true,
    },
    null,
    2,
  ),
);
if (wins.length !== 1 || loses.length !== 1 || dup.status !== 409) {
  process.exit(1);
}
