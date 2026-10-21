# Mobility World v7

4-minute 41-second Japanese / English editions, 1280×720, 24 fps.

## Changes
- Three receding rows are staggered horizontally and swap with 3.5-second offsets. The scene ends when the first loaded chassis departs, without waiting for the back rows.
- The FC skateboard arrives from the back of the parking lot carrying the cafe.
- The produce shop rises before the chassis moves underneath it.
- Once the chassis clears the cafe, the cafe lowers to the pavement.
- People begin gathering while the next shop connects and retracts its legs.
- The loaded chassis leaves diagonally, becoming smaller with distance.
- English titles, captions, diagram labels and callouts accompany a complete English video edition.
- Music, kite backgrounds, coupling / passenger transfer and night-time container-shop cleaning are preserved from the published v6 master.

## Source layout
Place the original v5 source archive contents at `source/Mobility_World_Source_v5/`, with `render_v7.py` in that folder. Place `build_v7.py`, `english.json`, and `package_media.py` in its parent `animation/` directory. Supply the previously published v6 video as `published_v6.mp4` in that directory. The v6 master is available from the existing public HLS playlist `/media/mobility-world-v6/film.m3u8`.

Run `python3 build_v7.py`, `python3 three_rows.py`, `python3 assemble_rows.py`, then `python3 package_media.py`. Run assembly only once on fresh 300-second outputs. The English edition preserves the approved v6 imagery and replaces its Japanese caption and diagram-label areas with fitted English text. The original 75–120 second swap-body sequence is replaced with 26 seconds. Music is trimmed at the same transition with a short fade; the later orchestral escalation remains intact. The old baked clock and progress bar are removed; player controls show the correct 4:41 duration.

Both language editions are independently encoded video files; no browser caption overlay is required, including in fullscreen. The website's language selector preserves playback time and paused/playing state.

The latest source is stored under `film-source/v7/` in the portfolio repository. Music attribution remains in the film and at `/media/mobility-world-credits.txt`.
