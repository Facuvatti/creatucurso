{
  "name": "Introducción al Desarrollo Web",
  "slug": "introduccion-desarrollo-web",
  "shortDescription": "Aprendé a crear sitios web desde cero con HTML, CSS y JavaScript.",
  "longDescription": "Este curso te llevará desde los conceptos más básicos del desarrollo web hasta la creación de tu primer sitio interactivo. Incluye teoría, práctica y proyectos reales.",
  "coverImages": [
    "C:/Users/maria/Desktop/curso-web/portada-01.webp",
    "C:/Users/maria/Desktop/curso-web/portada-02.webp"
  ],
  "promoVideo": "C:/Users/maria/Desktop/curso-web/promo.mp4",
  "instructors": [
    "550e8400-e29b-41d4-a716-446655440000",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
  ],
  "requirements": [
    "Computadora con acceso a internet",
    "Ganas de aprender y practicar",
    "Conocimientos básicos de informática"
  ],
  "learningGoals": [
    "Comprender la estructura de un documento HTML",
    "Aplicar estilos con CSS",
    "Programar interactividad básica con JavaScript",
    "Publicar un sitio web en línea"
  ],
  "targetStudents": [
    "Principiantes en programación",
    "Diseñadores que quieran aprender a programar",
    "Emprendedores que necesiten su propio sitio web"
  ],
  "modules": [
    {
      "title": "Fundamentos de HTML",
      "description": "Estructura básica de un documento y etiquetas esenciales.",
      "order": 1,
      "classes": [
        {
          "title": "¿Qué es HTML?",
          "description": "Introducción al lenguaje de marcado.",
          "order": 1,
          "videos": [
            "C:/Users/maria/Desktop/curso-web/mod1/clase1.mp4"
          ],
          "notes": [
            "C:/Users/maria/Desktop/curso-web/mod1/clase1-apunte.pdf"
          ]
        },
        {
          "title": "Etiquetas esenciales",
          "description": "Encabezados, párrafos, listas y enlaces.",
          "order": 2,
          "videos": [
            "C:/Users/maria/Desktop/curso-web/mod1/clase2.mp4"
          ],
          "notes": [
            "C:/Users/maria/Desktop/curso-web/mod1/clase2-apunte.pdf",
            "C:/Users/maria/Desktop/curso-web/mod1/clase2-ejemplo.zip"
          ]
        }
      ]
    },
    {
      "title": "Estilos con CSS",
      "description": "Selectores, propiedades y diseño responsivo.",
      "order": 2,
      "classes": [
        {
          "title": "Introducción a CSS",
          "description": "Sintaxis, selectores y primeros estilos.",
          "order": 1,
          "videos": [
            "C:/Users/maria/Desktop/curso-web/mod2/clase1.mp4"
          ],
          "notes": [
            "C:/Users/maria/Desktop/curso-web/mod2/clase1-apunte.pdf"
          ]
        },
        {
          "title": "Quiz de selectores",
          "description": "Actividad interactiva alojada en tu propia web.",
          "order": 2,
          "embed": {
            "url": "https://quiz.miacademia.example/selectores",
            "passingScore": 70,
            "verifiedOnly": false
          }
        }
      ]
    }
  ]
}

## Clases con app embebida (`embed`)

Una clase puede mostrar una app web propia en lugar de (o además de) un video:

- `embed.url` (obligatorio dentro de `embed`): URL `https://` de la app, sin credenciales ni puerto distinto del estándar, sin IP ni `localhost`, y fuera del dominio de la plataforma.
- `embed.passingScore` (opcional, 0 a 100, por defecto 60): porcentaje mínimo para aprobar cuando la app informa solo `score`.
- `embed.verifiedOnly` (opcional, por defecto `false`): si es `true`, solo cuenta el resultado firmado por el servidor de la app.

Cada clase necesita al menos un video o un `embed`. El secreto para firmar resultados se genera en el panel del curso (no se importa). Ver `docs/lesson-sdk.md`.
