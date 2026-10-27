# Owner-operated private setup

The owner has approved one dedicated booth credential and private upload of the existing confirmed queued photos. **No credential has been created or installed by these instructions.** The coordinator verified that `photos.gizelleandrami.com` already points to the isolated `wedding-photobooth` Worker with active TLS. A different hostname or DNS change is unnecessary.

The connected automation explicitly denies requests to this origin. The Cloudflare management API cannot issue the application's one-use setup code. **Do not run the issuance request through an agent, Mac executor, preview, proxy or alternative hostname to bypass that denial.** No supported connector-access remedy has been verified. The procedure below is for the owner to run personally in their own terminal/session; it is not a connector workaround to be executed by automation.

The installed 0.3.5 app's Host Settings now opens according to the owner. The separate 0.3.6 update remains held for its native startup investigation. Pairing and native-update acceptance are independent. Keep every original, app container and signing identity intact.

## Prepare the private handoff

Use the reviewed source in this repository and Node 24. The script requires an interactive terminal. It uses only Node's standard library; no Cloudflare account API token, extra account, new permission grant or SMS service is required.

The utility is a standalone file. Copying the reviewed script to the owner's machine does not require rebuilding/updating the iPad app or overwriting a Mac checkout's private bundle-ID configuration and warm build outputs.

From the repository, the owner runs:

Use one agreed credential source. If the coordinator has already configured `DEVICE_TOKEN`, stop before `prepare` and arrange its secure private handoff; do not generate and overwrite a different credential. The last verified state had no `DEVICE_TOKEN` configured.

```sh
node scripts/owner-private-setup.mjs prepare "$HOME/.wedding-photobooth-setup"
```

This creates a new owner-private folder outside Git checkouts, with a 64-hex booth credential in `DEVICE_TOKEN`. The directory is mode 0700 and secret files are 0600. It refuses symlinks and existing files. It never prints the credential or accepts it as a command-line argument or environment variable. Keep the folder out of cloud/public sharing and terminal recordings.

Copy the credential to the owner's clipboard without printing it:

```sh
pbcopy < "$HOME/.wedding-photobooth-setup/DEVICE_TOKEN"
```

In the normal Cloudflare Dashboard, open **Workers & Pages → wedding-photobooth → Settings → Variables and Secrets**. Add `DEVICE_TOKEN` as a **secret**, pasting from the private clipboard. Preserve the existing `LINK_SIGNING_KEY` and `TEXTBELT_API_KEY`; never retrieve, replace or paste those into the iPad. Preserve the main wedding website Worker and root/www records.

The coordinator must first confirm the matching reviewed V2 Worker bundle, existing private `PHOTOS` R2 binding to `gizelleandrami-photoboothphotos`, all eight rate-limit bindings, and disabled invocation/trace logging. Keep bucket public access disabled. Required nonsecret production configuration is `MODE=production`, `PUBLIC_ORIGIN=https://photos.gizelleandrami.com`, and `SMS_MODE=mock`. Set `PAIRING_ENABLED=approved` only when ready for this setup; the default code lifetime is five minutes. A seven-day gallery lifetime uses `LINK_TTL_SECONDS=604800`; it does not delete stored originals.

Clear the clipboard after saving the secret:

```sh
pbcopy < /dev/null
```

## Issue and consume one private code

When the owner and iPad are ready, the owner runs:

```sh
node scripts/owner-private-setup.mjs issue "$HOME/.wedding-photobooth-setup"
```

The script makes one authenticated HTTPS request to the existing `POST /v1/pairing/codes` endpoint, with a fresh issuance ID. It does not follow redirects, change origins, retry, send texts or upload photos. It saves a validated temporary code privately as `PAIRING_CODE` and records nonsecret expiry metadata. It never prints the response, code, bearer header or raw errors. A lost reply or partial write remains an uncertain issuance: resolve/expire that attempt deliberately before creating a fresh one.

Copy only the temporary code:

```sh
pbcopy < "$HOME/.wedding-photobooth-setup/PAIRING_CODE"
```

On the iPad, open **Host → Private setup**, authenticate locally as required, keep the prefilled origin and paste the temporary code. **Do not paste `DEVICE_TOKEN` into the code field.** The app consumes the code once and stores the returned booth credential in device-only Keychain, with readback before acknowledging setup.

**Completing setup immediately starts synchronization of the existing confirmed queued photos.** This private R2 transfer is now owner-approved. Unselected retained takes must remain private to Host. A saved credential is not proof of completed upload: wait for the full session's server acknowledgement, then verify its guest page and downloads from another phone. No download QR is valid before that acknowledgement.

After successful pairing, clear the clipboard and remove only the temporary code/issuance files:

```sh
pbcopy < /dev/null
node scripts/owner-private-setup.mjs cleanup "$HOME/.wedding-photobooth-setup"
```

Cleanup retains `DEVICE_TOKEN`. Store that credential in the owner's password manager before deliberately removing its local plaintext file. Do not delete any iPad photo data, queue state or unrelated files. The coordinator can disable new pairing after success without changing the existing booth credential.

## Failure, revocation and SMS

- If the script reports an HTTP/configuration or TLS failure, preserve the private files and report only its nonsecret category/status. Never send a token, code, response body or screenshot of the private files in chat. No automatic retries occur.
- If a code expires or its claim/Keychain reply is uncertain, deliberately issue a fresh code; do not reconsume automatically. Keep all local originals.
- Rotating `DEVICE_TOKEN` revokes every paired copy and outstanding setup codes. It does not delete originals. Rotating `LINK_SIGNING_KEY` also invalidates guest links, so do not rotate it just to pair this iPad.
- Guest links are forwardable bearer access and expire separately from storage retention. Do not publish an event-wide photo listing or enable public R2 access.
- SMS stays mocked until the coordinator verifies provider/domain eligibility, a working guest page and consent. The owner's separate capped test approval does not make eligibility or delivery complete. This script has no SMS operation.

Only synthetic, offline filesystem/transport tests may run under automation for this utility. The real `prepare` and `issue` commands above are owner-operated; no agent execution is authorized by this document.
