---
name: creatucurso-lesson-app
description: Construye o adapta una app web (quiz, juego, simulación, editor de código, ejercicio interactivo) para que funcione como clase embebida en un curso de creatucurso y reporte el resultado del alumno (puntaje, aprobado/desaprobado o ambos) con el Lesson SDK o con un reporte firmado desde el backend. Usala siempre que el usuario mencione creatucurso, "clase embebida", "app embebida", "Lesson SDK", "LessonSDK", "/api/lessons/results", "secreto del curso", o pida hacer un juego, quiz o actividad interactiva que tenga que guardar la nota en su curso o academia, aunque no nombre el SDK.
---

# App para una clase embebida de creatucurso

Esta skill te guía para construir (o adaptar) una app web que el creador de un curso pega como **clase embebida** en creatucurso. La plataforma muestra la app dentro de un iframe en la página de la clase y lo único que necesita de ella es **el resultado de la evaluación** del alumno. Todo lo demás (qué es la app, cómo se ve, con qué tecnología está hecha) es libre: puede ser un quiz en React, un juego en canvas, una simulación o un editor de código.

## Qué hacer primero: entender la actividad

Antes de escribir código, aclará con el usuario (si no está claro en lo que pidió):

1. **Qué hace el alumno** y cuándo termina la actividad. El reporte se manda una vez, al terminar.
2. **Cómo se evalúa**: con un puntaje (`score` sobre `maxScore`), con aprobado/desaprobado (`passed`), o con ambos. Si hay puntaje y no se manda `passed`, la plataforma aprueba cuando `score / maxScore * 100` alcanza el puntaje mínimo que el creador configuró en la clase (60 por defecto).
3. **Si el resultado tiene que ser verificado.** Si la nota cuenta para el certificado o el creador va a activar "Exigir resultado verificado", la app necesita un backend que calcule la nota y la reporte firmada (ver "Reporte verificado"). Si es práctica o engagement, alcanza con el reporte desde el navegador.
4. **La dirección de la academia** (por ejemplo `https://miacademia.creatucurso.com.ar`) y, si tiene, su dominio propio (por ejemplo `https://cursos.miacademia.com`). Se usan para cargar el SDK, para `parentOrigin` y para la cabecera `frame-ancestors`.
5. **Dónde se va a publicar la app** (Vercel, Netlify, Cloudflare Pages, un servidor propio...). Tiene que quedar en una URL `https://` pública propia.

Si el usuario no sabe algún dato, avanzá con un valor de ejemplo claramente marcado (`TODO: dirección de tu academia`) en un solo lugar de configuración, para que lo cambie después.

## Requisitos de la URL de la app

La plataforma rechaza la URL de la clase si no cumple esto, así que planificá el hosting en consecuencia:

- Empieza con `https://`, usa el puerto por defecto y no lleva usuario/contraseña.
- Usa un nombre de dominio público: no una IP, no `localhost`.
- **No** puede estar bajo `creatucurso.com.ar` (ni subdominios): tiene que ser un dominio propio o el de un hosting (`mi-quiz.vercel.app`, `juego.midominio.com`).
- No pongas tokens ni datos del alumno en la URL: la plataforma entrega la sesión por `postMessage`.

## Integración en el navegador (Lesson SDK)

Cargá el SDK desde la academia y conectalo así:

```html
<script src="https://miacademia.creatucurso.com.ar/sdk/lesson-sdk.js"></script>
<script>
	LessonSDK.init({ parentOrigin: "https://miacademia.creatucurso.com.ar" });

	window.addEventListener("lesson:session", () => {
		// La plataforma ya entregó la sesión: desde acá se puede reportar.
	});

	// Cuando la actividad termina:
	// LessonSDK.complete({ score: 8, maxScore: 10 });
	// LessonSDK.complete({ passed: true });
	// LessonSDK.complete({ score: 72, maxScore: 100, passed: true, timeSpentSec: 240, metadata: { nivel: 3 } });
</script>
```

Cómo funciona por dentro, para que lo uses bien:

1. `LessonSDK.init({ parentOrigin })` manda `lesson:hello` a la página que contiene el iframe.
2. La plataforma verifica que el mensaje viene del iframe de la clase, abre una sesión para el alumno inscripto y responde `lesson:init` con `{ lessonToken, lessonId, locale, theme }`.
3. El SDK acepta esa respuesta solo de la ventana padre (y de `parentOrigin`, si lo pasaste), dispara el evento `lesson:session` en `window` y desde ahí `LessonSDK.getSession()` devuelve la sesión (antes devuelve `null`).
4. `LessonSDK.complete(resultado)` manda `lesson:complete`; la plataforma lo guarda y, si aprobó, marca la clase como completada (eso puede completar el curso y emitir el certificado).
5. `LessonSDK.progress(p)` (de 0 a 1) es informativo y opcional.

