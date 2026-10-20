# ADR-0025: Certificate frame spec and issuing

**Status:** Accepted (completes ADR-0008)
**Date:** 2026-10-20
**Deciders:** Facu

## Context

ADR-0008 left the exact frame rules open. Creators design the frame in Canva (it cannot be embedded in an iframe) and upload the exported file. Whatever they upload is untrusted.

## Decision

**Accepted files:** PDF, PNG, JPEG. SVG and anything else is rejected.

| Rule | Value |
|---|---|
| Real type | From magic bytes (`%PDF-`, PNG signature, JPEG `FF D8 FF`), never from the extension or the declared MIME type |
| Recommended format | A4 landscape, aspect ratio 1.414 (width / height) accepted within 2% |
| Minimum size (images) | 1754 x 1240 px |
| Maximum size (images) | 6000 px per side |
| Maximum weight | 8 MB |
| PDF | Only the first page is used; its page size must have the same aspect ratio |

The panel shows these rules next to a link "Crear el diseño en Canva" (https://www.canva.com/, suggested custom size 3508 x 2480 px) and the upload field.

**Validator (`src/areas/certificates/frame.ts`):**
- Dimensions are read with `ffprobe` before decoding, so a decompression bomb is rejected cheaply.
- Raster images are re-encoded with `ffmpeg` to a new PNG (metadata dropped, a single frame, RGBA). Nothing from the original file is kept.
- A PDF is flattened: `pdftoppm` (package `poppler-utils`, added to the runtime image; arm64 native in Debian) renders the first page to a PNG 3508 px wide. No scripts, forms or embedded files survive. Encrypted or broken PDFs are rejected.
- External tools run with `execFile` (no shell), with a timeout, on a private temp directory that is removed afterwards.
- The result is always a PNG. It is stored at `MEDIA_ROOT/certificates/<organizationId>/<certificateTemplateId>.png`, outside any public path. The creator sees it only through an authenticated route; students never get the file, only the generated PDFs.

**No new native dependency for images.** `ffmpeg` is already in the image (ADR-0019). The only new npm package is `pdf-lib` (pure JavaScript, no binaries, works on arm64) to build the certificate PDF.

**Issuing:**
- The worker handles `course.completed` and calls `issueCertificate(enrollmentId)`. One certificate per enrollment (unique constraint, `on conflict do nothing`), only when the course has a template and the enrollment is `active`.
- The credential id is 16 URL-safe random characters (`crypto.randomBytes(12)`), unguessable.
- The PDF is drawn with the frame at full page size and four texts (student name, course title, date, credential id) in Helvetica. Text is limited to WinAnsi characters (accents and ñ work; other characters are replaced by their base letter or dropped).
- The creator sets each field as percentages of the frame (x, y, font size as % of the frame height, alignment, color).
- A course without a template when it is completed gets no certificate. The creator can press "Emitir certificados pendientes" after uploading one.
- Name and course title are copied into the certificate (snapshot), so later renames do not change an issued credential.

**Revocation:** the creator can revoke a certificate (optional reason). A full refund or a lost dispute revokes it automatically with reason `refunded` in the same transaction. The public page then shows the revoked notice and the PDF is no longer served.

## Consequences

- Known limitation: when a dispute is won or an enrollment is reactivated, the certificate is not restored automatically. Restoring a revoked certificate is out of scope; the creator has no un-revoke button.
- Known limitation: PDF frames are rasterised, so text inside them is not selectable in the issued certificate.
- Changing the frame later affects only certificates issued afterwards.
