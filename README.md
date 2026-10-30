# portfolio-william

Portfolio profesional de William Steven González Trujillo. Web estática en HTML, CSS y JavaScript
(sin framework ni build), publicada en Vercel, con un vídeo de presentación de 20 segundos y un
asistente de voz que se apoya en una función serverless.

- Web: https://portfolio-william-psi.vercel.app
- Vídeo: `william-20s-final.mp4` (incluido en la portada)
- CV: `CV_Gonzalez_William.pdf`

## Estructura

| Ruta | Qué es |
|---|---|
| `index.html` | La página completa: HTML, CSS y JS en un solo fichero |
| `asistente-voz.js` / `asistente-voz.css` | Interfaz del asistente de voz |
| `pcm-capture.js` | Captura de audio del micrófono en el navegador |
| `api/token.js` | Función serverless que acuña un token efímero para el asistente |
| `william-20s-final.mp4` | Vídeo de presentación |
| `william-20s-poster.jpg` | Póster del vídeo |

## Cómo se ejecuta en local

Es estático: abrir `index.html` en el navegador sirve para revisar el diseño. Para probar el asistente
de voz hace falta servir la carpeta por HTTP y tener la variable `GEMINI_API_KEY` en el entorno de
Vercel (la clave nunca se sube al repositorio):

```bash
vercel dev      # levanta la web y la función /api/token en local
```

## Despliegue

El proyecto está conectado a Vercel: cada push a `main` publica en producción y cada rama genera su
propio enlace de preview en Vercel → proyecto → Deployments.
