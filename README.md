# GrokScraper — Render + GitHub Pages

## Project structure
```
grokscraper-render/
├── server.js       ← backend (deploy to Render)
├── package.json
├── index.html      ← frontend (deploy to GitHub Pages)
└── README.md
```

## Deploy backend to Render (free)
1. Push this repo to GitHub
2. Go to render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - Name: grokscraper
   - Runtime: Node
   - Build Command: (leave blank)
   - Start Command: node server.js
5. Add environment variable: XAI_API_KEY = xai-your-key
6. Click Deploy
7. Your URL: https://grokscraper.onrender.com

## Deploy frontend to GitHub Pages (free)
1. Repo → Settings → Pages → Branch: main → folder: / (root)
2. URL: https://username.github.io/grokscraper-render

## Notes
- Render free tier spins down after 15min inactivity → first request after sleep takes ~30s
- No cold-start on paid tier ($7/mo) if you need it always-on
- Zero npm dependencies — pure Node.js built-ins only
