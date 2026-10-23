# Domain Connect setup (one-click custom domains)

Domain Connect lets a creator connect `cursos.maria.com` by only approving the
change at their DNS provider (ADR-0030). It needs three things from you: a key
pair, a few DNS records on the platform domain and the template accepted by the
DNS providers. Until a provider accepts the template, creators at that provider
keep seeing the manual CNAME instructions (nothing breaks).

The examples use `creatucurso.com.ar` as `PLATFORM_DOMAIN`. If yours is
different, change `providerId`, `syncPubKeyDomain`, `syncRedirectDomain`,
`pointsTo` and the file name of `infra/domain-connect/creatucurso.com.ar.customdomain.json`
before submitting it (the file name must be `<providerId>.<serviceId>.json`, lower case).

## 1. Generate the RSA key pair

On your machine (not in the repository):

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out dc-private.pem
openssl rsa -in dc-private.pem -pubout -outform DER | base64 -w0 > dc-public.b64
```

Keep `dc-private.pem` secret. Never commit it, paste it in chats or logs.

## 2. Publish the public key as TXT records

Pick a key name, for example `_dck1` (the "key id"). Providers read the TXT
records of `<key id>.<syncPubKeyDomain>`, here `_dck1.creatucurso.com.ar`.
A TXT string is limited to 255 characters, so split the key in parts of about
200 characters and create one TXT record per part on that same name:

```sh
fold -w 200 dc-public.b64 | awk '{ printf "p=%d,a=RS256,d=%s\n", NR, $0 }'
```

Each output line is the content of one TXT record (`p` = part number, `a` =
algorithm, `d` = data). In Cloudflare: **DNS > Records > Add record**, type
`TXT`, name `_dck1`, content = one line; repeat for every line. Check with
`dig +short TXT _dck1.creatucurso.com.ar`.

## 3. Configure the app

In the app `.env` (also needs `SECRETS_ENCRYPTION_KEY` and the Cloudflare
values of `docs/cloudflare.md`):

```sh
# One line: the output of `base64 -w0 dc-private.pem`
DOMAIN_CONNECT_PRIVATE_KEY=LS0tLS1CRUdJTi...
DOMAIN_CONNECT_KEY_ID=_dck1
```

A PEM with `\n` escapes also works. Restart the web app. Without both values the
panel only shows the manual instructions.

`syncRedirectDomain` in the template must be the host of `BETTER_AUTH_URL`
(the app host, `app.<PLATFORM_DOMAIN>`): the provider sends the creator back to
`https://app.<PLATFORM_DOMAIN>/api/domain-connect/return/...`.

## 4. Submit the template

1. Put the logo at the `logoUrl` of the template (an SVG served over https).
2. Check the template in the Online Editor
   (https://domainconnect.paulonet.eu/dc/free/templateedit): "Check template",
   then "Test apply template" with a domain and a host (for example
   `domain=example.com`, `host=cursos`, `groupId=subdomain`; the result must be
   `cursos.example.com CNAME dominios.creatucurso.com.ar`).
   Copy the Markdown link.
3. Run the official linter (Go 1.22+):

   ```sh
   go install github.com/Domain-Connect/dc-template-linter@latest
   dc-template-linter -merge-or-fail creatucurso.com.ar.customdomain.json
   dc-template-linter -tolerate warn creatucurso.com.ar.customdomain.json
   dc-template-linter -cloudflare creatucurso.com.ar.customdomain.json
   ```

4. Fork https://github.com/Domain-Connect/Templates, add the file at the root and
   open a pull request using its PR template (every checkbox, plus the editor
   link). Templates that pass `-merge-or-fail` are merged faster.
5. **Cloudflare** does not read the repository by itself: email
   `domain-connect@cloudflare.com` with the GitHub link of the template, the
   FQDN of the key (`_dck1.creatucurso.com.ar`), the logo (SVG) and the default
   proxy status for the CNAME: **DNS only** (the record points to our Cloudflare
   for SaaS zone; the certificate is issued there).
6. Other providers (GoDaddy, IONOS, Squarespace, ...) onboard templates from the
   repository on their own schedule; some ask for a contact. It can take weeks.

When a provider accepts it, nothing changes in the app: the next time a creator
with a domain at that provider opens **Panel > Dominio propio**, the button
"Conectar automáticamente con <provider>" appears.

## Rotating the key

Generate a new pair, publish it under a new name (`_dck2`), wait for DNS, then
change `DOMAIN_CONNECT_PRIVATE_KEY` and `DOMAIN_CONNECT_KEY_ID` and restart.
Remove the old TXT records a day later.

## Manual tests with a mock provider

`DOMAIN_CONNECT_DISCOVERY_OVERRIDE=http://127.0.0.1:<port>` skips the DNS
lookups (zone = the domain without its first label) and lets the app talk to a
local mock of a DNS provider over plain http. Only for manual tests: leave it
empty everywhere else.
