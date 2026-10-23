---
name: creatucurso-lesson-app
description: Crea y publica una app web interactiva (juego, simulación, laboratorio, desafío, editor de código, actividad práctica) que funciona como clase embebida en un curso de creatucurso y le reporta a la plataforma el resultado del alumno (puntaje, aprobado/desaprobado o ambos) con el Lesson SDK o con un reporte firmado desde un backend. Usala siempre que el usuario mencione creatucurso, "clase embebida", "app embebida", "Lesson SDK", "LessonSDK", "/api/lessons/results" o el "secreto del curso", o cuando pida una actividad o juego interactivo para su curso o academia que tenga que guardar la nota del alumno, aunque no nombre el SDK.
---

# App para una clase embebida de creatucurso

Esta skill te guía para crear, publicar y entregar una app web que el creador de un curso pega como **clase embebida** en creatucurso. La plataforma muestra la app dentro de un iframe en la página de la clase y lo único que necesita de ella es **el resultado de la evaluación** del alumno. Todo lo demás es libre: puede ser un juego, una simulación, un laboratorio interactivo, un desafío contra reloj, un editor de código con tests, una actividad de arrastrar y soltar.

## Cómo arrancar

Lo normal es que el usuario te pegue un prompt generado por su panel de creatucurso con todos los datos: el curso, la clase, cómo se evalúa, si el resultado tiene que ser verificado, las direcciones de su academia y dónde conviene publicar. **Usá esos datos tal cual y ponete a trabajar**: el objetivo es que con la skill y ese prompt la app quede hecha sin idas y vueltas.

- **Si el prompt pide que propongas la actividad**, pensá algo creativo y útil para el tema de la clase (que el alumno *haga* algo con lo que aprendió, no que solo lea), contalo en 2 o 3 líneas y construilo sin esperar confirmación, salvo que el usuario haya pedido aprobarla antes.
- **Preguntá solo lo que bloquea de verdad.** Si falta un dato que no podés deducir (por ejemplo la dirección de la academia y no hay ninguna en el prompt), dejalo en una única constante de configuración marcada `TODO` y seguí.
- **Evaluación**: el resultado puede ser un puntaje (`score` sobre `maxScore`), un aprobado/desaprobado (`passed`) o ambos. Si hay puntaje y no se manda `passed`, la plataforma aprueba cuando `score / maxScore * 100` alcanza el puntaje mínimo de la clase. Diseñá la actividad para que el resultado salga naturalmente de lo que el alumno hace.
- **Verificado o no**: si la clase exige resultado verificado (o la nota cuenta para el certificado), la app necesita un backend que calcule la nota (ver "Reporte verificado"). Si no, alcanza con el reporte desde el navegador y la app puede ser 100% estática, que es lo más simple de publicar.

## Requisitos de la URL de la app

La plataforma rechaza la URL de la clase si no cumple esto:

- Empieza con `https://`, usa el puerto por defecto y no lleva usuario/contraseña.
- Usa un nombre de dominio público: no una IP, no `localhost`.
- **No** puede estar bajo `creatucurso.com.ar` (ni sus subdominios): tiene que ser el dominio de un hosting (`mi-actividad.vercel.app`, `mi-actividad.netlify.app`, `mi-actividad.pages.dev`) o un subdominio propio (`actividades.midominio.com`).
- No pongas tokens ni datos del alumno en la URL: la plataforma entrega la sesión por `postMessage`.

## Integración en el navegador (Lesson SDK)

Cargá el SDK desde la academia y conectalo así (reemplazá la dirección por la de la academia que viene en el prompt):

