"""Synthesises Ashnote's notification sounds into assets/sounds/*.wav (mono, 22.05 kHz, 16-bit).
Original tones made here, so there are no licensing questions. Run: python3 tools/make_sounds.py"""
import math, os, struct, wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "sounds")

def tone(freq, dur, vol=0.5, attack=0.01, release=0.12, glide_to=None, shimmer=0.0):
    n = int(RATE * dur); out = []
    for i in range(n):
        t = i / RATE
        f = freq if glide_to is None else freq + (glide_to - freq) * (i / n)
        env = min(1.0, t / attack) * min(1.0, (dur - t) / release) if dur - t < release or t < attack else 1.0
        s = math.sin(2 * math.pi * f * t) + 0.25 * math.sin(4 * math.pi * f * t)
        if shimmer: s *= 1 - shimmer + shimmer * math.sin(2 * math.pi * 18 * t)
        out.append(vol * env * s / 1.25)
    return out

def silence(d): return [0.0] * int(RATE * d)

def write(name, samples):
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name + ".wav"), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32000)) for s in samples))

write("message", tone(880, 0.12, 0.35) + tone(1320, 0.22, 0.3))                      # soft two-note chime
write("sent", tone(520, 0.18, 0.25, glide_to=900, release=0.1))                      # rising whoosh
write("dissolve", tone(1500, 0.5, 0.22, glide_to=500, shimmer=0.6, release=0.3))     # falling shimmer
write("paired", tone(660, 0.1, 0.3) + tone(830, 0.1, 0.3) + tone(990, 0.28, 0.32))   # bright rising arpeggio
write("expired", tone(220, 0.25, 0.45, glide_to=140, release=0.2))                   # low drop
write("help", (tone(740, 0.18, 0.45) + silence(0.08) + tone(587, 0.3, 0.45)) * 2)    # two-tone alert
write("sos", (tone(1046, 0.16, 0.6) + silence(0.05)) * 3 + silence(0.25) + (tone(1046, 0.16, 0.6) + silence(0.05)) * 3)  # urgent pulses
print("ok")
