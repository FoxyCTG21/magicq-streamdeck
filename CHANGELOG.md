# Changelog

## 1.0.1

- Fix: keys no longer dim while pressing buttons very fast. MagicQ stops reporting its state while it is flooded with
  presses (measured: 26 s of silence at ~12 presses per second); the plugin took that for a closed MagicQ.
  Silence is now forgiven while keys are being pressed and judged again 8 s after the last press.
- Fewer OSC state requests (rate limited to one every 400 ms), which also eases the load on MagicQ.
- The connection-lost log line now says how long MagicQ was silent and how many presses were sent.

## 1.0.0

First public release.

- Executor keys that draw their name, colour and active state from the MagicQ show file.
- Button types: Button, Button (SOLO) with groups, Flash, Fader, Encoder.
- Execute Window pages: Page +/-, Go to page, Page indicator.
- Playbacks 1-10: Play, Pause, Release, Flash; Playback Page +/-.
- Live OSC feedback, instant local update on press, MagicQ-closed detection.
- MagicQ Settings key (IP, OSC ports, show file); automatic show detection.
- English and Spanish.
