// server.js — AI Web Scraper backend v3
// Pure Node.js, zero dependencies, zero API keys

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;

// ── fetch with redirect support ──────────────────────────────
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
      res.on("end", () => resolve({
        status: res.statusCode,
        body: data,
        baseUrl: `${parsed.protocol}//${parsed.hostname}`,
        hostname: parsed.hostname,
      }));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Request timed out after 10s")));
    req.end();
  });
}

// ── text cleaner ─────────────────────────────────────────────
function clean(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

// ── extractors ───────────────────────────────────────────────

function getMeta(html) {
  const get = (re) => { const m = html.match(re); return m ? m[1].trim() : null; };
  return {
    title:          get(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description:    get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                 || get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i),
    keywords:       get(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i),
    author:         get(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i),
    og_title:       get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    og_description: get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    og_image:       get(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
    canonical:      get(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    charset:        get(/<meta[^>]+charset=["']?([^"'\s>]+)/i),
    viewport:       get(/<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']+)["']/i),
  };
}

function getHeadings(html) {
  const out = [];
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = clean(m[2]).trim();
    if (text && text.length < 300) out.push({ level: m[1].toUpperCase(), text });
  }
  return out;
}

function getLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1].trim();
    const text = clean(m[2]).slice(0, 120).trim();
    if (!href || href.startsWith("javascript") || href.startsWith("mailto:")) continue;
    if (href.startsWith("/")) href = baseUrl + href;
    if (!href.startsWith("http")) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const isInternal = href.includes(new URL(baseUrl).hostname);
    links.push({ text: text || href, url: href, type: isInternal ? "internal" : "external" });
  }
  return links;
}

function getEmails(text) {
  return [...new Set((text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []))];
}

function getPhones(text) {
  const re = /(?:\+91[\s\-]?)?[6-9]\d{9}|(?:\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/g;
  return [...new Set((text.match(re) || []).map(p => p.trim()))];
}

function getPrices(text) {
  const re = /(?:₹|Rs\.?|INR|USD|\$|€|£)\s?[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s?(?:₹|Rs\.?|INR)/g;
  return [...new Set((text.match(re) || []).map(p => p.trim()))];
}

function getImages(html, baseUrl) {
  const imgs = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let src = m[1].trim();
    const altM = m[0].match(/alt=["']([^"']*)["']/i);
    const alt = altM ? altM[1] : "";
    if (src.startsWith("/")) src = baseUrl + src;
    if (src.startsWith("http")) imgs.push({ src, alt });
  }
  return imgs;
}

function getTables(html) {
  const tables = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tM;
  while ((tM = tableRe.exec(html)) !== null) {
    const rows = [];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rM;
    while ((rM = rowRe.exec(tM[0])) !== null) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cM;
      while ((cM = cellRe.exec(rM[0])) !== null) cells.push(clean(cM[1]).trim());
      if (cells.length) rows.push(cells);
    }
    if (rows.length > 1) tables.push(rows);
  }
  return tables;
}

function getListItems(html) {
  const items = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = clean(m[1]).trim();
    if (t.length > 2 && t.length < 400) items.push(t);
  }
  return [...new Set(items)];
}

function getParagraphs(html) {
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = clean(m[1]).trim();
    if (t.length > 40) paras.push(t);
  }
  return paras;
}

function getScripts(html) {
  const libs = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) libs.push(m[1]);
  return libs;
}

function getStyles(html) {
  const sheets = [];
  const re = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) sheets.push(m[1]);
  return sheets;
}

function getSocialLinks(links) {
  const platforms = { facebook:"Facebook", twitter:"Twitter/X", instagram:"Instagram", linkedin:"LinkedIn", youtube:"YouTube", github:"GitHub", whatsapp:"WhatsApp", telegram:"Telegram", pinterest:"Pinterest" };
  const found = [];
  links.forEach(l => {
    for (const [key, name] of Object.entries(platforms)) {
      if (l.url.includes(key)) found.push({ platform: name, url: l.url });
    }
  });
  return found;
}

