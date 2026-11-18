# Almacén Senegal ´26 — Azul en Acción

App web (PWA) para llevar el registro del almacén: existencias, necesidades, lo que falta y exportación a Excel.
Todo vive en **Netlify**: la página, una función que hace de API y los datos en **Netlify Blobs**. No hace falta Firebase ni otra base de datos.

## Estructura

| Ruta | Qué es |
|---|---|
| `public/` | La web que se publica: `index.html`, iconos, `manifest.webmanifest`, `sw.js` |
| `netlify/functions/api.mts` | API: `GET /api/data`, `POST /api/login`, `POST /api/write` |
| `data/datos-iniciales.json` | Datos del Excel NECESIDADES_SENEGAL_26 (7 hojas, 876 artículos). Se cargan solos la primera vez |
| `netlify.toml`, `package.json` | Configuración de Netlify y dependencias |

## Usuarios

Al abrir la app se pide usuario y contraseña. Sin sesión no se ve ningún dato.

| Usuario | Puede | Contraseña inicial |
|---|---|---|
| **Administrador** | Consultar, editar y cambiar las contraseñas | La de la variable `EDIT_PASSWORD` de Netlify |
| **Invitado** | Solo consultar y descargar el Excel | `INVITADO` (o la variable `GUEST_PASSWORD`, si existe) |

Las contraseñas iniciales solo se usan la primera vez. Después se cambian desde la app: botón con el nombre del usuario (arriba a la derecha) → **Cambiar contraseña**. Se guardan cifradas en Blobs (`meta/auth`). Al cambiar una contraseña se cierran las sesiones abiertas con la anterior.

Las sesiones duran 180 días en cada dispositivo, o hasta pulsar **Cerrar sesión**.

## Cómo funciona

- La app consulta cambios cada 6 segundos y al volver a abrirla, así que lo que edita otra persona aparece enseguida.
- Cada cambio se guarda campo a campo y con control de versión, así que dos personas pueden editar a la vez sin pisarse.
- Los datos se ven en Netlify en **Data & Storage → Blobs → almacen**: `sheet/<hoja>` (una entrada por hoja), `meta/auth` (usuarios) y `backup/…` (copias de seguridad).

## Copias de seguridad

- `backup/2026-11-18-existencias-a-0`: todas las hojas tal y como estaban antes de poner las existencias a 0 (18-11-2026).

## Formato de una hoja

```
sheet/qx = { title, sub, kind: "inv" | "list", pos, base, target, note,
             rows: { r001: { n: nombre, e: existencias ("348+194"), d: necesidades,
                             m: notas, g: título de sección, o: orden,
                             t: última modificación, x: borrado } } }
```

## En el iPhone

Safari → https://almacensenegal.netlify.app → **Compartir** → **Añadir a pantalla de inicio**.
