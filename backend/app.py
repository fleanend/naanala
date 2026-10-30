"""FastAPI frontend host and dummy Syllable Pitch exercises."""

import math
import struct
import wave
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


class PitchSyllableExercise(BaseModel):
    syllables_no_pitch = list[str]
    tone_contour = list[str]
    audio_file = str


app = FastAPI(title="Naanala API")
WEB = Path(__file__).resolve().parent.parent / "web"
FREQUENCIES = {"low": 220, "high": 440}


@app.get("/api/tests/syllable-pitch/random", response_model=PitchSyllableExercise)
def syllable_pitch() -> PitchSyllableExercise:
    return PitchSyllableExercise(
    )


@lru_cache(maxsize=2)
def tone_wav(pitch: str) -> bytes:
    rate = 22050
    count = int(rate * 0.8)
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        # Short fades avoid clicks at the beginning and end of each tone.
        samples = (
            int(10000 * min(1, i / (rate * .02), (count - 1 - i) / (rate * .02))
                * math.sin(2 * math.pi * FREQUENCIES[pitch] * i / rate))
            for i in range(count)
        )
        audio.writeframes(struct.pack(f"<{count}h", *samples))
    return output.getvalue()


@app.get("/api/audio/dummy/{pitch}.wav")
def dummy_audio(pitch: str) -> Response:
    if pitch not in FREQUENCIES:
        raise HTTPException(status_code=404, detail="Unknown dummy tone")
    return Response(tone_wav(pitch), media_type="audio/wav", headers={"Cache-Control": "public, max-age=3600"})


# Mount only the public frontend, after API routes. Legacy code and project files stay private.
app.mount("/", StaticFiles(directory=WEB, html=True), name="frontend")