Detalles que importan:

- **`parentOrigin`**: si la academia tiene dominio propio, el alumno puede ver la clase desde cualquiera de los dos dominios. En ese caso no fijes `parentOrigin` (llamá `LessonSDK.init()` sin opciones): el saludo inicial no lleva secretos y el SDK aprende el origen real de la respuesta de la plataforma. Si solo hay un dominio, fijalo.
- **`complete()` lanza un error** si todavía no hay sesión o si no recibe `score` ni `passed`. La app también tiene que funcionar fuera de la plataforma (cuando el creador la prueba sola o la abre un alumno por link directo), así que envolvé el reporte:

  ```js
  function reportar(resultado) {
  	if (!window.LessonSDK || !LessonSDK.getSession()) {
  		console.info("Fuera de creatucurso: el resultado no se guarda.", resultado);
  		return false;
  	}
  	LessonSDK.complete(resultado);
  	return true;
  }
  ```

  Mostrale al alumno un mensaje claro según el caso ("¡Resultado guardado!" o "Modo práctica: abrí la actividad desde tu curso para que se guarde").
- **Reportá una vez por intento terminado.** Si la app permite reintentar, cada nuevo `complete()` reemplaza el resultado anterior del alumno en esa clase.
- **Contrato del resultado**, validado por la plataforma:

  | Campo | Tipo | Regla |
  | --- | --- | --- |
  | `score` | número | `0 <= score <= maxScore` |
  | `maxScore` | número | mayor que 0; por defecto 100; solo junto con `score` |
  | `passed` | booleano | si viene, decide la aprobación |
  | `timeSpentSec` | entero | 0 o más, opcional |
  | `metadata` | objeto JSON | opcional, hasta 4 KB |

  Hace falta al menos `score` o `passed`. Redondeá o limitá el puntaje antes de mandarlo para no caer fuera de rango.
- **Frameworks (React, Vue, Svelte, Next...)**: cargá el script en el HTML base o con un `<script>` que se inserte una sola vez, llamá `init()` una sola vez al montar la app (cuidado con `StrictMode`, que monta dos veces en desarrollo: protegelo con una bandera) y escuchá `lesson:session` para habilitar el envío. Si el proyecto usa TypeScript, declará el tipo mínimo:

  ```ts
  declare global {
  	interface Window {
  		LessonSDK?: {
  			init(options?: { parentOrigin?: string }): void;
  			complete(result: { score?: number; maxScore?: number; passed?: boolean; timeSpentSec?: number; metadata?: Record<string, unknown> }): void;
  			progress(p: number): void;
  			getSession(): { lessonToken: string; lessonId: string; locale: string; theme: string } | null;
  		};
  	}
  }
  ```

## Vivir dentro de un iframe

La app corre en un iframe con `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-fullscreen"` y `allow="fullscreen; gamepad"`. Consecuencias:

- **La app no puede navegar la página de la plataforma** (no hay `allow-top-navigation`). Los links externos tienen que abrir en pestaña nueva (`target="_blank"`).
- **Juegos**: pantalla completa, bloqueo del puntero y gamepad están permitidos. Pedí la pantalla completa desde un gesto del usuario (un click).
- **Cookies y almacenamiento son de terceros** dentro del iframe: muchos navegadores los bloquean o los aíslan. No dependas de una cookie de sesión propia ni de que `localStorage` persista entre visitas. Para hablar con tu backend, mandá lo que haga falta (por ejemplo el `lessonToken`) en el cuerpo del pedido.
- **Tamaño**: el iframe ocupa el ancho del contenido y alrededor del 70% del alto de la pantalla. Hacé el diseño adaptable y evitá depender de un alto fijo grande.
- **Tema e idioma**: `getSession()` trae `locale` (por ejemplo `es`) y `theme`; usalos si la app los soporta.

## Cabeceras del hosting (obligatorio)

La página de la clase enmarca tu app, así que tu app tiene que permitirlo. Configurá en **todas** las respuestas HTML de la app:

```
Content-Security-Policy: frame-ancestors https://*.creatucurso.com.ar https://cursos.miacademia.com
```

(Reemplazá el segundo origen por el dominio propio de la academia, o borralo si no tiene.) Y **no** mandes `X-Frame-Options: DENY` ni `SAMEORIGIN`: muchos hostings o frameworks lo agregan por defecto, revisalo. Ejemplos:

- **Vercel** (`vercel.json`):
  ```json
  { "headers": [{ "source": "/(.*)", "headers": [{ "key": "Content-Security-Policy", "value": "frame-ancestors https://*.creatucurso.com.ar" }] }] }
  ```
