# Connect the AriadneOS custom domain

Status: in-review
Owner: Codex, requested by the repository owner
Source: User asked to connect the purchased domain to the running Cloudflare demo.
Branch: sam/take-look-readme-research-499k8v

## Intent
Serve the existing application at https://ariadneos.com with managed HTTPS and a canonical www redirect.

## Acceptance criteria
- Apex domain serves the app and API over valid HTTPS.
- www and plain HTTP redirect to the HTTPS apex while preserving paths and queries.
- Simulation persistence and session isolation work on the new origin.
- Domain configuration and operating instructions are versioned and pushed.

## Decisions and rationale
- Cloudflare account inspection found one active zone, ariadneos.com, with no DNS records or Worker custom domains. Use Workers Custom Domains so Cloudflare manages routing, DNS, and certificates.
- Keep the existing workers.dev URL available for diagnostics and existing links.
- Apply canonical redirects before static assets and API handlers to cover every path.

## Changes
- Declared apex and www Custom Domains in Wrangler; enabled Worker-first handling for canonical redirects and retained workers.dev.
- Added 308 HTTP/www redirects preserving path, query, and request method.
- Updated public URLs and operating instructions; added the typecheck script expected by the pending quality-gate PR.
- Corrected a discovered cleanup mismatch: expired-session rows now use the same 24-hour threshold as their events.
- Deployed commit 551d327 as Worker version 37a4281c-2672-4b4b-ad64-b687cc3b54c3 on the existing free plan.

## Validation
- Confirmed the zone is active and had no existing records to overwrite; both managed records and custom-domain bindings are now enabled.
- Cloudflare reports an active certificate covering ariadneos.com and *.ariadneos.com.
- `npm test` passed all four tests; `npm run build` passed type checking and production build; `git diff --check` passed.
- `curl -I https://ariadneos.com` returned 200 with normal TLS verification.
- HTTP apex, HTTPS www, and HTTP www returned 308 to the HTTPS apex, preserving `/api/health?domain=check` (or the tested root query).
- `node scripts/smoke.mjs https://ariadneos.com` passed all checks, including persistence, session isolation, graph evidence, validation, and limits.
- The first www lookup returned NXDOMAIN during propagation; a later normal DNS/TLS request verified the redirect successfully.
- Browser verification is recorded below.

## Risks and rollback
- DNS/certificate activation can take time. The workers.dev URL remains available.
- Roll back the custom routes in Wrangler and redeploy to detach these hostnames.

## Next steps
- Human review of the application/custom-domain PR; no manual DNS or certificate setup remains.
