# Lecciones con app web embebida: la app devuelve un resultado

## Context

`docs/planes_suscripcion.md:11` promete "lecciones con web app embebida (iframe + webhook/SDK para guardar puntaje)". Una clase puede ser cualquier app web del tenant (quiz, editor de código, simulación, un juego). A la plataforma solo le importa recibir **el resultado de la evaluación**: un puntaje, un aprobado/desaprobado, o ambos. La app no necesita nada más de la plataforma.

## Contrato del resultado (abierto)

Un resultado es un objeto con campos opcionales; alcanza con uno de `score` o `passed`:

- `score` (número) y `maxScore` (número, por defecto 100).
- `passed` (booleano).
- `timeSpentSec`, `metadata` (JSON libre, tope 4 KB) opcionales.

Regla de aprobación de la clase: si viene `passed`, ese valor decide; si solo viene `score`, aprueba cuando `score/maxScore*100 ≥ passing_score` de la lección (configurable en el panel, 60 por defecto). Una clase aprobada queda completada y pasa por `completeCourseIfDone` (certificados y automatizaciones se disparan solos).

## Cómo se reporta (dos vías, la app elige)

1. **Desde el navegador (`postMessage`):** el SDK de la plataforma, incluido en la app, llama `LessonSDK.complete({ score, maxScore, passed })`. Sirve para apps sin backend.
2. **Desde el backend de la app (firmado):** POST firmado con HMAC al endpoint de la plataforma. Es la vía verificada, pensada para resultados que valen para certificados.

La lección tiene un interruptor "Exigir resultado verificado": si está activo, solo la vía 2 completa la clase; si no, cualquiera de las dos.

## Diseño

### Datos (`database/schema.sql`, `add column if not exists`)
- `catalog.lesson`: `embed_url text`, `embed_passing_score integer not null default 60`, `embed_verified_only boolean not null default false`.
- `catalog.course_app_secret (course_id pk, secret_encrypted, created_at, rotated_at)`: secreto HMAC por curso, cifrado con `encryptSecret` (`src/shared/crypto/secret-box.ts`), mostrado en claro una sola vez al crear o rotar.
- `catalog.embed_session (token_hash pk, lesson_id, user_id, expires_at, created_at)`: token aleatorio de 32 bytes (`base64url`), se guarda su sha256, vigencia ~2 h.
- `catalog.lesson_result (lesson_id, user_id, score, max_score, passed, time_spent_sec, metadata jsonb, source check in ('client','server'), verified boolean, last_ts bigint, created_at, updated_at, pk(lesson_id,user_id))`. Un resultado verificado no lo reemplaza uno de cliente.

### Backend
- `src/areas/catalog/embed.ts` (nuevo):
  - `validateEmbedUrl(url)`: solo `https:`, sin credenciales en la URL, puerto estándar, sin IP literal ni `localhost`, y fuera de `PLATFORM_DOMAIN` y sus subdominios. Usa `normalize`/`classifyHost` de `src/areas/tenancy/classify-host.ts` y el estilo de `src/shared/safe-path.ts`. Flag solo-dev para probar con `http://localhost`.
  - `normalizeResult(input)`: valida a mano tipos y rangos (`0 ≤ score ≤ maxScore`), calcula `passed` según la regla de arriba.
  - `recordResult(...)`: en una transacción hace el upsert en `lesson_result`, inserta `lesson_progress` si aprobó y llama a `completeCourseIfDone` (`catalog.ts:596`).
- Server functions en `src/server/catalog.functions.ts` (validadores de `src/shared/validate.ts`, acceso con `accessFor` como `getLessonPage`):
  - `startEmbedSession({courseSlug, lessonSlug})`: valida inscripción activa y devuelve el token de sesión; límite por usuario por minuto con un count query (patrón de `chat.ts`).
  - `reportEmbedResult(...)`: vía 1.
  - Panel (guard `staffCourse`): guardar `embed_url`, `embed_passing_score`, `embed_verified_only`; generar/rotar el secreto.
