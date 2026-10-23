**You can't fully eliminate the DNS record — a CNAME must exist at the tenant's DNS provider for traffic to route to your zone.** But you can make it invisible to the tenant so they never have to manually edit DNS: the standard way to do this is **Domain Connect**, an open protocol that Cloudflare supports.

## How Domain Connect gives you the "authenticate only" experience

Domain Connect lets you (the SaaS provider) define a **template** describing the DNS records your service needs (like the CNAME to `customers.creatucurso.com.ar`). When a tenant's DNS provider supports Domain Connect — **Cloudflare, GoDaddy, Namecheap, Google Domains, and many others do** — the tenant simply:

1. Enters their domain on your site
2. Gets redirected to their DNS provider's login (OAuth-style authentication)
3. Approves the DNS changes
4. The CNAME is applied automatically — they never touch a DNS dashboard

This is the same flow services like Shopify, Squarespace, and email providers use for one-click domain setup.

## What you need to do as the SaaS provider

### 1. Create a Domain Connect template
Define a JSON template (per the [Domain Connect spec](https://github.com/Domain-Connect/spec)) that includes your CNAME record. Host it publicly (e.g., on GitHub in raw JSON format). The template specifies:
- Your service provider name and logo
- The DNS records to apply (your CNAME pointing to `customers.creatucurso.com.ar`)
- A `syncPubKeyDomain` for signature verification (you publish a public key as a TXT record on a domain you control)

Example template structure:
```json
{
  "providerId": "creatucurso",
  "serviceId": "saas",
  "version": 1,
  "syncPubKeyDomain": "creatucurso.com.ar",
  "records": [
    {
      "type": "CNAME",
      "host": "%host%",
      "pointsTo": "customers.creatucurso.com.ar",
      "ttl": 3600
    }
  ]
}
```

### 2. Validate with the linter
Use the [Domain Connect linter tool](https://github.com/Domain-Connect/dc-template-linter) with the `-cloudflare` flag to check your template against Cloudflare-specific rules.

### 3. Onboard your template with Cloudflare
Email `domain-connect@cloudflare.com` with:
- Your template GitHub URL(s)
- The domain(s) for your `syncPubKeyDomain` TXT records
- A logo (SVG preferred)
- The default proxy status for CNAME records (proxied or DNS-only)
- (Optional) Your Cloudflare account ID for testing

Once onboarded, Cloudflare will show a GUI flow to your tenants when they connect a domain that uses Cloudflare DNS. Other Domain Connect-compatible DNS providers (GoDaddy, etc.) will also pick up your template through their own discovery mechanisms.

### 4. Combine with Cloudflare for SaaS
Domain Connect handles the **DNS side** (creating the CNAME at the tenant's provider). Cloudflare for SaaS handles the **certificate + routing side** (issuing SSL and routing traffic to your origin). Together:

1. Tenant authenticates via Domain Connect → CNAME is auto-created at their DNS provider
2. Your backend creates the custom hostname via the Cloudflare API → SSL certificate is issued
3. With **automatic HTTP validation**, the certificate activates once the CNAME is in place — no extra steps from the tenant

## Important limitations

- **Only works with Domain Connect-compatible DNS providers.** If a tenant uses a small/regional DNS provider that doesn't support Domain Connect, they'll still need to add the CNAME manually. You should detect this and fall back to showing manual instructions.
- **Domain Connect handles the DNS record creation only.** You still need Cloudflare for SaaS for the custom hostname + SSL certificate on your side.
- The template onboarding with Cloudflare requires emailing `domain-connect@cloudflare.com` — it's not self-service in the dashboard.

## Alternative: direct DNS provider API integration

If you want to support providers that don't support Domain Connect, you'd need to integrate with each DNS provider's API individually (e.g., Cloudflare API, GoDaddy API, etc.) and implement OAuth flows for each. This is more work but gives you broader coverage. Many SaaS platforms use Domain Connect for the providers that support it, and fall back to manual instructions for the rest.

---

