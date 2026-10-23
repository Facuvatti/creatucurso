# Lesson SDK (v1)

Lets a web app embedded as a lesson report the student's result to the platform.

Creators can give their coding agent the skill in `skills/creatucurso-lesson-app/SKILL.md` (packaged as `skills/creatucurso-lesson-app.skill`) to build such an app.

```html
<script src="https://<academy>/sdk/lesson-sdk.js"></script>
<script>
	LessonSDK.init({ parentOrigin: "https://miacademia.creatucurso.com.ar" });
	addEventListener("lesson:session", () => {
		// ... when the activity ends:
		LessonSDK.complete({ score: 8, maxScore: 10 });
	});
</script>
```

## Handshake

All messages are `{ source, v: 1, type, payload }` sent with `postMessage`.

1. The app calls `LessonSDK.init({ parentOrigin? })`, which posts `lesson:hello` (`source: "lesson-sdk"`) to the parent. With `parentOrigin` the hello goes only to that origin; without it, the hello alone uses `*` (it carries no secret).
2. The platform checks that the message comes from the iframe and from the embed URL's origin, starts a session for the signed-in, enrolled student and replies `lesson:init` (`source: "course-platform"`) with `{ lessonToken, lessonId, locale, theme }`, sent to the exact embed origin.
3. The SDK accepts `lesson:init` only from `window.parent` (and from `parentOrigin` if configured), keeps the origin, answers `lesson:ready` and fires a `lesson:session` event on `window`. Every later message goes to that origin.
4. `LessonSDK.getSession()` returns `{ lessonToken, lessonId, locale, theme }` or `null` until the handshake finishes.

Other calls: `LessonSDK.progress(p)` posts `lesson:progress` (informational), and `LessonSDK.complete(result)` posts `lesson:complete`.

## Result contract

| Field | Type | Notes |
| --- | --- | --- |
| `score` | number | `0 <= score <= maxScore` |
| `maxScore` | number | default 100 |
| `passed` | boolean | overrides the score rule |
| `timeSpentSec` | number | optional |
| `metadata` | object | optional JSON, up to 4 KB |

Send at least one of `score` or `passed`.

**Passing rule.** If `passed` is present it decides. Otherwise the lesson passes when `score / maxScore * 100 >= passing score` (set per lesson in the panel, 60 by default). A passed lesson is marked completed, which can complete the course and trigger certificates and automations.

## Two ways to report

**From the browser (`LessonSDK.complete`).** Works for apps without a backend. The platform stores it as "Reportado por el alumno": a student with dev tools can forge it. If the lesson has "Exigir resultado verificado", it is stored but does not complete the lesson.

**From the app's backend (signed).** Generate the course secret in the panel (section "App embebida: secreto y resultados"); it is shown once. The browser sends `LessonSDK.getSession().lessonToken` to your backend, and your backend posts:

```
POST https://<academy>/api/lessons/results
X-Timestamp: <unix seconds>
X-Signature: hex(HMAC-SHA256(secret, timestamp + "." + rawBody))
Content-Type: application/json

{"session": "<lessonToken>", "score": 8, "maxScore": 10}
```

The body also accepts `passed`, `timeSpentSec` and `metadata`. The timestamp must be within 300 seconds and not older than the last stored one, the body at most 16 KB. The result is stored as "Resultado verificado".

```js
import { createHmac } from "node:crypto";

async function reportResult(lessonToken, result) {
	const body = JSON.stringify({ session: lessonToken, ...result });
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac("sha256", process.env.COURSE_APP_SECRET)
		.update(`${timestamp}.${body}`)
		.digest("hex");
	const response = await fetch("https://miacademia.creatucurso.com.ar/api/lessons/results", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-timestamp": timestamp,
			"x-signature": signature,
		},
		body,
	});
	if (!response.ok) throw new Error(`Report failed: ${response.status}`);
}
```

Sign the exact bytes you send. Responses: 200 stored, 401 bad signature, 404 unknown or expired session, other 4xx for an invalid body or timestamp.

## Framing: CSP of your app

The platform page frames your app, so your app must allow it. Set on your app's responses:

```
Content-Security-Policy: frame-ancestors https://*.creatucurso.com.ar https://<your academy custom domain>
```

and do not send `X-Frame-Options: DENY` or `SAMEORIGIN`. The iframe is sandboxed with `allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-fullscreen` and sends no referrer.
