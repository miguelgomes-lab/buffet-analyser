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
  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: { ...BROWSER_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*" },
    redirect: "follow"
  });
  const cookieHeader = cookieRes.headers.get("set-cookie") || "";
  const cookie = cookieHeader.split(",").map(c => c.split(";")[0].trim()).join("; ");
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...BROWSER_HEADERS, "Cookie": cookie }
  });
  const crumb = await crumbRes.text();
  if (crumb && !crumb.includes("404") && !crumb.includes("error")) {
    cachedCrumb = crumb.trim();
    cachedCookie = cookie;
    crumbExpiry = now + 30 * 60 * 1000;
  }
  return { crumb: cachedCrumb, cookie: cachedCookie };
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const search = searchParams.get("search");

  // Yahoo Finance ticker search
  if (search) {
    try {
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(search)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`;
      const res = await fetch(searchUrl, { headers: BROWSER_HEADERS });
      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "s-maxage=30" }
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }

  if (!url || !url.startsWith("https://query")) {
    return new Response("Bad request", { status: 400 });
  }

  try {
    let fetchUrl = url;
    let fetchHeaders = { ...BROWSER_HEADERS };

    if (url.includes("/v10/finance/quoteSummary") || url.includes("/v1/test/getcrumb")) {
      const { crumb, cookie } = await getYahooCrumb();
      if (crumb) {
        const sep = url.includes("?") ? "&" : "?";
        fetchUrl = url + sep + "crumb=" + encodeURIComponent(crumb);
      }
      if (cookie) fetchHeaders["Cookie"] = cookie;
    }

    const res = await fetch(fetchUrl, { headers: fetchHeaders });

    if ((res.status === 401 || res.status === 403) && url.includes("/v10/")) {
      cachedCrumb = null; cachedCookie = null; crumbExpiry = 0;
      const { crumb, cookie } = await getYahooCrumb();
      const sep = url.includes("?") ? "&" : "?";
      const retryUrl = crumb ? url + sep + "crumb=" + encodeURIComponent(crumb) : url;
      const retryHeaders = cookie ? { ...BROWSER_HEADERS, Cookie: cookie } : BROWSER_HEADERS;
      const res2 = await fetch(retryUrl, { headers: retryHeaders });
      const data2 = await res2.text();
      return new Response(data2, {
        status: res2.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "s-maxage=60" }
      });
    }

    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "s-maxage=60, stale-while-revalidate=30" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
