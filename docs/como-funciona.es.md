# Cómo funciona

[🇬🇧 English](how-it-works.md) · 🇪🇸 Español

Todo lo que sigue se descubrió leyendo archivos de show y observando el tráfico OSC de MagicQ (MagicQ PC 1.9.8). **No** es
documentación oficial de ChamSys, así que los detalles pueden variar en otras versiones. Las correcciones son bienvenidas.

## Arquitectura

El plugin es un plugin normal de Stream Deck (Node.js, lo ejecuta el propio software de Stream Deck, sin programas extra):

```
 MagicQ PC ──archivo del show (.shw / .sbk)──▶ nombres, colores, tipos de botón   (se lee del disco)
 MagicQ PC ◀── OSC (UDP, puerto Rx) ───────── pulsaciones de teclas                (/exec/…, /pb/…)
 MagicQ PC ─── OSC (UDP, puerto Tx) ────────▶ feedback: botones activos, niveles de playback
```

- `src/show.js` interpreta el archivo del show; `src/osc.js` es un codificador/decodificador OSC mínimo y el enlace UDP;
  `src/render.js` dibuja cada tecla como un SVG; `src/plugin.js` lo une con las acciones de Stream Deck.

## El archivo del show

`.shw` (guardado) y `.sbk` (autoguardado) son archivos de texto, un registro por línea, separados por comas, con las cadenas entre comillas.
Los botones del Execute Window son registros `N`:

```
N,<página hex>,<ítem hex>,<flags hex>,<tipo hex>,<id hex>,<?>,<grupo solo hex>,"<nombre>",…
```

| Campo | Significado |
|---|---|
| página, ítem | posición del botón (ambos en hexadecimal). El número de executor en OSC es `ítem + 1`. |
| `flags & 0xFF` | color elegido para el botón, `0` = el de por defecto de su tipo |
| `flags & 0x400` | Button (SOLO); el campo *grupo solo* guarda el número de grupo (MagicQ lo muestra como `1-SO`) |
| `flags & 0x200` | Flash |
| `flags & 0x100` | Fader |
| `flags & 0x800` | Encoder |
| tipo `0x1a` | funciones especiales (Div / Tap / Inc / Dec SP…), dibujadas en rojo |
| tipo `0x13`, nombre vacío | casilla vacía |
| tipo `0x05` / `0x06` | paletas (el color sale del nombre de la paleta) |

Índices de color medidos en el Execute Window: `0` azul (por defecto), `1` rojo, `2` verde, `3` azul, `4` cian, `5` magenta,
`6` naranja, `7` rosa, `8` marrón, `9` amarillo, `10` verde mar. Cada uno tiene un tono apagado (inactivo) y uno vivo (activo)
(mira `COLOUR_TABLE` en `src/show.js`).

`status.dat`, en la carpeta de shows, empieza con `T,"<ruta>"`: el show que MagicQ tiene cargado. Así funciona el ajuste de show
`auto`. El plugin carga el más reciente de `<nombre>.shw` / `<nombre>.sbk`.

## Lo descubierto sobre OSC

Documentado por ChamSys ([manual de OSC](https://secure.chamsys.co.uk/docs/magicq/1.9.9.x/manual/OSC.html)):
`/exec/<página>/<ítem>` (sin argumento = activar, `0` = soltar / bajar un encoder, `1` = activar / subir, un float 0–1 o un entero
0–100 fija un fader), `/pb/<n>/go|pause|release|flash`, `/rpc <comandos>`, `/feedback/exec|pb|pb+exec`.

Comportamiento observado:

- **Formato del feedback.** Tras `/feedback/pb+exec`, MagicQ envía `/exec/<página>/<ítem> <0|1>` por cada botón de cada página,
  `/pb/<n> <nivel>` y `/pb/<n>/flash <0|1>` para los playbacks 1–10. El número de ítem es el índice del show + 1.
- **Límite de ritmo.** MagicQ responde a una petición de feedback con un volcado completo **como máximo una vez cada 3,0 s**, por
  mucho que se le pida. Apagar y encender el feedback en cada petición hace que deje de responder del todo.
- **Sin eco para los cambios hechos por OSC.** Un cambio hecho con el ratón se anuncia al instante; uno hecho por OSC, no. Por eso el
  plugin actualiza la tecla de forma optimista y vuelve a pedir el estado tras cada pulsación y cada vez que se suelta.
- **La página de playbacks, ADD/SWAP y el estado del blackout no se publican**, así que el plugin no los muestra (`/rpc "<n>P"`
  puede *cambiar* la página de playbacks, pero no hay forma de leerla).
- **MagicQ cerrado.** No llega ningún mensaje. 8 segundos de silencio marcan el enlace como caído (un volcado llega normalmente cada 3 s).
- Las direcciones OSC integradas solo llegan a los playbacks 1–10 y a las páginas 1–10 del Execute Window (o una página por nombre).

MagicQ también tiene un pequeño servidor web (puerto 8080 en MagicQ PC) que publica la página actual del Execute Window, la página de
playbacks y los nombres de los playbacks. El plugin todavía no lo usa; podría ser una vía futura para leer la página de playbacks.

## Comportamiento al pulsar

| Tipo | Tecla pulsada | Tecla soltada |
|---|---|---|
| Button, SOLO | `/exec/p/n` (activar) | nada (se refresca el estado) |
| Flash | `/exec/p/n 1` | `/exec/p/n 0` |
| Fader | `/exec/p/n` con float `1.0` o `0.0` | nada |
| Encoder | `/exec/p/n 1` (o `0`), repetido cada 120 ms | se detiene |
| Playback Play / Pausa / Release | `/pb/n/go` / `pause` / `release` `1` | nada |
| Playback Flash | `/pb/n/flash 1` | `/pb/n/flash 0` |
| Página de playbacks | `/rpc "<página>P"` | nada |

## Pruebas

`npm test` cubre el intérprete del show, los colores, los grupos SOLO, el códec OSC, un viaje de ida y vuelta por UDP con cambio de puerto
en caliente y los dibujos SVG. Define `MAGICQ_TEST_SHOW` con la ruta de un show real para ejecutar además una comprobación de estructura con él.
