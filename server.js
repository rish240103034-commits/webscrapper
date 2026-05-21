// server.js — AI Web Scraper backend
// Pure Node.js, zero dependencies, zero API keys needed

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;

// ── fetch helper with redirect support ──
function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Connection": "close",
      },
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        return fetchUrl(next).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data, baseUrl: `${parsed.protocol}//${parsed.hostname}` }));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Timed out")));
    req.end();
  });
}

// ── HTML parsers ──

function extractText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,"")
    .replace(/<style[\s\S]*?<\/style>/gi,"")
    .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1].trim();
    const text = extractText(m[2]).slice(0, 100).trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript")) continue;
    if (href.startsWith("/")) href = baseUrl + href;
    if (!href.startsWith("http")) continue;
    const category = href.includes(baseUrl) ? "internal" : "external";
    if (text) links.push({ text, url: href, category });
  }
  return links;
}

function extractImages(html, baseUrl) {
  const imgs = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let src = m[1].trim();
    if (src.startsWith("/")) src = baseUrl + src;
    if (!src.startsWith("http")) continue;
    const alt = m[2] || "";
    imgs.push({ src, alt });
  }
  return imgs;
}

function extractMeta(html) {
  const meta = {};
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleM) meta.title = extractText(titleM[1]);
  const descM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (descM) meta.description = descM[1];
  const kwM = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
  if (kwM) meta.keywords = kwM[1];
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle) meta.og_title = ogTitle[1];
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (ogDesc) meta.og_description = ogDesc[1];
  return meta;
}

function extractHeadings(html) {
  const headings = [];
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = extractText(m[2]).trim();
    if (text) headings.push({ level: m[1].toUpperCase(), text });
  }
  return headings;
}

function extractTables(html) {
  const tables = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tableM;
  while ((tableM = tableRe.exec(html)) !== null) {
    const rows = [];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rowM;
    while ((rowM = rowRe.exec(tableM[0])) !== null) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellM;
      while ((cellM = cellRe.exec(rowM[0])) !== null) {
        cells.push(extractText(cellM[1]).trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length > 1) tables.push(rows);
  }
  return tables;
}

function extractListItems(html) {
  const items = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = extractText(m[1]).trim();
    if (text && text.length > 2 && text.length < 300) items.push(text);
  }
  return [...new Set(items)];
}

function extractPrices(html) {
  const text = extractText(html);
  const prices = [];
  const re = /(?:₹|Rs\.?|INR|USD|\$|€|£)\s?[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s?(?:₹|Rs\.?|INR)/g;
  let m;
  while ((m = re.exec(text)) !== null) prices.push(m[0].trim());
  return [...new Set(prices)];
}

function extractEmails(html) {
  const text = extractText(html);
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(re) || [])];
}

function extractPhones(html) {
  const text = extractText(html);
  const re = /(?:\+91[\s\-]?)?[6-9]\d{9}|(?:\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/g;
  return [...new Set(text.match(re) || [])];
}

function extractStructured(html, schema, maxItems) {
  // Try to find repeating blocks (cards, list items, table rows)
  const text = extractText(html);
  const records = [];

  // Look for structured article/product blocks
  const blockRe = /<(?:article|div|li|tr)[^>]*class=["'][^"']*(?:item|card|product|post|result|row|entry)[^"']*["'][^>]*>([\s\S]*?)(?=<(?:article|div|li|tr)[^>]*class=["'][^"']*(?:item|card|product|post|result|row|entry)|$)/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null && records.length < maxItems) {
    const block = m[1];
    const record = {};
    schema.forEach(f => {
      const blockText = extractText(block);
      if (f.type === "url") {
        const urlM = block.match(/href=["']([^"']+)["']/);
        record[f.name] = urlM ? urlM[1] : null;
      } else if (f.type === "number") {
        const numM = blockText.match(/[\d,]+(?:\.\d+)?/);
        record[f.name] = numM ? parseFloat(numM[0].replace(/,/g,"")) : null;
      } else {
        // grab first meaningful text chunk
        const headM = block.match(/<(?:h[1-6]|strong|b|span|p|td)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b|span|p|td)>/i);
        record[f.name] = headM ? extractText(headM[1]).trim().slice(0,200) : blockText.slice(0,200) || null;
      }
    });
    if (Object.values(record).some(v => v !== null)) records.push(record);
  }

  // fallback: paragraph-based extraction
  if (!records.length) {
    const paraRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = paraRe.exec(html)) !== null && records.length < maxItems) {
      const t = extractText(m[1]).trim();
      if (t.length > 20) {
        const record = {};
        schema.forEach(f => { record[f.name] = t.slice(0,200); });
        records.push(record);
      }
    }
  }

  return records.slice(0, maxItems);
}

// ── CORS ──
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── SERVER ──
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("AI Web Scraper backend running ✓ — no API key needed!");
  }
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== "POST" || req.url !== "/scrape") {
    res.writeHead(404, CORS); return res.end(JSON.stringify({ error: "Use POST /scrape" }));
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  let payload;
  try { payload = JSON.parse(body); }
  catch { res.writeHead(400, CORS); return res.end(JSON.stringify({ error: "Invalid JSON" })); }

  const { targetUrl, schema = [], mode = "structured", maxItems = 10 } = payload;
  if (!targetUrl) { res.writeHead(400, CORS); return res.end(JSON.stringify({ error: "targetUrl required" })); }

  try {
    const { body: html, baseUrl, status } = await fetchUrl(targetUrl);

    let records = [];

    if (mode === "links") {
      records = extractLinks(html, baseUrl).slice(0, maxItems);

    } else if (mode === "summary") {
      const meta    = extractMeta(html);
      const text    = extractText(html);
      const headings = extractHeadings(html).slice(0, 10);
      const emails  = extractEmails(html);
      const phones  = extractPhones(html);
      const prices  = extractPrices(html);
      records = [{
        title:       meta.title || null,
        description: meta.description || null,
        keywords:    meta.keywords || null,
        headings:    headings.map(h => `${h.level}: ${h.text}`),
        emails,
        phones,
        prices,
        word_count:  text.split(/\s+/).length,
        text_preview: text.slice(0, 500),
      }];

    } else if (mode === "freeform") {
      const meta     = extractMeta(html);
      const links    = extractLinks(html, baseUrl).slice(0, 20);
      const headings = extractHeadings(html).slice(0, 15);
      const lists    = extractListItems(html).slice(0, maxItems);
      const tables   = extractTables(html).slice(0, 3);
      const emails   = extractEmails(html);
      const phones   = extractPhones(html);
      const prices   = extractPrices(html);
      const images   = extractImages(html, baseUrl).slice(0, 10);
      records = [{
        meta, headings, lists, links, tables,
        contacts: { emails, phones },
        prices, images,
      }];

    } else {
      // structured mode
      if (schema.length) {
        records = extractStructured(html, schema, maxItems);
      } else {
        // no schema — auto extract everything useful
        records = extractListItems(html).slice(0, maxItems).map(text => ({ text }));
      }
    }

    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      success: true,
      records,
      meta: {
        targetUrl,
        mode,
        recordCount: records.length,
        httpStatus: status,
        pageFetched: true,
        engine: "pure-node-parser",
      },
    }));

  } catch (e) {
    res.writeHead(500, CORS);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`AI Web Scraper backend running on port ${PORT} — no API key needed!`));
