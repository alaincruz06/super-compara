# Dia sync

dia.es blocks requests from cloud servers, so Dia prices are collected from your own computer and uploaded to the repo. The daily site build picks them up, and each upload also starts a rebuild straight away.

## One-time setup

1. **Node 18 or newer**: `node -v` (install from https://nodejs.org if needed).
2. **Get the files**: clone the repo (`git clone https://github.com/alaincruz06/super-compara`) or download just the `dia-sync` folder.
3. **Create a GitHub token** at https://github.com/settings/personal-access-tokens/new:
   - Repository access → *Only select repositories* → `super-compara`
   - Permissions → **Contents: Read and write**, **Actions: Read and write**
   - Save the token in a file named `.token` inside `dia-sync/` (it's git-ignored), or set it as the `SUPERCOMPARA_TOKEN` environment variable.

## Option A: script (can run on a schedule)

```bash
cd dia-sync
node dia-sync.mjs
```

It searches Dia for about 250 everyday grocery terms (one request per second, about 10–15 minutes), saves `dia.json`, uploads it and starts a site rebuild.

If it stops with **"Access Denied"**, Dia is refusing the script from your connection too. Use Option B.

**Schedule it** so it runs on its own (your computer must be on at that time):

- **Windows**: Task Scheduler → Create Basic Task → Daily, 05:30 → Start a program: `node`, arguments `dia-sync.mjs`, start in `C:\path\to\super-compara\dia-sync`.
- **macOS / Linux**: run `crontab -e` and add
  `30 5 * * * cd /path/to/super-compara/dia-sync && /usr/local/bin/node dia-sync.mjs >> sync.log 2>&1`

## Option B: your browser (manual)

1. Open https://www.dia.es in your normal browser.
2. Press F12 → **Console**, paste the whole contents of `dia-browser.js` and press Enter. (Chrome may ask you to type `allow pasting` first.)
3. Keep the tab open until it says *Listo* (about 10–15 minutes). It downloads `dia.json`.
4. Upload it: `node dia-sync.mjs --upload ~/Downloads/dia.json`

## Notes

- Prices older than a week are flagged on the site.
- To cover more products, add search terms to `terms.json` (Option B: also add them in `dia-browser.js`).
