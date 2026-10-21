# Gmail sending setup (ADR-0028)

Platform owner steps. Everything is done in the Google Cloud console (works on a phone).

1. **Project.** console.cloud.google.com, create a project (or pick the one that already has "Sign in with Google").
2. **Enable the Gmail API.** APIs & Services > Library > Gmail API > Enable.
3. **OAuth consent screen.** APIs & Services > OAuth consent screen (Google Auth platform > Branding). User type: **External**. Fill the app name, support email, logo (optional), homepage, privacy policy URL, terms URL and the authorized domain (your platform domain).
4. **Scope.** Data access > Add or remove scopes: add `https://www.googleapis.com/auth/gmail.send` (the default `openid` and `email` are enough besides it). Do not add any other Gmail scope.
5. **Credentials.** APIs & Services > Credentials > the OAuth client (type Web application; create one if there is none). Under **Authorized redirect URIs** add `https://app.<domain>/api/gmail/callback` and keep the Google sign-in one (`https://app.<domain>/api/auth/callback/google`). Copy the client id and secret.
6. **Environment** (`.env.example`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SECRETS_ENCRYPTION_KEY`, `PLATFORM_ADMIN_EMAIL` (your account email), optional `GMAIL_DAILY_LIMIT` (default 400; Gmail allows 500 a day for personal accounts, 2000 for Google Workspace). Create your platform account first, with that email.
7. **Testing mode (temporary).** Publishing status "Testing": add each person who will connect a Gmail under Test users (up to 100). They see an "unverified app" warning (Advanced > continue). Refresh tokens expire after **7 days** in this mode, so connections drop weekly and must be reconnected.
8. **Production.** Set the publishing status to **In production** and submit for verification (`gmail.send` is a sensitive scope). Google asks for: a public homepage, a privacy policy URL on the authorized domain, the authorized domain verified in Search Console, a justification of the scope (the platform lets course creators send automated enrollment and completion emails to their own students from their own Gmail account, never reads mail), and a demo video showing the consent screen and the feature. Review can take days or weeks.
9. **Platform mailbox.** Log in to `https://app.<domain>` with the `PLATFORM_ADMIN_EMAIL` account, open `/admin/correo`, press "Conectar Gmail". Verification and password-reset emails go out from it. Until it is connected they are printed to the server log.
10. **Each academy** connects from its panel, Automatizaciones, "Conectar mi Gmail". Until then its automation emails wait (3 days) and the page shows a banner.

There is no bounce or complaint feedback with this setup.
