#!/usr/bin/env python3
"""Extract five normalized placement cues from the supplied float WAV master."""

from __future__ import annotations

import array
import hashlib
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/web/audio-source/source-domino.wav"
OUTPUT = ROOT / "apps/web/public/audio/domino"
TARGET_PEAK = 0.58
TRIM_THRESHOLD = 0.0015
TAIL_SECONDS = 0.045
FADE_SECONDS = 0.006
CUES = (
    (1.00, 1.20),
    (2.45, 2.66),
    (3.05, 3.27),
    (4.30, 4.56),
    (6.65, 6.90),
)


def read_float_wave(path: Path) -> tuple[int, int, array.array[float]]:
    raw = path.read_bytes()
    if raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("Expected a RIFF/WAVE source recording")
    chunks: dict[bytes, bytes] = {}
    offset = 12
    while offset + 8 <= len(raw):
        name = raw[offset : offset + 4]
        size = struct.unpack_from("<I", raw, offset + 4)[0]
        chunks[name] = raw[offset + 8 : offset + 8 + size]
        offset += 8 + size + (size & 1)
    fmt = chunks[b"fmt "]
    tag, channels, sample_rate, _, block_align, bits = struct.unpack_from(
        "<HHIIHH", fmt
    )
    if tag != 3 or bits != 32 or block_align != channels * 4:
        raise ValueError("Expected interleaved 32-bit IEEE float audio")
    samples = array.array("f")
    samples.frombytes(chunks[b"data"])
    if struct.pack("=H", 1) != struct.pack("<H", 1):
        samples.byteswap()
    return channels, sample_rate, samples


def write_pcm16_wave(path: Path, channels: int, rate: int, values: list[float]) -> None:
    pcm = array.array("h", (int(max(-1.0, min(1.0, x)) * 32767) for x in values))
    if struct.pack("=H", 1) != struct.pack("<H", 1):
        pcm.byteswap()
    data = pcm.tobytes()
    align = channels * 2
    fmt = struct.pack("<HHIIHH", 1, channels, rate, rate * align, align, 16)
    body = b"WAVEfmt " + struct.pack("<I", len(fmt)) + fmt
    body += b"data" + struct.pack("<I", len(data)) + data
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    channels, rate, samples = read_float_wave(SOURCE)
    frame_count = len(samples) // channels
    OUTPUT.mkdir(parents=True, exist_ok=True)
    fade = round(FADE_SECONDS * rate)
    tail = round(TAIL_SECONDS * rate)
    for index, (window_start, window_end) in enumerate(CUES, start=1):
        first = max(0, round(window_start * rate))
        last = min(frame_count, round(window_end * rate))
        active = [
            frame
            for frame in range(first, last)
            if max(abs(samples[frame * channels + ch]) for ch in range(channels))
            >= TRIM_THRESHOLD
        ]
        if not active:
            raise ValueError(f"No audio found in cue window {window_start}-{window_end}s")
        start = max(first, active[0] - round(0.012 * rate))
        end = min(last, active[-1] + tail)
        cue = [float(x) for x in samples[start * channels : end * channels]]
        peak = max(abs(value) for value in cue)
        if peak == 0:
            raise ValueError(f"Silent cue {index}")
        gain = TARGET_PEAK / peak
        cue = [value * gain for value in cue]
        frames = len(cue) // channels
        fade_len = min(fade, frames // 4)
        for frame in range(fade_len):
            in_gain = (frame + 1) / fade_len
            out_gain = (fade_len - frame - 1) / fade_len
            for ch in range(channels):
                cue[frame * channels + ch] *= in_gain
                cue[(frames - frame - 1) * channels + ch] *= out_gain
        target = OUTPUT / f"placement-{index:02d}.wav"
        write_pcm16_wave(target, channels, rate, cue)
        print(
            f"{target.relative_to(ROOT)} duration={frames / rate:.3f}s "
            f"trim={start / rate:.3f}-{end / rate:.3f}s "
            f"sha256={digest(target)}"
        )
    print(f"source sha256={digest(SOURCE)}")


if __name__ == "__main__":
    main()
