const fetch = require('node:https');

const data = JSON.stringify({
  path: "skills:listPublicPageV4",
  format: "convex_encoded_json",
  args: [{
    dir: "desc",
    nonSuspiciousOnly: true,
    numItems: 12,
    sort: "downloads"
  }]
});

const options = {
  hostname: 'wry-manatee-359.convex.cloud',
  port: 443,
  path: '/api/query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = fetch.request(options, (res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => {
    console.log(body);
  });
});

req.on('error', (e) => {
  console.error(e);
});

req.write(data);
req.end();
