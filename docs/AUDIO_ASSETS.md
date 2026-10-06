# Domino placement sound assets

Five short cues are excerpted from the user-supplied recording `source-domino.wav`
by Macif, titled “Domino pieces 1” ([original Freesound listing](https://freesound.org/people/Macif/sounds/329099/)).
The listing identifies the recording as CC0. The unmodified 44.1 kHz, stereo,
32-bit float master is retained at `apps/web/audio-source/source-domino.wav`; it is
outside the public web directory and is not copied into production builds.

Run `python3 scripts/extract_domino_cues.py` from the repository root to
reproduce the five 44.1 kHz, stereo, 16-bit PCM cues under
`apps/web/public/audio/domino/`. The script removes low-level leading/trailing
silence, preserves a short natural decay, applies a 6 ms edge fade and normalizes
the peak to 0.58. WAV files are served with the game and are not offered as a
standalone download.

| File               | Source interval | Duration | SHA-256                                                            |
| ------------------ | --------------: | -------: | ------------------------------------------------------------------ |
| `placement-01.wav` |   1.048–1.200 s |  0.152 s | `c8e55d43dd2bd2509903af513d267afa5951309f426930cef01ad80ebac37f8f` |
| `placement-02.wav` |   2.494–2.660 s |  0.166 s | `5a1e8cb958da8a58ed8e644664fb73994bf616e560f9aba31a78cce44ccbb0c3` |
| `placement-03.wav` |   3.097–3.270 s |  0.173 s | `cb5951bf04a3b84dcef1ecaea8bb65b84d31c14c81544aabf85e821c0248f21`  |
| `placement-04.wav` |   4.348–4.560 s |  0.212 s | `4ee117a4b40caf6ebbce5fc60938b4a6b67dc42337e27429efa556a1c5ee9cd4` |
| `placement-05.wav` |   6.715–6.900 s |  0.185 s | `7f8b4c3f15cb4dba5ee2100491cfe6208340611364cae618e542700e0d4da3a`  |

The client rotates through the five cues, varies rate by at most 2% and level by
at most 10%, and only primes/plays after explicit sound opt-in and a user gesture.
Muting/disposal stops playback. Tests check the shipped HTTP assets' PCM format,
short duration and normalized peaks as well as the playback preference and cue
tracking behavior.
