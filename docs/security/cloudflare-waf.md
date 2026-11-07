# Cloudflare edge for Lunex (WAF, rate limiting, origin lock)

Closes audit finding **IN-11** (no WAF/edge; origin exposed directly). Applies
to `lunex.lunes.io` (prod), `lunex-sandbox.lunes.io` (testnet / community
beta) and `sandbox.lunes.io` (testnet RPC + faucet).

Order matters: steps 1–4 are safe at any time; **steps 5–7 (origin lock) must
only be enabled after DNS is proxied**, otherwise you lock out every visitor.

---

## 1. Proxy the zone

1. Add `lunes.io` (or the delegated sub-zone) to Cloudflare; move DNS.
2. `A` records for `lunex`, `lunex-sandbox`, `sandbox` → VPS IP, **Proxied
   (orange cloud)**. WebSockets (`/ws`) are supported on proxied hosts.
3. SSL/TLS → **Full (strict)** (the origin keeps its Let's Encrypt certs).
   Edge Certificates: *Always Use HTTPS* on, *Minimum TLS* 1.2, *TLS 1.3* on,
   *HSTS* off at the edge (nginx already sends it — avoid double config).
4. Network: *WebSockets* on, *gRPC* off, *Onion Routing* off.

## 2. WAF managed rules

Security → WAF → Managed rules:

| Ruleset | Setting |
|---|---|
| Cloudflare Managed Ruleset | Enabled, default actions |
| Cloudflare OWASP Core Ruleset | Paranoia **PL1**, score threshold **Medium (40)**, action **Log** for 7 days → then **Block**. Move to PL2 after reviewing false positives. |
| Cloudflare Leaked Credentials Check | Enabled (admin login) |

Exceptions (skip OWASP only, never the managed ruleset):

- `http.request.uri.path eq "/api/v1/orders" and http.request.method eq "POST"` —
  signed JSON bodies with hex signatures trip SQLi/XSS heuristics at PL2.

## 3. Rate-limiting rules

Security → WAF → Rate limiting rules (counting by IP; with the Pro/Business
plan add `cf.unique_visitor_id` / JA4 as characteristics). Keep them **looser
than nginx** (`docker/nginx.prod.conf`) so nginx remains the precise limiter
and Cloudflare absorbs floods:

| # | Expression | Rate | Action | Duration |
|---|---|---|---|---|
| 1 | `starts_with(http.request.uri.path, "/api/v1/auth")` | 20 req / 1 min | Block | 10 min |
| 2 | `http.request.uri.path eq "/api/v1/orders" and http.request.method in {"POST" "DELETE"}` | 60 req / 10 s | Managed Challenge | 1 min |
| 3 | `starts_with(http.request.uri.path, "/admin")` | 30 req / 1 min | Block | 1 h |
| 4 | `starts_with(http.request.uri.path, "/faucet") and http.request.method eq "POST"` | 3 req / 10 min | Block | 1 h |
| 5 | `starts_with(http.request.uri.path, "/api/")` | 600 req / 1 min | Block | 10 min |

Custom rules (Security → WAF → Custom rules):

- Block `http.request.uri.path matches "\\.(php|asp|aspx|jsp|cgi|env|git|svn)$"`.
- Block `starts_with(http.request.uri.path, "/graphql")` on the public hosts
  (SubQuery is internal-only; nginx also denies it).
- Block `starts_with(http.request.uri.path, "/metrics") or starts_with(http.request.uri.path, "/grafana")`.

## 4. Bots

- **Bot Fight Mode** on (Free) or **Super Bot Fight Mode** (Pro+):
  *Definitely automated* → **Block** on `/api/v1/auth*`, `/faucet*`, `/admin*`;
  *Likely automated* → **Managed Challenge** on those paths; *Verified bots* →
  Allow. Leave `/api/v1/*` market-data GETs out of challenges (agents/SDK).
- **Turnstile** on the faucet form (site key in `TURNSTILE_SITE_KEY`, secret
  in `TURNSTILE_SECRET`); the CSP already allows `https://challenges.cloudflare.com`
  in `script-src` and `frame-src`.

## 5. Cloudflare Access for `/admin`

Zero Trust → Access → Applications → *Self-hosted*:

- Application domain: `lunex.lunes.io/admin*` and `lunex-sandbox.lunes.io/admin*`
  (better: move the console to `admin.lunex.lunes.io`, AD-04).
- Policy *Allow*: emails in the operators group of the IdP (Google Workspace /
  GitHub org) **and** require MFA (`Authentication method: mfa`); session 8 h.
- Keep the nginx allowlist as the second layer: once `cloudflare-realip.conf`
  is active, `$remote_addr` is the operator's real IP, so `ADMIN_ALLOW_CIDR`
  (testnet) stays the operators' VPN/office CIDR — never the Cloudflare
  ranges. Combine with Authenticated Origin Pulls (step 6) so nobody can skip
  Access by hitting the origin IP directly.

## 6. Authenticated Origin Pulls (mTLS Cloudflare → origin)

1. SSL/TLS → Origin Server → **Authenticated Origin Pulls**: on (zone-level).
2. Download the Cloudflare origin-pull CA
   (`authenticated_origin_pull_ca.pem`, from the Cloudflare docs page
   "Authenticated Origin Pulls → zone-level") to the VPS as
   `/opt/lunex/certs/cf-origin-pull-ca.pem` and mount it read-only into nginx
   (`- /opt/lunex/certs/cf-origin-pull-ca.pem:/etc/nginx/cf-origin-pull-ca.pem:ro`).
3. In each public `server { listen 443 … }` block add:

   ```nginx
   ssl_client_certificate /etc/nginx/cf-origin-pull-ca.pem;
   ssl_verify_client on;
   ```

   `nginx -t && nginx -s reload`. A direct `curl --resolve lunex.lunes.io:443:<VPS-IP> https://lunex.lunes.io/`
   must now fail with `400 No required SSL certificate was sent`.

## 7. Real client IP + origin allowlist in nginx

Generated snippets (never hand-edit):

- `docker/snippets/cloudflare-realip.conf` — `set_real_ip_from <every CF range>;`
  + `real_ip_header CF-Connecting-IP;`. `CF-Connecting-IP` is trusted **only**
  when the TCP peer is a Cloudflare range, so a direct client cannot spoof it.
- `docker/snippets/cloudflare-allow.conf` — `allow <every CF range>; deny all;`.

Both are mounted at `/etc/nginx/snippets/` by `docker-compose.prod.yml` and
`docker-compose.testnet.yml`. Enable (after steps 1 and 6):

1. In `docker/nginx.prod.conf` / `docker/nginx.testnet.conf`, uncomment
   `include /etc/nginx/snippets/cloudflare-realip.conf;` (http level). From
   then on `$remote_addr` is the real visitor, so every `limit_req` zone, the
   `/admin` allowlist and `X-Forwarded-For $remote_addr` (sent to spot-api,
   `TRUST_PROXY=1`) keep working per user instead of per Cloudflare edge.
2. In each public `server {}` add `include /etc/nginx/snippets/cloudflare-allow.conf;`
   (outside `location` blocks that have their own allow/deny — nginx uses the
   innermost allow/deny set, so `/metrics`/`/admin` keep their stricter lists).
3. Firewall (defence in depth, `scripts/provision-vps.sh` step UFW): replace
   `ufw allow 80/tcp` / `ufw allow 443/tcp` with one rule per range:

   ```bash
   for c in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
     ufw allow proto tcp from "$c" to any port 443 comment cloudflare
   done
   ufw delete allow 443/tcp
   ```

   (Docker-published ports bypass UFW's INPUT chain; with `userland-proxy:false`
   use the `DOCKER-USER` chain or bind nginx to the host network if you rely on
   the firewall layer. The nginx allowlist + Authenticated Origin Pulls are the
   layers that actually hold.)

### Refreshing the Cloudflare ranges

`docker/refresh-cloudflare-ips.sh` downloads `ips-v4`/`ips-v6`, validates every
line as a CIDR (fails closed — keeps the old files on any error) and rewrites
both snippets. Weekly cron on the VPS (as the repo owner):

```cron
15 4 * * 1  /opt/lunex/docker/refresh-cloudflare-ips.sh --reload >> /var/log/lunex/cf-ips.log 2>&1
```

`--reload` runs `nginx -t` before `nginx -s reload`, so a bad file never takes
the edge down. Commit the regenerated snippets when they change.

## 8. Verification checklist

```bash
curl -sI https://lunex.lunes.io | grep -i '^server:'            # cloudflare
curl -s -o /dev/null -w '%{http_code}\n' https://lunex.lunes.io/graphql   # 403
curl --resolve lunex.lunes.io:443:<VPS-IP> -sk https://lunex.lunes.io/  # 400 (AOP)
for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://lunex.lunes.io/api/v1/auth/session; done   # 429/403 after the limit
```

Then in spot-api logs confirm `req.ip` shows real visitor IPs (not
`172.x`/Cloudflare ranges).
