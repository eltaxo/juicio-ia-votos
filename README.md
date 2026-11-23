# El juicio a la IA — solo la votación (parte pública)

Es lo único que se sube a internet: la página del móvil (`/votar`) y la API de votos.
La mesa de control y la pantalla siguen en tu portátil (carpeta `juicio-ia`).

## Subirlo (Render)
1. Sube esta carpeta a un repositorio de GitHub.
2. En Render: New → Blueprint (lee `render.yaml`) o New → Web Service con arranque `node server.js`.
3. Pon la variable `ADMIN_KEY` con una clave vuestra.

## Enlazarlo con la mesa
En la mesa local (`http://localhost:3000/control`) → ⚙ Ajustes:
- Dirección pública para votar: `https://<tu-servicio>.onrender.com`
- Clave de la mesa: la misma `ADMIN_KEY`

La luz «Votación» de la mesa se pone verde y el QR de la pantalla ya apunta a esa dirección.
