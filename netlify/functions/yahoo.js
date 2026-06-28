const https = require('https');

exports.handler = async function(event) {
  const url = event.queryStringParameters && event.queryStringParameters.url;
  const search = event.queryStringParameters && event.queryStringParameters.search;
  
  let targetUrl;
  if (search) {
    targetUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(search)}&quotesCount=8&newsCount=0`;
  } else if (url && url.startsWith('https://query')) {
    targetUrl = url;
  } else {
    return { statusCode: 400, body: 'Bad request' };
  }

  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com/',
      'Origin': 'https://finance.yahoo.com'
    }
  };

  return new Promise((resolve) => {
    https.get(targetUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: data
        });
      });
    }).on('error', (e) => {
      resolve({ statusCode: 500, body: JSON.stringify({ error: e.message }) });
    });
  });
};
