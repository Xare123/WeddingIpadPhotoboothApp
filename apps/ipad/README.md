# Native iPad booth

This is an Expo / React Native iOS application. It is not a website or PWA. The provisional target is the iPad Air 5 (M1), in portrait and landscape. The restrained ivory/espresso UI with terracotta accents uses iOS Georgia headings, large controls and gentle native photo/countdown transitions that honor Reduce Motion. The native `CameraView` uses the front camera with `mirror={false}` for the stored capture, without changing image bytes afterward; physical text-card verification remains required. The app requests camera permission, never microphone permission.

## Development

From the repository root:

```sh
npm ci
npm run typecheck --workspace @wedding-booth/ipad
npm run bundle:ios --workspace @wedding-booth/ipad
npm run start --workspace @wedding-booth/ipad
```

The Metro command starts a development server, not an installed iPad app. A Mac with Xcode and an iOS simulator or connected iPad is needed for `npm run ios --workspace @wedding-booth/ipad`. Use an Expo development build or the SDK-compatible Expo Go for device iteration. A standalone or TestFlight distribution requires the owner's Apple signing/team configuration and an iOS build; none is provisioned here. The provisional bundle identifier in `app.json` must be assigned by the owner before distribution.

## Host connection

The app starts offline with no bundled credentials. Enable an iPad passcode first. **Host settings** requires successful OS biometric/passcode authentication before opening and again before saving or disconnecting; unavailable authentication fails closed. In **Host settings**, enter the API's HTTPS origin and the operator-issued booth access token. The configuration is stored in the device Keychain with `expo-secure-store`; tokens are never put in `EXPO_PUBLIC_*` variables, displayed after saving, or printed in logs. Leaving the token empty when saving the same origin preserves the existing token. A changed origin requires a token. Disconnect removes the configuration, leaving photos and queue records on the device.

HTTP is accepted only for loopback origins in development builds. An iOS simulator can use a local development API. `localhost` on a physical iPad means the iPad itself; a physical booth requires a reachable HTTPS API. This MVP does not enable arbitrary cleartext LAN endpoints.

The host configuration form is protected by iPad OS authentication and intended for supervised device setup. It does not provide an app-specific host PIN, kiosk lock, enrollment or token rotation UI. Configure and supervise the device with iPad Guided Access and the owner's operational controls before use at an event.

## Capture and queue behavior

1. **Take our photo** runs a 3-second countdown. The visible **Cancel countdown** action or leaving the foreground cancels an unfinished countdown. A canceled timer cannot take a photo or clear a newly restarted countdown.
2. The camera JPEG is copied from cache into the app's document directory using a temporary file and rename. The preview appears only after the original and active-session record are saved.
3. **Retake photo** clears the active preview and retains the old draft locally. Drafts are never queued or sent.
4. **Use this photo** renames the draft to a confirmed original and creates an idempotent upload job. The confirmed filename is a recovery journal: startup reconstructs a missing queue record if the app stopped between rename and database commit.
5. Sync authenticates `PUT /v1/sessions/:sessionId/photos/:photoId`, then `POST /v1/sessions/:sessionId/ready`. It marks the job complete only after a successful ready response with a same-origin `/g/:token` link and future numeric `expiresAt` timestamp. No QR appears for a queued upload, failed request, malformed response, expired link, local emulator origin or IP/private-network address. Local API readiness is explicitly labeled as a local emulator test, not a usable guest link.
6. The QR card shows the exact server-acknowledged expiry in the iPad’s local date, time and time zone; it never assumes a fixed link lifetime. Link access ends at that time while the original remains private with the host. A guest can scan the QR or select **Next guest**. The next guest's screen clears the persisted active capture and old QR. Previously confirmed jobs keep retrying; originals are never deleted on completion.

The current active guest is restored after restart. Pending jobs retry when the app enters the foreground and every 15 seconds while active, respecting queue backoff. **Retry sharing** resets pending backoff for an immediate attempt. There is no background upload entitlement or guarantee of work while iOS suspends the app. One confirmed photo per guest session is supported.

Originals and drafts live under the app's document directory, `photobooth/`. Queue/active records use SQLite WAL. Uninstalling the app, erasing the device or losing the device removes access to local originals; this is not a backup or retention/export system. This MVP does not write to the system Photos library and has no host export/gallery UI. The owner must plan original recovery and retention before production use. An optional, clearly labeled phone-sharing simulation requires a fictional international-format test number and explicit consent. The phone number is kept only in Keychain; SQLite holds an opaque recipient reference. The mock request waits for the upload to complete and retries failures. Only a backend `mocked` acknowledgement completes it; the UI says no text was sent. Recipient Keychain entries are removed only after the terminal queue state is saved. No real messaging provider is connected. A process termination between Keychain creation and queue persistence can leave an unreferenced Keychain entry; a retention sweep/enrollment reset is required before production use.

## Hosted native simulator checks

The opt-in Debug-only synthetic camera suite exercises real native document files, SQLite and restart recovery on an iPad simulator. See [native-tests/README.md](native-tests/README.md) for its exact scope, guard, prerequisites and owner Mac commands. It requires no Apple signing account and does not substitute for physical camera/device validation.

## Checks and device validation

TypeScript and an iOS Metro export can be checked on Linux. Native installation, the physical front camera, permissions, Keychain, SQLite/file durability under iOS termination, iPad layout, rotation, scanning from a second phone, and camera quality cannot be established by a Linux export.

Before an event, use a physical iPad Air 5 to check camera permission denial/regrant, countdown/cancel/restart/retake/use-photo, unmirrored capture using a readable text card, portrait/landscape rotation, Airplane Mode capture, foreground/restart recovery, API rejection/retry, genuine guest-page QR scanning, expiry and next-guest privacy. Also verify signing, supported iPadOS version, Guided Access, charging, available storage and the owner's network. These native checks remain unrun in this cloud environment.
