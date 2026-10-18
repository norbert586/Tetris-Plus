# Deploying: Cloudflare Pages behind Cloudflare Access (Phase 10)

The game is a static site built from `web/`. Cloudflare Pages builds it from the private repo on
every push to `main`. Cloudflare Access sits in front so only invited email addresses can open
it (`docs/RESEARCH_AND_PLAN.md` §7: GitHub Pages would be public). Both are free at this scale.

## 1. The Pages project (once)

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, then pick
`norbert586/Tetris-Plus` (allow the Cloudflare GitHub app on that one repository).

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Root directory | `web` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` (also in `web/.nvmrc`) |

The build needs nothing outside the repo. The web assets (about 45 MB, of which the music is
38 MB) are committed and copied as they are. The largest single file is 3.4 MB, well under Pages'
25 MiB limit. `web/public/_headers` sets caching and `noindex`, and `robots.txt` asks crawlers to
stay away.

The site's address is `https://<project>.pages.dev`. Each push to another branch gets a preview at
`https://<hash>.<project>.pages.dev`.

## 2. Access (once, before sharing the address)

**Zero Trust → Access → Applications → Add an application → Self-hosted**:

- **Application domain:** add two entries, `<project>.pages.dev` and `*.<project>.pages.dev`. The
  second one covers preview deployments, which would otherwise be public.
- **Policy:** action *Allow*, include *Emails* with the addresses to invite (or *Emails ending
  in* for a whole domain).
- **Login method:** *One-time PIN*. Access emails a code; nobody needs an account.

Alternatively, the Pages project's **Settings → General → Access policy** enables Access for
preview deployments in one click. The production domain still needs the application above.

## 3. Check it

- In a private window, the address must show Cloudflare's sign-in page, not the game.
- From a terminal, `curl -sI https://<project>.pages.dev/` must answer `302` with a `location`
  on `cloudflareaccess.com`. The same must hold for a preview address and for
  `/assets/pazlee.pack`: every path is covered, assets included.
- Signed in with an invited address, the game loads. After one visit it also works offline and
  can be installed as an app (its service worker, `web/public/sw.js`).

## Updating

Merging to `main` deploys. Players get the new version on their next visit: the page is fetched
fresh, and the service worker refreshes game data in the background.
