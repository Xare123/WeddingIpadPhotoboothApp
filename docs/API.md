# Four-photo template gallery API

This versioned protocol extension requires the matching Worker bundle before new V2 galleries can publish. Building or publishing its source does not deploy a Worker, change secrets, send SMS, or create storage. The existing bearer authentication, rate limits, private R2 bucket, expiry, signing-key checks, session revocation, and mock-first SMS gates remain in force.

## Upload

Use the existing authenticated `PUT /v1/sessions/:sessionId/photos/:photoId` for every selected JPEG, camera-original JPEG, and composite JPEG. UUIDs and object keys are scoped to that session. Uploads remain immutable, idempotent, and limited to 10 MiB each. No public object or listing endpoint is introduced.

## Publish four photos with a template

`POST /v1/sessions/:sessionId/ready` requires this complete body for a new four-photo gallery:

```json
{
  "photoIds": ["selected-1-UUID", "selected-2-UUID", "selected-3-UUID", "selected-4-UUID"],
  "originalPhotoIds": ["original-1-UUID", "original-2-UUID", "original-3-UUID", "original-4-UUID"],
  "composite": {
    "photoId": "distinct-composite-UUID",
    "layout": "strip",
    "theme": "classic",
    "version": "wedding-template-v2",
    "gridAspect": "portrait"
  }
}
```

The strings above describe roles; actual requests must use UUIDs. `photoIds` is the user's chosen composition order. `originalPhotoIds` corresponds to that same order. Each array must contain unique IDs. Selected and original IDs may overlap; the server deduplicates those object checks. The composite ID must be distinct from both arrays.

Layouts are exactly `strip` or `grid`; themes are exactly `classic`, `botanical`, or `coastal`. A `wedding-template-v2` composite requires `gridAspect` exactly `portrait` or `square`, including for strips. A `wedding-template-v1` composite retains exactly its original four fields and must not contain `gridAspect`. Unknown top-level/composite keys, invalid IDs, duplicate array entries, mismatched counts, missing metadata, and unsupported enum values return 400. The server validates the declared recipe and JPEG storage contract; it does not render or inspect the composite's pixels or prove camera/edit lineage.

The native client chooses and persists the v2 aspect once from the four EXIF-oriented original sources: the ordinary median width/height ratio below 0.95 chooses portrait; otherwise square. V2 strips remain 1200×3600; grids are 2400×3000 portrait or 2400×2400 square. Storage, recovery and the API preserve that explicit choice rather than inferring it again. Existing v1 recipes retain their original geometry and palette, including the 2400×2100 grid; they are never reinterpreted as v2.

Before publishing, every referenced selected photo, original, and composite must be durably uploaded under this exact session. An object under another session does not count. Missing objects return 409 and leave the gallery unavailable. At most nine distinct objects are required for four-photo templates.

Success returns the winning stored descriptor as well as the private URL:

```json
{
  "status": "ready",
  "url": "https://photos.gizelleandrami.com/g/<opaque-token>",
  "expiresAt": 0,
  "photoIds": ["selected-1-UUID", "selected-2-UUID", "selected-3-UUID", "selected-4-UUID"],
  "originalPhotoIds": ["original-1-UUID", "original-2-UUID", "original-3-UUID", "original-4-UUID"],
  "composite": {
    "photoId": "distinct-composite-UUID",
    "layout": "strip",
    "theme": "classic",
    "version": "wedding-template-v2",
    "gridAspect": "portrait"
  }
}
```

`expiresAt` is the actual epoch-millisecond expiry, not zero. UUIDs are canonical lowercase in storage and the response. The client must compare the complete returned descriptor with its complete submitted recipe—including both ordered arrays, role assignments, composite ID, layout, theme, version, and v2 aspect—before showing a QR. A missing or different acknowledgement must not create a ready client state. Both the HTTP transport and session finalizer enforce this comparison.

The complete recipe is immutable. Identical normalized replays preserve URL and expiry. Valid changes to order, roles, composite ID, layout, theme, version, or v2 aspect return 409, including conditional-write races. Unsupported versions return 400. No replay extends expiry or revives a revoked session.

## Legacy compatibility

A five-photo request may still use `{ "photoIds": [five ordered UUIDs] }`; all five must be uploaded before first publication. Its response remains exactly `{ "status": "ready", "url": "...", "expiresAt": ... }`. Five-photo metadata, if supplied, must include both a matching-count `originalPhotoIds` and the complete valid `composite` object; neither field can be supplied alone.

Existing shorter legacy manifests remain readable, downloadable, revocable, and replayable with their identical descriptor. New plain-four or other partial manifests cannot be published. Older ready manifests cannot be expanded or given a different recipe retroactively.

## Guest page and downloads

`GET /g/:token` presents the composite keepsake first, then individual selected photos, then explicitly labeled camera-original downloads. The existing cream/editorial design, wedding identity, full-resolution labels, private-link notice, exact expiry, and retention wording remain. A legacy plain-five page retains its original layout.

`GET /g/:token/photos/:photoId?download=1` permits only IDs in that manifest's selected/original/composite union. It returns the exact uploaded JPEG bytes with private no-store headers and an attachment filename. Other sessions and unselected/retired images remain inaccessible even if their IDs are known. There is no all-guest listing. Expiry, permanent session revocation, and signing-key rotation close access to every role.

## SMS

The unchanged consent/authenticated `/v1/shares` contract accepts a complete four-photo template gallery or a five-photo legacy gallery, returning the same gallery URL. Partial legacy galleries cannot create SMS shares. Mock mode remains the default. Provider approval gates, per-session delivery fences, terminal uncertainty, and explicit rejection retry rules are unchanged; this extension makes no real provider requests.
