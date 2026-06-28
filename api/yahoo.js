export const config = { runtime: "edge" };

let cachedCrumb = null;
let cachedCookie = null;
let crumbExpiry = 0;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer": "https://finance.yahoo.com/",
  "Origin": "https://finance.yahoo.com",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site"
};

async function getYahooCrumb() {
  const now = Date.now();
  if (cachedCrumb && cachedCookie && now < crumbExpiry) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }
  try {
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { ...BROWSER_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*" },
      redirect: "follow"
    });
    const cookieHeader = cookieRes.headers.get("set-cookie") || "";
    const cookie = cookieHeader.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...BROWSER_HEADERS, "Cookie": cookie }
    });
    const crumb = await crumbRes.text();
    if (crumb && crumb.length < 50 && !crumb.includes("<") && !crumb.includes("error")) {
      cachedCrumb = crumb.trim();
      cachedCookie = cookie;
      crumbExpiry = now + 30 * 60 * 1000;
    }
  } catch(e) {}
  return { crumb: cachedCrumb, cookie: cachedCookie };
}

async function yahooFetch(url, extraHeaders = {}) {
  const { crumb, cookie } = await getYahooCrumb();
  let fetchUrl = url;
  const fetchHeaders = { ...BROWSER_HEADERS, ...extraHeaders };
  if (cookie) fetchHeaders["Cookie"] = cookie;
  if (crumb) {
    const sep = url.includes("?") ? "&" : "?";
    fetchUrl = url + sep + "crumb=" + encodeURIComponent(crumb);
  }
  const res = await fetch(fetchUrl, { headers: fetchHeaders });
  // If 401, clear cache and retry once
  if (res.status === 401 || res.status === 403) {
    cachedCrumb = null; cachedCookie = null; crumbExpiry = 0;
    const { crumb: c2, cookie: ck2 } = await getYahooCrumb();
    const h2 = { ...BROWSER_HEADERS };
    if (ck2) h2["Cookie"] = ck2;
    const u2 = c2 ? url + (url.includes("?") ? "&" : "?") + "crumb=" + encodeURIComponent(c2) : url;
    return fetch(u2, { headers: h2 });
  }
  return res;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const search = searchParams.get("search");

  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "s-maxage=60, stale-while-revalidate=30"
  };

  // Yahoo Finance ticker search
  if (search) {
    try {
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(search)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`;
      const res = await yahooFetch(searchUrl);
      const data = await res.text();
      return new Response(data, { status: res.status, headers: { ...corsHeaders, "Cache-Control": "s-maxage=30" } });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (!url || !url.startsWith("https://query")) {
    return new Response("Bad request", { status: 400 });
  }

  try {
    const res = await yahooFetch(url);
    const data = await res.text();
    return new Response(data, { status: res.status, headers: corsHeaders });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
