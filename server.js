// server.js — GrokScraper backend
// Deploy free on Render.com (render.com)

const http = require("http");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT || 3000;
const XAI_API_KEY = process.env.XAI_API_KEY || "";

// ── tiny fetch helper (no npm needed, uses built-in https) ──
function fetchUrl(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        // follow one redirect
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(new Error("Request timed out")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── strip HTML to readable text ──
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

// ── CORS headers ──
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── main server ──
const server = http.createServer(async (req, res) => {
  // health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("GrokScraper backend is running ✓");
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  // only accept POST /scrape
  if (req.method !== "POST" || req.url !== "/scrape") {
    res.writeHead(404, CORS);
    return res.end(JSON.stringify({ error: "Not found. Use POST /scrape" }));
  }

  // read body
  let body = "";
  for await (const chunk of req) body += chunk;

  let payload;
  try { payload = JSON.parse(body); }
  catch { res.writeHead(400, CORS); return res.end(JSON.stringify({ error: "Invalid JSON" })); }

  const { targetUrl, schema, mode, instructions, maxItems, apiKey } = payload;
  const GROK_KEY = apiKey || XAI_API_KEY;

  if (!GROK_KEY) {
    res.writeHead(401, CORS);
    return res.end(JSON.stringify({ error: "No xAI API key. Set XAI_API_KEY in Render env vars." }));
  }
  if (!targetUrl) {
    res.writeHead(400, CORS);
    return res.end(JSON.stringify({ error: "targetUrl is required" }));
  }

  // ── Step 1: fetch the page ──
  let pageText = "";
  let fetchError = null;
  try {
    const result = await fetchUrl(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GrokScraper/1.0)",
        "Accept": "text/html,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    pageText = htmlToText(result.body);
  } catch (e) {
    fetchError = e.message;
    pageText = `[Could not fetch URL: ${e.message}. Grok will use its own knowledge.]`;
  }

  // ── Step 2: build prompt ──
  const schemaStr = schema?.length
    ? "\nEXTRACT THESE FIELDS:\n" + schema.map((f) => `- ${f.name} (${f.type})`).join("\n")
    : "";

  const modeGuide = {
    structured: `Return ONLY a valid JSON array of up to ${maxItems || 10} objects with the specified fields. No explanation.`,
    freeform:   `Decide what data is most valuable. Return ONLY a valid JSON array of up to ${maxItems || 10} records.`,
    summary:    `Return ONLY a single JSON object: { summary, key_points, entities, statistics, topics, sentiment }`,
    links:      `Return ONLY a JSON array of link objects: { text, url, category, description }. Max ${maxItems || 20}.`,
  }[mode || "structured"];

  const system = `You are a precise web data extraction AI.
${modeGuide}
${schemaStr}
${instructions ? "SPECIAL INSTRUCTIONS: " + instructions : ""}
Rules: Return ONLY valid JSON. No markdown. No backticks. Use null for missing values. Never invent data.`;

  const userMsg = `URL: ${targetUrl}\n\nPAGE CONTENT:\n${pageText}\n\nExtract now. Return only JSON.`;

  // ── Step 3: call Grok ──
  try {
    const grokBody = JSON.stringify({
      model: "grok-3-mini",
      max_tokens: 4000,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
    });

    const grokRes = await fetchUrl("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROK_KEY}`,
        "Content-Length": Buffer.byteLength(grokBody),
      },
      body: grokBody,
    });

    const grokData = JSON.parse(grokRes.body);

    if (grokRes.status !== 200) {
      res.writeHead(grokRes.status, CORS);
      return res.end(JSON.stringify({ error: grokData.error?.message || `Grok error ${grokRes.status}` }));
    }

    const rawText = grokData.choices?.[0]?.message?.content || "";
    const usage   = grokData.usage || {};

    // parse JSON out of the response
    let parsed;
    const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try { parsed = JSON.parse(cleaned); }
    catch {
      const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      try { parsed = match ? JSON.parse(match[1]) : [{ raw: rawText }]; }
      catch { parsed = [{ raw: rawText }]; }
    }

    const records = Array.isArray(parsed) ? parsed : [parsed];

    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      success: true,
      records,
      meta: {
        targetUrl,
        mode: mode || "structured",
        recordCount: records.length,
        pageFetched: !fetchError,
        fetchError: fetchError || null,
        model: grokData.model,
        tokens: { input: usage.prompt_tokens, output: usage.completion_tokens },
      },
    }));

  } catch (e) {
    res.writeHead(500, CORS);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`GrokScraper backend running on port ${PORT}`));
