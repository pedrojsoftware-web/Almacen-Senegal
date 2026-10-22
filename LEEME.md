# Almacén Senegal ´26 — Azul en Acción

App web (PWA) para llevar el registro del almacén: existencias, necesidades, lo que falta y exportación a Excel.
Un solo `index.html` con JavaScript sin frameworks, datos en **Firebase Realtime Database** y publicada en **Netlify**.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app completa |
| `manifest.webmanifest`, `icons/` | Icono y modo app al añadirla a la pantalla de inicio |
| `sw.js` | Hace que la app abra rápido y aunque no haya cobertura (los datos necesitan conexión) |
| `datos-iniciales.json` | Los datos del Excel NECESIDADES_SENEGAL_26 (7 hojas, 876 artículos) |
| `database.rules.json` | Reglas de seguridad de la base de datos |
| `netlify.toml` | Ajustes de Netlify |

## 1. Firebase (una sola vez)

1. Entra en <https://console.firebase.google.com> → **Agregar proyecto** → por ejemplo `almacen-azul-en-accion` (Analytics no hace falta).
2. **Compilación → Realtime Database → Crear base de datos** → ubicación **Bélgica (europe-west1)** → modo bloqueado.
3. En la pestaña **Reglas** de la base de datos, borra lo que hay, pega el contenido de `database.rules.json` y pulsa **Publicar**:
   ```json
   { "rules": { "sheets": { ".read": true, ".write": "auth != null" } } }
   ```
   Así cualquiera con el enlace puede **consultar**, pero solo quien tenga la contraseña puede **cambiar** datos.
   Si prefieres que también haga falta contraseña para ver, cambia `".read": true` por `".read": "auth != null"`.
4. **Compilación → Authentication → Comenzar → Correo electrónico/contraseña → Habilitar**.
   Luego en **Usuarios → Agregar usuario**: correo `almacen@azulenaccion.org` y la contraseña que vaya a usar el equipo.
   (El correo no tiene que existir de verdad. Si usas otro, cámbialo también en `index.html`, en `EDITOR_EMAIL`.)
5. **Configuración del proyecto (⚙) → Tus apps → icono web `</>`** → registra la app (sin Hosting) y copia el bloque `firebaseConfig`.
6. Abre `index.html`, busca `FIREBASE_CONFIG` (al principio del `<script>` principal) y sustituye los valores de ejemplo por los tuyos.
   La `apiKey` de Firebase no es secreta: la seguridad la ponen las reglas del paso 3.

## 2. GitHub

1. En <https://github.com/new> crea un repositorio, por ejemplo `almacen-senegal` (puede ser privado).
2. En el repositorio vacío: **uploading an existing file** → arrastra **todo el contenido** de esta carpeta (incluida la carpeta `icons`) → **Commit changes**.

## 3. Netlify

1. <https://app.netlify.com> → **Add new site → Import an existing project → GitHub** → elige `almacen-senegal`.
2. No hay que tocar nada (no tiene build): **Deploy**.
3. En **Site configuration → Change site name** puedes ponerle un nombre, por ejemplo `almacen-azulenaccion` → `https://almacen-azulenaccion.netlify.app`.

Cada vez que cambies algo en GitHub, Netlify publica la nueva versión solo.

## 4. Cargar los datos del Excel

Abre la web, pulsa **Entrar para editar**, escribe la contraseña y pulsa **Cargar los datos del Excel**. Solo aparece cuando la base de datos está vacía.
(Otra forma: en Realtime Database, menú ⋮ → **Importar JSON** → `datos-iniciales.json`.)

## 5. En el iPhone

Safari → abre la web → botón **Compartir** → **Añadir a pantalla de inicio**. Sale con el logo de Azul en Acción.
La contraseña de editor se recuerda en cada móvil hasta que pulses **Salir del modo editor**.

## Cómo se guardan los datos

```
sheets/
  qx/             título, descripción, tipo (inv | list), base y objetivo de cirugías, apuntes
    rows/r001     n = nombre, e = existencias (admite cálculos "348+194"), d = necesidades,
                  m = notas, g = título de sección, o = orden, t = última modificación, x = borrado
```
Cada cambio guarda solo el campo modificado, así dos personas pueden editar a la vez sin pisarse.
