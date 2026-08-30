# PartyUp Universal Links setup

The website now exposes the unsigned Apple association document at
`https://partyup.io/.well-known/apple-app-site-association`. The route returns
`503` until the production server has a valid `APPLE_TEAM_ID` environment
variable. The Team ID is deliberately not guessed or committed.

Before relying on Universal Links:

1. Enable the Associated Domains capability for the Apple App ID whose bundle
   identifier is `io.partyup.app`.
2. Set the server-only production environment variable `APPLE_TEAM_ID` to the
   10-character Apple Developer Team ID, then deploy the website.
3. Verify the exact URL above returns `200`, has no redirect, uses
   `Content-Type: application/json`, and contains
   `<TEAM_ID>.io.partyup.app`.
4. Install a fresh production-signed iOS build and test room entry, room,
   Live Node, recap, and series links from outside the app.

The app declares only `applinks:partyup.io`. The `www` host is intentionally
not included because no supported PartyUp link currently uses it. Supported
paths are `/join/*`, `/room/*`, `/n/*`, `/recap/*`, and `/series/*`.
