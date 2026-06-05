const BASE_URL = "https://weread.111965.xyz";

let auth = { vid: null, token: null };

export function setAuth(vid, token) {
  auth.vid = vid;
  auth.token = token;
}

export function getAuth() {
  return { ...auth };
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (auth.vid && auth.token) {
    h["xid"] = String(auth.vid);
    h["Authorization"] = `Bearer ${auth.token}`;
  }
  return h;
}

export async function initiateLogin() {
  const res = await fetch(`${BASE_URL}/api/v2/login/platform`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Login init failed: ${res.status}`);
  return res.json();
}

export async function pollLogin(uuid) {
  const res = await fetch(`${BASE_URL}/api/v2/login/platform/${uuid}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Login poll failed: ${res.status}`);
  return res.json();
}

export async function wxs2mp(url) {
  const res = await fetch(`${BASE_URL}/api/v2/platform/wxs2mp`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Token expired, please re-login");
    if (res.status === 429) throw new Error("Rate limited, try again later");
    throw new Error(`wxs2mp failed: ${res.status}`);
  }
  return res.json();
}

export async function getArticles(mpId, page = 1) {
  const res = await fetch(
    `${BASE_URL}/api/v2/platform/mps/${mpId}/articles?page=${page}`,
    { method: "GET", headers: headers() }
  );
  if (!res.ok) {
    if (res.status === 401) throw new Error("Token expired, please re-login");
    if (res.status === 429) throw new Error("Rate limited, try again later");
    throw new Error(`Get articles failed: ${res.status}`);
  }
  return res.json();
}

export async function getArticlesAllPages(mpId, maxPages = 5) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    // Retry up to 5 times: the proxy may return empty arrays intermittently
    let articles = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      articles = await getArticles(mpId, page);
      if (articles && articles.length > 0) break;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 400));
    }
    if (!articles || articles.length === 0) break;
    all.push(...articles);
    if (articles.length < 20) break;
  }
  return all;
}