function getWordFrequency(text, topN = 20) {
  const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","this","that","these","those","it","its","we","our","you","your","they","their","he","his","she","her","i","my","me","us","not","no","so","if","as","up","out","about","into","than","then","when","where","which","who","how","what","all","any","both","each","few","more","most","other","some","such","only","own","same","too","very","just","also","back","after","over","new","can","now"]);
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const freq = {};
  words.forEach(w => { if (!stopWords.has(w)) freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, topN).map(([word, count]) => ({ word, count }));
}

function getOrgStructure(html, text) {
  // extract departments, designations, names from common patterns
  const depts = [];
  const deptRe = /(?:department|dept|school|college|faculty|division|centre|center|unit|office|institute)\s+of\s+([A-Za-z\s&,]+?)(?:\n|<|,|\.|;)/gi;
  let m;
  while ((m = deptRe.exec(text)) !== null) {
    const name = m[1].trim();
    if (name.length < 80) depts.push(name);
  }

  const designations = [];
  const desgRe = /(?:director|principal|dean|head|professor|dr\.|mr\.|ms\.|chairman|vice\s*chancellor|registrar|coordinator|officer|manager|president|secretary)[^\n<.]{0,60}/gi;
  while ((m = desgRe.exec(text)) !== null) {
    const d = m[0].trim();
    if (d.length > 5 && d.length < 100) designations.push(d);
  }

  // address patterns
  const addressRe = /\d+[\s,]+[A-Za-z\s]+(?:road|street|nagar|lane|avenue|marg|colony|sector|block|floor)[^\n<]{0,100}/gi;
  const addresses = [];
  while ((m = addressRe.exec(text)) !== null) addresses.push(m[0].trim());

  // PIN codes
  const pins = [...new Set((text.match(/\b[1-9]\d{5}\b/g) || []))];

  // years mentioned
  const years = [...new Set((text.match(/\b(19|20)\d{2}\b/g) || []))].sort();

  return {
    departments: [...new Set(depts)].slice(0, 15),
    key_people: [...new Set(designations)].slice(0, 15),
    addresses: [...new Set(addresses)].slice(0, 5),
    pin_codes: pins.slice(0, 5),
    years_mentioned: years.slice(0, 10),
  };
}

function searchKeyword(html, keyword) {
  const text = clean(html);
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const results = [];
  let idx = 0;
  while ((idx = lower.indexOf(kw, idx)) !== -1) {
    const start = Math.max(0, idx - 80);
    const end   = Math.min(text.length, idx + keyword.length + 80);
    const snippet = text.slice(start, end).trim();
    results.push({ position: idx, snippet: (start > 0 ? "…" : "") + snippet + (end < text.length ? "…" : "") });
    idx += kw.length;
    if (results.length >= 20) break;
  }
  return { keyword, occurrences: results.length, found: results };
}

function getDetailedSummary(html, text, meta, headings, links, baseUrl) {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const internalLinks = links.filter(l => l.type === "internal");
  const externalLinks = links.filter(l => l.type === "external");
  const navLinks = links.filter(l => l.text.length < 40 && l.type === "internal").slice(0, 12);

  // tech stack detection
  const techStack = [];
  if (html.includes("wp-content")) techStack.push("WordPress");
  if (html.includes("drupal")) techStack.push("Drupal");
  if (html.includes("joomla")) techStack.push("Joomla");
  if (html.includes("react") || html.includes("__REACT")) techStack.push("React");
  if (html.includes("angular")) techStack.push("Angular");
  if (html.includes("vue")) techStack.push("Vue.js");
  if (html.includes("bootstrap")) techStack.push("Bootstrap");
  if (html.includes("jquery")) techStack.push("jQuery");
  if (html.includes("tailwind")) techStack.push("Tailwind CSS");
  if (html.includes("next")) techStack.push("Next.js");
  if (html.includes("google-analytics") || html.includes("gtag")) techStack.push("Google Analytics");
  if (html.includes("googleapis")) techStack.push("Google APIs");

  // page type
  let pageType = "General";
  const tl = (meta.title || "").toLowerCase();
  if (tl.includes("home")) pageType = "Homepage";
  else if (tl.includes("about")) pageType = "About Page";
  else if (tl.includes("contact")) pageType = "Contact Page";
  else if (tl.includes("blog") || tl.includes("news")) pageType = "Blog/News";
  else if (tl.includes("product") || tl.includes("shop")) pageType = "E-commerce";
  else if (tl.includes("university") || tl.includes("college") || tl.includes("institute")) pageType = "Educational Institution";
  else if (tl.includes("government") || tl.includes("ministry")) pageType = "Government";

  return {
    page_title:        meta.title,
    page_type:         pageType,
    meta_description:  meta.description,
    meta_keywords:     meta.keywords,
    author:            meta.author,
    canonical_url:     meta.canonical,
    domain:            baseUrl,
    word_count:        words.length,
    sentence_count:    sentences.length,
    paragraph_count:   html.match(/<p[^>]*>/gi)?.length || 0,
    image_count:       html.match(/<img[^>]+>/gi)?.length || 0,
    total_links:       links.length,
    internal_links:    internalLinks.length,
    external_links:    externalLinks.length,
    navigation:        navLinks.map(l => ({ text: l.text, url: l.url })),
    headings_count:    headings.length,
    h1_tags:           headings.filter(h => h.level === "H1").map(h => h.text),
    h2_tags:           headings.filter(h => h.level === "H2").map(h => h.text).slice(0, 8),
    tech_stack:        techStack,
    has_forms:         /<form/i.test(html),
    has_video:         /<video|youtube|vimeo/i.test(html),
    has_maps:          /maps\.google|leaflet|openstreetmap/i.test(html),
    charset:           meta.charset,
    is_mobile_friendly: !!meta.viewport,
    og_image:          meta.og_image,
    text_preview:      text.slice(0, 600),
  };
}

// ── CORS ─────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── SERVER ────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("AI Web Scraper v3 — running ✓");
  }
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== "POST" || req.url !== "/scrape") {
    res.writeHead(404, CORS);
    return res.end(JSON.stringify({ error: "Use POST /scrape" }));
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  let payload;
  try { payload = JSON.parse(body); }
  catch { res.writeHead(400, CORS); return res.end(JSON.stringify({ error: "Invalid JSON body" })); }

  const { targetUrl, mode = "summary", maxItems = 20, keyword = "", schema = [] } = payload;
  if (!targetUrl) { res.writeHead(400, CORS); return res.end(JSON.stringify({ error: "targetUrl is required" })); }

  try {
    const { body: html, baseUrl, status, hostname } = await fetchUrl(targetUrl);
    const text    = clean(html);
    const meta    = getMeta(html);
    const links   = getLinks(html, baseUrl);
    const headings = getHeadings(html);
    const emails  = getEmails(text);
    const phones  = getPhones(text);

    let records = [];

    switch (mode) {

      case "summary": {
        const summary = getDetailedSummary(html, text, meta, headings, links, baseUrl);
        const org     = getOrgStructure(html, text);
        const prices  = getPrices(text);
        const social  = getSocialLinks(links);
        const topWords = getWordFrequency(text, 15);
        records = [{
          ...summary,
          emails,
          phones,
          prices,
          social_links: social,
          top_keywords: topWords.map(w => w.word),
          org_structure: org,
        }];
        break;
      }

      case "keywords": {
        const freq    = getWordFrequency(text, parseInt(maxItems) || 30);
        const paras   = getParagraphs(html).slice(0, 5);
        const metaKw  = meta.keywords ? meta.keywords.split(/[,;]/).map(k => k.trim()) : [];
        records = [{
          meta_keywords: metaKw,
          top_words: freq,
          total_unique_words: [...new Set(text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [])].length,
          total_words: text.split(/\s+/).length,
          key_sentences: paras.slice(0, 3),
        }];
        break;
      }

      case "search": {
        if (!keyword) { records = [{ error: "No keyword provided" }]; break; }
        const result = searchKeyword(html, keyword);
        const headingMatches = headings.filter(h => h.text.toLowerCase().includes(keyword.toLowerCase()));
        const linkMatches = links.filter(l => l.text.toLowerCase().includes(keyword.toLowerCase()) || l.url.toLowerCase().includes(keyword.toLowerCase()));
        records = [{
          ...result,
          found_in_headings: headingMatches,
          found_in_links: linkMatches.slice(0, 10),
          percentage_of_text: ((result.occurrences / text.split(/\s+/).length) * 100).toFixed(3) + "%",
        }];
        break;
      }

      case "org": {
        const org   = getOrgStructure(html, text);
        const social = getSocialLinks(links);
        const tables = getTables(html);
        const lists  = getListItems(html).slice(0, 30);
        records = [{
          domain: baseUrl,
          title: meta.title,
          description: meta.description,
          ...org,
          emails,
          phones,
          social_media: social,
          staff_tables: tables.slice(0, 3),
          notable_items: lists.slice(0, 20),
        }];
        break;
      }

      case "links": {
        records = links.slice(0, maxItems);
        break;
      }

      case "media": {
        const images = getImages(html, baseUrl).slice(0, maxItems);
        const videos = [];
        const vidRe = /(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/)([a-zA-Z0-9_\-]+)/g;
        let vM;
        while ((vM = vidRe.exec(html)) !== null) videos.push({ platform: vM[0].includes("vimeo") ? "Vimeo" : "YouTube", id: vM[1], url: vM[0] });
        const scripts = getScripts(html);
        const styles  = getStyles(html);
        records = [{ images, videos: [...new Set(videos)], external_scripts: scripts.length, stylesheets: styles.length, script_list: scripts.slice(0, 10) }];
        break;
      }

      case "tables": {
        const tables = getTables(html);
        records = tables.slice(0, maxItems).map((rows, i) => ({
          table_index: i + 1,
          row_count: rows.length,
          col_count: rows[0]?.length || 0,
          headers: rows[0] || [],
          data: rows.slice(1),
        }));
        break;
      }

      case "structured": {
        // find repeating card/item blocks
        const blockRe = /<(?:article|div|li|tr)[^>]*class=["'][^"']*(?:item|card|product|post|result|row|entry)[^"']*["'][^>]*>([\s\S]*?)(?=<(?:article|div|li|tr)[^>]*class=|$)/gi;
        let bM;
        while ((bM = blockRe.exec(html)) !== null && records.length < maxItems) {
          const block = bM[1];
          const bText = clean(block);
          const record = {};
          schema.forEach(f => {
            if (f.type === "url") {
              const uM = block.match(/href=["']([^"']+)["']/);
              record[f.name] = uM ? uM[1] : null;
            } else if (f.type === "number") {
              const nM = bText.match(/[\d,]+(?:\.\d+)?/);
              record[f.name] = nM ? parseFloat(nM[0].replace(/,/g, "")) : null;
            } else {
              const hM = block.match(/<(?:h[1-6]|strong|b|span|p|td)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b|span|p|td)>/i);
              record[f.name] = hM ? clean(hM[1]).trim().slice(0, 200) : bText.slice(0, 200) || null;
            }
          });
          if (Object.values(record).some(v => v !== null)) records.push(record);
        }
        // fallback: list items
        if (!records.length) {
          records = getListItems(html).slice(0, maxItems).map(text => {
            const r = {};
            schema.forEach(f => { r[f.name] = text; });
            return r;
          });
        }
        break;
      }

      default:
        records = [{ error: `Unknown mode: ${mode}` }];
    }

    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      success: true,
      records,
      meta: {
        targetUrl, mode,
        recordCount: records.length,
        httpStatus: status,
        engine: "pure-node-v3",
      },
    }));

  } catch (e) {
    res.writeHead(500, CORS);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`AI Web Scraper v3 running on port ${PORT}`));
