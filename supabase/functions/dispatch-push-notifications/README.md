# Dispatch Push Notifications: simple setup

This function sends push notifications that PartyUp has already authorized and queued in the database.

There are two unrelated credentials:

| Setting | Purpose | Required? |
| --- | --- | --- |
| `PUSH_DISPATCH_SECRET` | Proves that an incoming request came from your database webhook | Yes |
| `EXPO_ACCESS_TOKEN` | Proves PartyUp's identity to Expo Push Service | Only if Expo push security is enabled |

`PUSH_DISPATCH_SECRET` is just one randomly generated password. The function and webhook must have matching copies.

## Step 1: generate the webhook secret

From the `partyup-site` directory, run locally:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-push-dispatch-secret.ps1
```

Copy the printed value. Do not commit or paste it into source code.

## Step 2: save the Edge Function secret

Use either the Supabase dashboard's Edge Function secrets section or, when your network works:

```powershell
supabase secrets set PUSH_DISPATCH_SECRET="PASTE_THE_GENERATED_VALUE"
```

You do not need to manually set `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`; Supabase supplies those to deployed functions.

## Step 3: deploy the function

```powershell
supabase functions deploy dispatch-push-notifications
```

## Step 4: create one Database Webhook

Create an `INSERT` webhook for:

```text
public.push_notification_events
```

Destination:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/dispatch-push-notifications
```

Add this request header:

```text
x-partyup-push-secret: PASTE_THE_SAME_GENERATED_VALUE
```

That is the entire `PUSH_DISPATCH_SECRET` setup. If the two values do not match, the function rejects the webhook.

## Optional Expo access token

Skip this section unless you intentionally enabled Expo push access-token security.

If it is enabled, create an Expo access token and save it only as an Edge Function secret:

```powershell
supabase secrets set EXPO_ACCESS_TOKEN="PASTE_THE_EXPO_TOKEN"
```

This is not an FCM key or APNs key. Android FCM v1 and iOS APNs credentials remain managed through EAS credentials.

## Quick verification

After applying the push migration and installing a new mobile build:

1. Enable notifications on a physical device.
2. Confirm a row appears in `push_devices`.
3. Publish a Mission or a host announcement with **Notify attendees** enabled.
4. Confirm rows appear in `push_notification_events`, `push_notification_recipients`, and `push_notification_deliveries`.
5. Confirm the device receives one notification.

Never put either secret in the PartyUp mobile app, `app.json`, a migration, Git, or a public webhook URL.
