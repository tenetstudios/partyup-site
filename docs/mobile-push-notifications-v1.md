# Mobile push notifications V1 setup

Push delivery is built around the existing Activity feed. Database triggers create one idempotent push event and its authoritative recipients; the Edge Function creates one delivery per enabled device and sends through Expo.

## Manual deployment

For the shortest webhook/secret walkthrough, use
`supabase/functions/dispatch-push-notifications/README.md`.

1. On a network that can reach npm, run `npx expo install expo-notifications` in `PartyUp`. The compatible SDK 55 dependency is already declared in `package.json`; this command installs it and updates `package-lock.json`.
2. Apply `supabase/migrations/20260824006000_mobile_push_notifications_v1.sql`.
3. Deploy `dispatch-push-notifications` and set `PUSH_DISPATCH_SECRET` to a long random value. `EXPO_ACCESS_TOKEN` is optional, but recommended when Expo push access-token security is enabled.
4. In Supabase Database Webhooks, create an `INSERT` webhook for `public.push_notification_events` targeting:
   `https://<project-ref>.supabase.co/functions/v1/dispatch-push-notifications`
   Add header `x-partyup-push-secret: <PUSH_DISPATCH_SECRET>`.
5. Configure Expo/EAS Android FCM v1 and iOS APNs credentials, then make a new native build. Push tokens cannot be tested in a simulator and the new native notification module is not delivered by an OTA update.

Useful build commands:

```text
eas credentials
eas build --profile preview --platform android
eas build --profile preview --platform ios
```

## Event behavior

- Mission publication targets accepted/entered room participants, or the eligible Wild faction for faction Missions.
- Host announcements only push when the host explicitly enables **Notify attendees**. The default is off.
- Ending the Wild targets enrolled players and personalizes winner copy from the authoritative result.
- Recap creation targets only the recap owner.
- The Connections preference is stored and exposed for forward compatibility; Connection pushes remain intentionally deferred in V1.
- Authenticated users also receive a durable Activity item. Guest devices receive push without exposing private token tables.
- Repeated triggers, webhook retries, and client fallback calls cannot create a second event/device delivery.
- Expo `DeviceNotRegistered` tickets or receipts disable the dead token.

## Manual verification

Use physical iOS and Android development/preview builds. Test foreground, background, and terminated states for all four event types. Verify each tap opens the room Mission, room announcement, Wild results, or recap; if content is no longer available, the room/Activity fallback remains reachable. Repeat a webhook and confirm only one delivery exists for the event/device. Disable a preference and confirm Activity still records the event while push is skipped.
