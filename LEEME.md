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

## Puesta en marcha (una sola vez)

1. En Netlify: **almacensenegal → Site configuration → Environment variables → Add a variable**
   - Key: `EDIT_PASSWORD`
   - Value: la contraseña que usará el equipo para editar
   - Scopes: deja marcado **Functions** (o "All scopes")
2. **Deploys → Trigger deploy → Deploy site** (las variables solo se aplican en despliegues nuevos).

Para cambiar la contraseña más adelante: edita `EDIT_PASSWORD` y vuelve a desplegar. A todo el que tuviera la antigua se le pedirá la nueva.

## Cómo funciona

- Cualquiera con el enlace puede **consultar**. Para **editar** hay que pulsar «Entrar para editar» y poner la contraseña. La comprueba el servidor, no la página.
- La app consulta cambios cada 6 segundos y al volver a abrirla, así que lo que edita otra persona aparece enseguida.
- Cada cambio se guarda campo a campo y con control de versión, así que dos personas pueden editar a la vez sin pisarse.
- Los datos se ven en Netlify en **Data & Storage → Blobs → almacen** (una entrada por hoja: `sheet/qx`, `sheet/consulta`…).

## Formato de una hoja

```
sheet/qx = { title, sub, kind: "inv" | "list", pos, base, target, note,
             rows: { r001: { n: nombre, e: existencias ("348+194"), d: necesidades,
                             m: notas, g: título de sección, o: orden,
                             t: última modificación, x: borrado } } }
```

## En el iPhone

Safari → https://almacensenegal.netlify.app → **Compartir** → **Añadir a pantalla de inicio**.
