# Advanced Web Scraper

A free, zero-dependency web scraper built with pure Node.js. No API keys, no paid services, no limits.

## Live Demo
- **Frontend**: https://YOUR_USERNAME.github.io/aiwebscrapper
- **Backend**: https://aiwebscrapper.onrender.com

## Tech Stack
| Layer | Service | Cost |
|---|---|---|
| Frontend | GitHub Pages | Free |
| Backend | Render.com | Free |
| AI/Parser | Pure Node.js | Free |

## Features
- Extract links, headings, emails, phone numbers, prices
- 4 extraction modes: Structured, Freeform, Summary, Link Map
- Export results as JSON or CSV
- No API keys needed
- Works on any public website

## Extraction Modes
| Mode | What it extracts |
|---|---|
| Structured | Repeating blocks like cards, products, articles |
| Freeform | Everything — meta, images, tables, lists, contacts |
| Summary | Title, description, headings, emails, phones, prices |
| Link Map | All links with internal/external categories |

## Project Structure
```
aiwebscrapper/
├── index.html      ← Frontend (GitHub Pages)
├── server.js       ← Backend (Render.com)
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
5. Deploy — your URL: `https://yourapp.onrender.com`

### Frontend — GitHub Pages (free)
1. Repo → Settings → Pages
2. Branch: main → folder: / (root) → Save
3. Live at: `https://username.github.io/aiwebscrapper`

## Notes
- Render free tier sleeps after 15min inactivity — first request after sleep takes ~30s
- Works on any publicly accessible website
- Some sites may block scraping via robots.txt or Cloudflare
