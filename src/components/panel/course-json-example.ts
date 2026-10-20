/**
 * Example shown in the panel next to the import form. Same shape as
 * docs/formato_curso_por_mcp.md. The file paths are paths on the creator's own
 * computer: after the import, a client on that computer uploads them; the
 * server never reads them.
 */
export const COURSE_JSON_EXAMPLE = `{
  "name": "Introducción al Desarrollo Web",
  "slug": "introduccion-desarrollo-web",
  "shortDescription": "Aprendé a crear sitios web desde cero.",
  "longDescription": "Un curso con teoría, práctica y proyectos reales.",
  "coverImages": ["C:/Users/maria/curso-web/portada.webp"],
  "promoVideo": "C:/Users/maria/curso-web/promo.mp4",
  "requirements": ["Computadora con acceso a internet"],
  "learningGoals": ["Entender la estructura de una página HTML"],
  "targetStudents": ["Personas sin experiencia previa"],
  "modules": [
    {
      "title": "Fundamentos de HTML",
      "description": "Estructura básica y etiquetas esenciales.",
      "order": 1,
      "classes": [
        {
          "title": "¿Qué es HTML?",
          "description": "Introducción al lenguaje de marcado.",
          "order": 1,
          "videos": ["C:/Users/maria/curso-web/mod1/clase1.mp4"],
          "notes": ["C:/Users/maria/curso-web/mod1/clase1-apunte.pdf"]
        }
      ]
    }
  ]
}
`;
