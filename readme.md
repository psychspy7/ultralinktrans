# ULTRALINK by KITTY CORP

ULTRALINK is a static, local-first browser prototype that transmits short UTF-8 text messages through near-ultrasonic audio.

## Features

- Text → `ULNK v1` binary packet → 18.0 / 19.4 kHz BFSK audio
- Download generated signal as **WAV** or **320 kbps MP3**
- Upload browser-supported MP3/WAV audio and recover the original text
- CRC-16/CCITT packet integrity validation
- Live microphone listening for short phone-to-phone tests
- Responsive dark 3D cyber-system interface
- Installable PWA shell / offline core UI
- “Made by KITTY CORP” spotlight linked to https://kittycorp.vercel.app/

## Run locally

Microphone access requires a secure context. `localhost` counts as secure in current browsers.

```bash
cd ultralink-kitty-corp
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy

This is a static project. Deploy the folder directly to Vercel, Netlify, Cloudflare Pages, GitHub Pages, or any HTTPS static host. No backend, database, API key, or build step is required.

## Protocol

- Sample rate: 48 kHz mono
- Bit `0`: 18.0 kHz
- Bit `1`: 19.4 kHz
- Symbol time: 20 ms
- Pilot: 12 symbols at 18.0 kHz (240 ms)
- Marker: 6 symbols at 19.4 kHz (120 ms)
- Guard: 3 silent symbols (60 ms)
- Frame: `ULNK` magic + version + 16-bit payload length + UTF-8 payload + CRC-16/CCITT
- Max payload: 320 UTF-8 bytes

The decoder uses Goertzel carrier detection and searches around the measured pilot/marker transition for symbol alignment before accepting a packet. A packet is only exposed when its CRC validates.

## MP3 note

WAV is the recommended carrier because lossy codecs can attenuate frequencies near 20 kHz. MP3 export uses the open-source `lamejs` encoder at 320 kbps, loaded from cdnjs. If that CDN is unavailable, WAV generation and decoding still work; MP3 export will show an error instead of silently producing a bad file.

## Real-world limitations

Consumer phone speakers and microphones are not guaranteed to reproduce or capture 18–20 kHz. Some phones apply aggressive low-pass filtering, automatic gain, or noise processing. Some people (especially younger listeners) and animals may still hear these frequencies. Keep devices near each other, use a quiet room, and test on the actual target phones before relying on live transmission.

## Credits / design direction

The UI is an original implementation using the abstract system-focused, translucent, tactical cyber-ecosystem direction referenced by the user. It does not include or redistribute the original Dribbble artwork.

Made by KITTY CORP.
