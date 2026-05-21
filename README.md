# Advanced Web Scraper v3

Free, zero-dependency web scraper — pure Node.js, no API keys, no limits.

## Live URLs
- **Frontend**: https://rish240103034-commits.github.io/aiwebscrapper
- **Backend**: https://aiwebscrapper.onrender.com

## Tech Stack
| Layer | Service | Cost |
|---|---|---|
| Frontend | GitHub Pages | Free |
| Backend | Render.com | Free |
| Parser | Pure Node.js (zero npm deps) | Free |
| API Keys | None required | Free |

## 7 Extraction Modules

| Module | What it extracts |
|---|---|
| Detailed Summary | Title, page type, word count, tech stack, SEO info, navigation, social links, prices |
| Keywords Found | Top words with frequency, meta keywords, key sentences |
| Word Search | Every occurrence of a keyword with highlighted context |
| Organisation Info | Departments, key people, emails, phones, addresses, PIN codes, years |
| Link Map | All links — internal & external, categorized |
| Media & Assets | Images (with preview), videos, scripts, stylesheets |
| Tables Extractor | All HTML tables with headers and rows |
| Structured Schema | Custom field extraction from repeating page blocks |

## Project Structure
```
aiwebscrapper/
├── index.html      ← Frontend (GitHub Pages)
├── server.js       ← Backend (Render.com) — v3, 7 modules
├── package.json    ← Node.js config
└── README.md
```

## Deployment

### Backend — Render.com (free)
1. Push repo to GitHub
2. Go to render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - Runtime: Node
   - Build Command: *(leave blank)*
   - Start Command: `node server.js`
   - Instance Type: Free
5. No environment variables needed
6. Deploy — URL: `https://yourapp.onrender.com`

### Frontend — GitHub Pages (free)
1. Repo → Settings → Pages
2. Branch: `main` → folder: `/ (root)` → Save
3. Live at: `https://username.github.io/aiwebscrapper`

### Update Backend URL in Frontend
In `index.html`, update this line:
```js
const BACKEND_URL = "https://aiwebscrapper.onrender.com/scrape";
```

## API Reference

### POST /scrape
```json
{
  "targetUrl": "https://example.com",
  "mode": "summary",
  "maxItems": 20,
  "keyword": "",
  "schema": []
}
```

**Modes:** `summary` · `keywords` · `search` · `org` · `links` · `media` · `tables` · `structured`

### GET /
Health check — returns `AI Web Scraper v3 — running ✓`

## Notes
- Render free tier sleeps after 15min inactivity — first request takes ~30s to wake up
- Works on any publicly accessible website
- Some sites block scraping via Cloudflare — nothing we can do about those
- Zero npm dependencies — uses only Node.js built-in `http` and `https` modules