```html
<script src="https://miacademia.creatucurso.com.ar/sdk/lesson-sdk.js"></script>
<script>
	LessonSDK.init({ parentOrigin: "https://miacademia.creatucurso.com.ar" });

	window.addEventListener("lesson:session", () => {
		// La plataforma ya entregó la sesión: desde acá se puede reportar.
	});

	// Cuando la actividad termina, una de estas formas:
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

- **`parentOrigin`**: si la academia tiene dominio propio, el alumno puede ver la clase desde cualquiera de sus dos direcciones. En ese caso llamá `LessonSDK.init()` sin opciones: el saludo inicial no lleva secretos y el SDK aprende el origen real de la respuesta de la plataforma. Si la academia tiene una sola dirección, fijala.
- **`complete()` lanza un error** si todavía no hay sesión o si no recibe `score` ni `passed`. La app también tiene que funcionar fuera de la plataforma (cuando el creador la prueba sola o alguien la abre por link directo), así que envolvé el reporte:

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

  Hace falta al menos `score` o `passed`. Redondeá y limitá el puntaje antes de mandarlo para no caer fuera de rango.
- **Frameworks (React, Vue, Svelte, Next...)**: cargá el script en el HTML base, llamá `init()` una sola vez al montar la app (cuidado con `StrictMode`, que monta dos veces en desarrollo: protegelo con una bandera) y escuchá `lesson:session` para habilitar el envío. Con TypeScript, declará el tipo mínimo:

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
- **Tamaño**: el iframe ocupa el ancho del contenido y alrededor del 70% del alto de la pantalla. Hacé el diseño adaptable (también en celulares) y evitá depender de un alto fijo grande.
- **Tema e idioma**: `getSession()` trae `locale` (por ejemplo `es`) y `theme`; usalos si la app los soporta.

## Cabeceras del hosting (obligatorio)

La página de la clase enmarca tu app, así que tu app tiene que permitirlo. Configurá en **todas** las respuestas HTML de la app una cabecera con las direcciones de la academia que vienen en el prompt:

```
Content-Security-Policy: frame-ancestors https://miacademia.creatucurso.com.ar https://cursos.midominio.com
```

Y **no** mandes `X-Frame-Options: DENY` ni `SAMEORIGIN`: muchos hostings o frameworks lo agregan por defecto, revisalo. Si la app ya tiene una CSP, agregá `frame-ancestors` a la existente en lugar de mandar dos cabeceras. Según el hosting:

- **Vercel** (`vercel.json` en la raíz):
  ```json
  { "headers": [{ "source": "/(.*)", "headers": [{ "key": "Content-Security-Policy", "value": "frame-ancestors https://miacademia.creatucurso.com.ar" }] }] }
  ```
- **Netlify / Cloudflare Pages** (archivo `_headers` dentro de la carpeta que se publica):
  ```
  /*
    Content-Security-Policy: frame-ancestors https://miacademia.creatucurso.com.ar
  ```
- **Next.js** (`next.config.js`): `async headers() { return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors https://miacademia.creatucurso.com.ar" }] }]; }`
- **Express**: `app.use((req, res, next) => { res.setHeader("Content-Security-Policy", "frame-ancestors https://miacademia.creatucurso.com.ar"); next(); });` y, si usás `helmet`, desactivá su `frameguard` y ajustá su CSP.
- **nginx**: `add_header Content-Security-Policy "frame-ancestors https://miacademia.creatucurso.com.ar" always;`

Incluí **a la vez** `vercel.json` y `_headers` cuando la app es estática: así funciona en cualquiera de esos hostings sin tocar nada.

## Publicar la app

Elegí el camino según lo que puedas hacer en tu entorno:

1. **Tenés un conector, plugin o CLI de hosting** (Vercel, Netlify, Cloudflare): publicala vos mismo con eso y devolvé la URL final `https://`. Es el camino preferido.
2. **Tenés terminal pero no estás logueado en ningún hosting**: dejá el proyecto listo y dale al usuario el comando exacto (`npx vercel deploy --prod`, `npx netlify-cli deploy --prod --dir=.`, `npx wrangler pages deploy .`) con lo que tiene que responder.
3. **Estás en un chat sin terminal**: entregá la app como una carpeta lista para subir (idealmente un `index.html` autocontenido, con CSS y JS adentro, más `_headers` y `vercel.json`), como archivo descargable o `.zip`. La forma más fácil de publicarla es arrastrar esa carpeta a **Netlify Drop** (`https://app.netlify.com/drop`), que devuelve una dirección `https://...netlify.app` al instante. Explicalo en 3 pasos.

Para el camino 3, preferí una app sin paso de compilación (sin npm ni bundler): HTML + JS moderno + librerías por CDN si hacen falta. Si el resultado tiene que ser verificado, no hay forma de evitar un backend: usá una función serverless del mismo hosting (Vercel Functions, Netlify Functions o Cloudflare Pages Functions) para mantenerlo en un solo deploy.

**Dominio propio**: si el prompt sugiere un subdominio de la academia (por ejemplo `actividades.midominio.com`), publicá primero en la dirección gratuita del hosting y después explicá cómo conectarlo: agregar el dominio en el hosting y crear en el DNS un registro `CNAME` de `actividades` hacia lo que indique el hosting. La app funciona igual con la dirección gratuita, así que esto es opcional.

## Reporte verificado (desde el backend)

El reporte del navegador lo puede falsificar un alumno con las herramientas de desarrollo; la plataforma lo muestra como "Reportado por el alumno". Para que valga como **"Resultado verificado"**, el backend de la app manda el resultado firmado con el **secreto del curso**.

La regla clave: **el backend tiene que calcular o validar la nota con datos que controla**. Si el backend solo reenvía lo que dice el navegador ("me saqué 10"), la firma no agrega nada. Patrones que sí sirven:

- **Juego o desafío**: el servidor recibe las jugadas o el estado final y recalcula el puntaje, o como mínimo valida límites razonables de puntaje y tiempo.
- **Simulación o laboratorio**: el servidor recibe los parámetros que eligió el alumno y calcula si llegó al objetivo.
- **Ejercicio de código**: el servidor corre los tests sobre el código enviado.
- **Respuestas con solución**: las soluciones viven solo en el servidor; el navegador manda lo que respondió el alumno y el backend lo corrige.

Flujo:

1. El creador genera el secreto en el panel del curso, sección **"App embebida: secreto y resultados"** (se muestra una sola vez; si se pierde, se rota). Va en una variable de entorno del backend, `COURSE_APP_SECRET`, configurada en el hosting. **Nunca** lo pongas en el código del navegador ni en el repositorio, y no se lo pidas al usuario en el chat: indicale dónde cargarlo.
2. El navegador manda al backend de la app lo que el alumno hizo **junto con** `LessonSDK.getSession().lessonToken`.
3. El backend calcula el resultado y hace:

```
POST https://miacademia.creatucurso.com.ar/api/lessons/results
Content-Type: application/json
X-Timestamp: <segundos Unix>
X-Signature: hex(HMAC-SHA256(secreto, timestamp + "." + cuerpoCrudo))

{"session": "<lessonToken>", "score": 8, "maxScore": 10}
```

El cuerpo acepta los mismos campos que `complete()` más `session`. Reglas: timestamp en **segundos** (no milisegundos), dentro de ±300 s del reloj de la plataforma y no anterior al último reporte guardado; cuerpo de hasta 16 KB; **se firman exactamente los bytes que se envían** (serializá el JSON una sola vez y mandá ese mismo string). La sesión vence a las ~2 horas de abierta la clase. Si la academia tiene dos direcciones, cualquiera sirve para el endpoint.

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

**Edge / Web Crypto (Cloudflare Pages Functions, Vercel Edge, Deno)**

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

Si tenés terminal, probá el handshake con este `harness.html`, que simula la página de la clase. Serví la app y el harness en orígenes distintos (por ejemplo la app en `http://localhost:5173` y el harness con `npx serve` en otro puerto). Mientras probás, llamá `LessonSDK.init()` sin `parentOrigin` (o con el origen del harness): si lo fijás en la academia, el SDK descarta con razón el `lesson:init` del harness.

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

Verificá: que aparece `lesson:hello`, que llega `lesson:ready` después del `lesson:init`, y que `lesson:complete` sale con los campos y rangos correctos. Abrí también la app sola y confirmá que funciona en "modo práctica" sin errores en consola.

El `lessonToken` de prueba no es una sesión real (la plataforma respondería 404), así que la firma se prueba de punta a punta con la clase real. Con `curl` y `openssl` se puede probar a mano:

```bash
BODY='{"session":"<lessonToken>","passed":true}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$COURSE_APP_SECRET" -hex | sed 's/^.* //')
curl -i -X POST "$ACADEMY_URL/api/lessons/results" -H 'content-type: application/json' -H "x-timestamp: $TS" -H "x-signature: $SIG" --data "$BODY"
```

## Qué entregarle al usuario al final

Terminá con un resumen corto y concreto:

1. **Qué actividad hiciste** y cómo se calcula el resultado.
2. **La URL pública** de la app (o los pasos exactos para publicarla, si no pudiste hacerlo vos).
3. **Qué cargar en la clase** (panel del curso → la clase → "URL de la app"): la URL, el "Puntaje mínimo (0-100)" si se usa puntaje, y si conviene marcar "Exigir resultado verificado".
4. **Las cabeceras** configuradas y en qué archivo están.
5. Si hay backend: dónde cargar `COURSE_APP_SECRET` (generado en "App embebida: secreto y resultados") y `ACADEMY_URL`, y cómo se calcula la nota del lado del servidor.
6. **Cómo probarla**: abrir la clase como alumno inscripto, terminar la actividad y ver el resultado en el panel del curso.
