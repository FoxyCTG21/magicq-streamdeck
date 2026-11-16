# How it works

🇬🇧 English · [🇪🇸 Español](como-funciona.es.md)

Everything below was found by reading show files and watching MagicQ's OSC traffic (MagicQ PC 1.9.8). It is **not**
official ChamSys documentation, so details may differ in other versions. Corrections are welcome.

## Architecture

The plugin is a normal Stream Deck plugin (Node.js, run by the Stream Deck software itself, no extra program):

```
 MagicQ PC ──show file (.shw / .sbk)──▶ names, colours, button types   (read from disk)
 MagicQ PC ◀── OSC (UDP, Rx port) ───── key presses                    (/exec/…, /pb/…)
 MagicQ PC ─── OSC (UDP, Tx port) ────▶ feedback: active buttons, playback levels
```

- `src/show.js` parses the show file; `src/osc.js` is a tiny OSC encoder/decoder and UDP link;
  `src/render.js` draws each key as an SVG; `src/plugin.js` ties them to the Stream Deck actions.

## The show file

`.shw` (saved) and `.sbk` (autosave) are text files, one record per line, comma separated, strings in quotes.
Execute Window buttons are `N` records:

```
N,<page hex>,<item hex>,<flags hex>,<type hex>,<id hex>,<?>,<solo group hex>,"<name>",…
```

| Field | Meaning |
|---|---|
| page, item | position of the button (both in hexadecimal). The OSC executor number is `item + 1`. |
| `flags & 0xFF` | colour chosen for the button, `0` = default for its type |
| `flags & 0x400` | Button (SOLO); the *solo group* field holds the group number (MagicQ shows it as `1-SO`) |
| `flags & 0x200` | Flash |
| `flags & 0x100` | Fader |
| `flags & 0x800` | Encoder |
| type `0x1a` | special functions (Div / Tap / Inc / Dec SP…), drawn red |
| type `0x13`, empty name | empty slot |
| type `0x05` / `0x06` | palettes (colour taken from the palette name) |

Colour indices measured from the Execute Window: `0` blue (default), `1` red, `2` green, `3` blue, `4` cyan, `5` magenta,
`6` orange, `7` pink, `8` brown, `9` yellow, `10` sea green. Each has a dim (inactive) and a bright (active) shade
(see `COLOUR_TABLE` in `src/show.js`).

`status.dat` in the show folder starts with `T,"<path>"`: the show MagicQ currently has loaded. That is how the `auto`
show setting works. The plugin loads whichever of `<name>.shw` / `<name>.sbk` was written last.

## OSC findings

Documented by ChamSys ([OSC manual](https://secure.chamsys.co.uk/docs/magicq/1.9.9.x/manual/OSC.html)):
`/exec/<page>/<item>` (no argument = activate, `0` = release / lower an encoder, `1` = activate / raise, a float 0–1 or int
0–100 sets a fader), `/pb/<n>/go|pause|release|flash`, `/rpc <commands>`, `/feedback/exec|pb|pb+exec`.

Observed behaviour:

- **Feedback format.** After `/feedback/pb+exec` MagicQ sends `/exec/<page>/<item> <0|1>` for every button of every page,
  `/pb/<n> <level>` and `/pb/<n>/flash <0|1>` for playbacks 1–10. The item number equals the show's index + 1.
- **Rate limit.** MagicQ answers a feedback request with a full dump **at most once every 3.0 s**, however often it is asked.
  Switching feedback off and on again on every request stops it from answering at all.
- **No echo for OSC-driven changes.** A change made with the mouse is announced immediately; a change made through OSC is
  not. The plugin therefore updates the key optimistically and asks for the state again after each press and release.
- **Playback page, ADD/SWAP and blackout state are not reported**, so the plugin does not show them (`/rpc "<n>P"`
  can *change* the playback page, but there is no way to read it back).
- **Closed MagicQ.** No messages arrive. 8 seconds of silence marks the link as down (a dump normally arrives every 3 s).
- The built-in OSC addresses only reach playbacks 1–10 and Execute Window pages 1–10 (or a page by name).

MagicQ also has a small web server (port 8080 on MagicQ PC) that exposes the current Execute Window page, the playback page
and playback names. The plugin does not use it yet; it could be a future way to read the playback page.

## Press behaviour

| Type | Key down | Key up |
|---|---|---|
| Button, SOLO | `/exec/p/n` (activate) | nothing (state refreshed) |
| Flash | `/exec/p/n 1` | `/exec/p/n 0` |
| Fader | `/exec/p/n` with float `1.0` or `0.0` | nothing |
| Encoder | `/exec/p/n 1` (or `0`), repeated every 120 ms | stops |
| Playback Play / Pause / Release | `/pb/n/go` / `pause` / `release` `1` | nothing |
| Playback Flash | `/pb/n/flash 1` | `/pb/n/flash 0` |
| Playback Page | `/rpc "<page>P"` | nothing |

## Tests

`npm test` covers the show parser, colours, SOLO groups, the OSC codec, a UDP round trip with a live port change, and the SVG
renderers. Set `MAGICQ_TEST_SHOW` to the path of a real show file to also run a structure check against it.