- **Netlify / Cloudflare Pages** (archivo `_headers` en la carpeta publicada):
  ```
  /*
    Content-Security-Policy: frame-ancestors https://*.creatucurso.com.ar
  ```
- **Next.js** (`next.config.js`): `async headers() { return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors https://*.creatucurso.com.ar" }] }]; }`
- **Express**: `app.use((req, res, next) => { res.setHeader("Content-Security-Policy", "frame-ancestors https://*.creatucurso.com.ar"); next(); });` y, si usás `helmet`, desactivá su `frameguard` y ajustá su CSP.
- **nginx**: `add_header Content-Security-Policy "frame-ancestors https://*.creatucurso.com.ar" always;`

Si la app ya tiene una CSP, agregá la directiva `frame-ancestors` a la existente en lugar de mandar dos cabeceras.

## Reporte verificado (desde el backend)

El reporte del navegador lo puede falsificar un alumno con las herramientas de desarrollo; la plataforma lo muestra como "Reportado por el alumno". Para que valga como **"Resultado verificado"**, el backend de la app manda el resultado firmado con el **secreto del curso**.

La regla clave: **el backend tiene que calcular o validar la nota con datos que controla**. Si el backend solo reenvía lo que dice el navegador ("me saqué 10"), la firma no agrega nada. Patrones que sí sirven:

- **Quiz**: las respuestas correctas viven solo en el servidor; el navegador manda las respuestas del alumno y el backend las corrige.
- **Juego**: el servidor valida el estado o la repetición de la partida (o al menos límites razonables de puntaje y tiempo) antes de reportar.
- **Ejercicio de código**: el servidor corre los tests sobre el código enviado.

Flujo:

1. El creador genera el secreto en el panel del curso, sección **"App embebida: secreto y resultados"** (se muestra una sola vez; si se pierde, se rota y se reemplaza). Guardalo en una variable de entorno del backend, por ejemplo `COURSE_APP_SECRET`. **Nunca** lo pongas en el código del navegador ni en el repositorio.
2. El navegador manda al backend de la app lo que el alumno hizo **junto con** `LessonSDK.getSession().lessonToken`.
3. El backend calcula el resultado y hace:

```
POST https://miacademia.creatucurso.com.ar/api/lessons/results
Content-Type: application/json
X-Timestamp: <segundos Unix>
X-Signature: hex(HMAC-SHA256(secreto, timestamp + "." + cuerpoCrudo))

{"session": "<lessonToken>", "score": 8, "maxScore": 10}
```

El cuerpo acepta los mismos campos que `complete()` más `session`. Reglas: el timestamp en **segundos** (no milisegundos), dentro de ±300 s del reloj de la plataforma y no anterior al último reporte guardado; el cuerpo hasta 16 KB; **se firman exactamente los bytes que se envían** (serializá el JSON una sola vez y mandá ese mismo string). La sesión vence a las ~2 horas de abierta la clase.

**Node.js (18+)**

```js
import { createHmac } from "node:crypto";

export async function reportarResultado(lessonToken, resultado) {
	const body = JSON.stringify({ session: lessonToken, ...resultado });
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac("sha256", process.env.COURSE_APP_SECRET)
		.update(`${timestamp}.${body}`)
		.digest("hex");
	const res = await fetch(`${process.env.ACADEMY_URL}/api/lessons/results`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-timestamp": timestamp, "x-signature": signature },
		body,
	});
	return { status: res.status, data: await res.json().catch(() => null) };
}
```

**Edge / Web Crypto (Cloudflare Workers, Vercel Edge, Deno)**

```js
async function firmar(secreto, mensaje) {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(mensaje));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// signature = await firmar(env.COURSE_APP_SECRET, `${timestamp}.${body}`)
```

**Python**

```python
import hashlib, hmac, json, os, time, urllib.request

def reportar_resultado(lesson_token: str, resultado: dict) -> int:
    body = json.dumps({"session": lesson_token, **resultado}, separators=(",", ":"))
    ts = str(int(time.time()))
    sig = hmac.new(os.environ["COURSE_APP_SECRET"].encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        f"{os.environ['ACADEMY_URL']}/api/lessons/results",
        data=body.encode(), method="POST",
        headers={"content-type": "application/json", "x-timestamp": ts, "x-signature": sig},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status
    except urllib.error.HTTPError as e:
        return e.code
```

Respuestas y qué hacer con cada una:

