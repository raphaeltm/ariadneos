# Connect the AriadneOS custom domain

Status: in progress
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
- Implementation and deployment in progress.

## Validation
- Confirmed the zone is active and has no existing records that would be overwritten.

## Risks and rollback
- DNS/certificate activation can take time. The workers.dev URL remains available.
- Roll back the custom routes in Wrangler and redeploy to detach these hostnames.

## Next steps
- Configure and deploy routes, verify HTTPS and redirects, run deployed smoke tests, and open/update a PR.