- Ruta `src/routes/api/lessons/results.ts` (`POST /api/lessons/results`, molde `src/routes/api/webhooks/mercadopago.*.ts`, no depende del host): headers `X-Timestamp` y `X-Signature`, cuerpo `{session, score?, maxScore?, passed?, timeSpentSec?, metadata?}`. Resuelve sesión → lección → curso → secreto; verifica HMAC-SHA256 de `${ts}.${cuerpoCrudo}` con `timingSafeEqual` (patrón `payments/payment.ts:21-31`), ventana de 300 s, tope de 16 KB y `ts ≥ last_ts`; re-chequea inscripción activa (como `media/heartbeat`); guarda con `source='server', verified=true`. Se regenera el árbol de rutas con `pnpm generate-routes`.

### Frontend
- `lesson-page.tsx`: si la lección tiene `embed_url`, muestra `<EmbedFrame>` (nuevo, `src/components/lesson/embed-frame.tsx`) y oculta "Marcar como completada". Iframe con `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-fullscreen"` (apto para juegos), `allow="fullscreen; gamepad"`, `referrerPolicy="no-referrer"`, sin token en la URL.
- El listener acepta mensajes con `e.origin` igual al origen de `embed_url`, `e.source === iframe.contentWindow` y `data.source === 'lesson-sdk'`. `lesson:hello` → `startEmbedSession` → `lesson:init` con `{lessonToken, lessonId, locale, theme}` enviado al origen exacto. `lesson:complete` → `reportEmbedResult` → `router.invalidate()`. Muestra el último resultado del alumno (puntaje y/o aprobado).
- Panel (`panel-course-page.tsx`, `course-editor.tsx`): URL de la app, puntaje mínimo, interruptor de verificado, secreto del curso (visible una vez, rotable) y lista de resultados por alumno con badge "Resultado verificado" o "Reportado por el alumno".
- SDK `public/sdk/lesson-sdk.js` (v1): `LessonSDK.init()`, `LessonSDK.complete({score, maxScore, passed, timeSpentSec, metadata})`, `LessonSDK.getSession()` (devuelve el token para que el backend de la app lo incluya en el reporte firmado).

### Importación de cursos
- `course-import.ts`, `course-from-import.ts`, `course-export.ts`, `course-json-example.ts` y `docs/formato_curso_por_mcp.md`: la clase admite `embed: { url, passingScore, verifiedOnly }` y se exige "al menos un video o un embed" por clase.
- Catalog: `types.ts` (`Lesson`), `catalog.ts` (`LessonRow`, `outlineOf`, `createCourse`, `updateLesson`), `getLessonPage` y `LessonPageData` incluyen el embed.

### Cabeceras
- La app del tenant debe permitir en su `frame-ancestors` `https://*.creatucurso.com.ar` y el dominio propio de la academia. En la plataforma, `frame-ancestors 'self'` global vía Nitro `routeRules` en `vite.config.ts`.

### Docs
- `docs/adr/0034-embedded-web-app-lessons.md` (formato de ADR-0033) y `docs/lesson-sdk.md` con el handshake, ejemplo de firma en Node y CSP.

## Fases
1. Datos, `validateEmbedUrl`, `reportEmbedResult`, `EmbedFrame`, SDK, campos de panel e importación.
2. `embed_session`, secreto por curso, `POST /api/lessons/results`, badges y "Exigir verificado".
3. Paquete npm del SDK con tipos y ejemplo de backend; hardening de `frame-ancestors`.

## Verificación (manual)
1. Typecheck y build como en CI; aplicar `schema.sql` dos veces.
2. App de prueba en otro origen (un juego mínimo) con el SDK: `complete({passed:true})`, `complete({score:8,maxScore:10})` y `complete({score:3,maxScore:10})` → la clase completa, completa y no completa respectivamente; el panel muestra el resultado.
3. Con "Exigir verificado" activo, el `complete` del navegador queda registrado pero no completa la clase.
4. `curl` con firma `openssl dgst -sha256 -hmac`: firma válida → 200 y badge verificado; firma inválida → 401; `ts` fuera de ventana o anterior al guardado → rechazado; sesión vencida → 404.
5. `embed_url` con `http:`, IP, `localhost`, subdominio de la plataforma o credenciales → rechazada.
6. Alumno sin inscripción activa no puede abrir sesión ni reportar.