| Código | Significado | Acción |
| --- | --- | --- |
| 200 | Guardado. Devuelve `{ ok, passed, lessonCompleted, courseCompleted }` | Mostrarle al alumno el resultado |
| 400 | Cuerpo o resultado inválido (`message` explica) | Corregir el código; no reintentar igual |
| 401 | Firma inválida, timestamp fuera de ventana o curso sin secreto | Revisar secreto, reloj del servidor y que se firmen los mismos bytes |
| 403 | El alumno ya no tiene inscripción activa | No reintentar |
| 404 | Sesión desconocida o vencida | Pedirle al alumno que recargue la clase |
| 409 | Ya hay un reporte con timestamp más nuevo | Ignorar |
| 413 | Cuerpo de más de 16 KB | Achicar `metadata` |
| 5xx / red | Error temporal | Reintentar unas pocas veces con espera, **firmando de nuevo** con timestamp nuevo |

Aunque uses el reporte verificado, podés llamar también `LessonSDK.complete()` para que la página se actualice al instante: un resultado verificado nunca es reemplazado por uno del navegador.

## Probar sin la plataforma

Para probar el handshake en local, creá un archivo `harness.html` que simule la página de la clase. Serví la app y el harness en orígenes distintos (por ejemplo la app en `http://localhost:5173` y el harness con `npx serve` en otro puerto), copiá el SDK a la app desde `https://<academia>/sdk/lesson-sdk.js` si no hay conexión, y abrí el harness:

```html
<!doctype html>
<meta charset="utf-8" />
<title>Harness de clase embebida</title>
<label>URL de la app <input id="url" size="50" value="http://localhost:5173" /></label>
<label>Puntaje mínimo <input id="min" type="number" value="60" /></label>
<button id="load">Cargar</button>
<iframe id="app" style="display:block;width:100%;height:70vh;border:1px solid #ccc"
	sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-fullscreen"
	allow="fullscreen; gamepad" referrerpolicy="no-referrer"></iframe>
<pre id="log"></pre>
<script>
	const $ = (id) => document.getElementById(id);
	const log = (...a) => ($("log").textContent += a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\n");
	$("load").onclick = () => { $("app").src = $("url").value; $("log").textContent = ""; };
	addEventListener("message", (e) => {
		const origin = new URL($("url").value).origin;
		if (e.origin !== origin || e.source !== $("app").contentWindow) return;
		const d = e.data;
		if (!d || d.source !== "lesson-sdk" || d.v !== 1) return;
		log("←", d.type, d.payload);
		if (d.type === "lesson:hello") {
			const init = { source: "course-platform", v: 1, type: "lesson:init",
				payload: { lessonToken: "token-de-prueba", lessonId: "clase-de-prueba", locale: "es", theme: "light" } };
			e.source.postMessage(init, origin);
			log("→ lesson:init");
		}
		if (d.type === "lesson:complete") {
			const r = d.payload, min = Number($("min").value);
			const ok = typeof r.passed === "boolean" ? r.passed
				: (r.score / (r.maxScore ?? 100)) * 100 >= min;
			log(ok ? "✔ APROBADO" : "✘ DESAPROBADO", "(así lo evaluaría la plataforma)");
		}
	});
</script>
```

Mientras probás con el harness, llamá `LessonSDK.init()` sin `parentOrigin` (o con el origen del harness): si lo fijás en la academia, el SDK descarta con razón el `lesson:init` del harness. Verificá en el harness: que aparece `lesson:hello`, que llega `lesson:ready` después del `lesson:init`, y que `lesson:complete` sale con los campos y rangos correctos. Probá también abrir la app sola (sin harness) y confirmá que funciona en "modo práctica" sin errores en consola.

Para la firma, el `lessonToken` de prueba no es una sesión real (la plataforma respondería 404). Probala de punta a punta con una clase real: el creador configura la URL de la app en la clase, abre la clase como alumno inscripto y revisa el panel del curso, donde cada resultado aparece como "Resultado verificado" o "Reportado por el alumno". Con `curl` y `openssl` se puede probar la firma a mano:

```bash
BODY='{"session":"<lessonToken>","passed":true}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$COURSE_APP_SECRET" -hex | sed 's/^.* //')
curl -i -X POST "$ACADEMY_URL/api/lessons/results" -H 'content-type: application/json' -H "x-timestamp: $TS" -H "x-signature: $SIG" --data "$BODY"
```

## Qué entregarle al usuario al final

Terminá con un resumen corto que incluya:

1. **La URL pública** donde quedó (o va a quedar) la app, y la confirmación de que cumple los requisitos de URL.
2. **Qué cargar en el panel de la clase**: "URL de la app", "Puntaje mínimo (0-100)" (si se usa puntaje) y si conviene marcar "Exigir resultado verificado".
3. **Las cabeceras** configuradas (`frame-ancestors` con los dominios de la academia) y dónde están.
4. Si hay backend: la variable de entorno donde va el secreto (`COURSE_APP_SECRET`), la de la dirección de la academia (`ACADEMY_URL`) y cómo se calcula la nota del lado del servidor.
5. **Cómo lo probó** (harness, modo práctica) y qué falta probar en la plataforma real.
