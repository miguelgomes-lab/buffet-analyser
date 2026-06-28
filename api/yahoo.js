const https = require('https');
const http = require('http');

let cachedCrumb = null;
let cachedCookie = null;
let crumbExpiry = 0;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com'
};

function fetchUrl(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const options = { headers: { ...BROWSER_HEADERS, ...extraHeaders } };
    const req = lib.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, text: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function getYahooCrumb() {
  const now = Date.now();
  if (cachedCrumb && cachedCookie && now < crumbExpiry) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }
  try {
    const r1 = await fetchUrl('https://fc.yahoo.com');
    const cookieHeader = r1.headers['set-cookie'] || [];
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
    const cookie = cookies.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    const r2 = await fetchUrl('https://query1.finance.yahoo.com/v1/test/getcrumb', { 'Cookie': cookie });
    const crumb = r2.text.trim();
    if (crumb && crumb.length < 50 && !crumb.includes('<')) {
      cachedCrumb = crumb;
      cachedCookie = cookie;
      crumbExpiry = now + 30 * 60 * 1000;
    }
  } catch(e) {}
  return { crumb: cachedCrumb, cookie: cachedCookie };
}

async function yahooFetch(url) {
  const { crumb, cookie } = await getYahooCrumb();
  const extraHeaders = {};
  if (cookie) extraHeaders['Cookie'] = cookie;
  const fetchUrl2 = crumb ? url + (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(crumb) : url;
  let res = await fetchUrl(fetchUrl2, extraHeaders);
  if (res.status === 401 || res.status === 403) {
    cachedCrumb = null; cachedCookie = null; crumbExpiry = 0;
    const { crumb: c2, cookie: ck2 } = await getYahooCrumb();
    const h2 = ck2 ? { 'Cookie': ck2 } : {};
    const u2 = c2 ? url + (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(c2) : url;
    res = await fetchUrl(u2, h2);
  }
  return res;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { url, search } = req.query;

  try {
    if (search) {
      const searchUrl = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(search) + '&quotesCount=8&newsCount=0&enableFuzzyQuery=false';
      const r = await yahooFetch(searchUrl);
      res.status(r.status).send(r.text);
      return;
    }

    if (!url || !url.startsWith('https://query')) {
      res.status(400).json({ error: 'Bad request' });
      return;
    }

    const r = await yahooFetch(url);
    res.status(r.status).send(r.text);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
