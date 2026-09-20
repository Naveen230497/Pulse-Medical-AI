# Pulse API Reference

## WebSocket Duplex Stream

**Endpoint:** `ws://localhost:8000/ws/voice`

This is the core duplex streaming endpoint that handles the zero-latency audio and context routing.

### 1. Client to Server (Telemetry & Voice Text)
The frontend sends JSON payloads containing real-time vitals, patient EHR data, and the transcribed voice text.

```json
{
  "type": "text",
  "text": "The patient is unable to breathe.",
  "lang": "en-US",
  "vitals": {
    "hr": 75,
    "spo2": 98,
    "bpSys": 120,
    "bpDia": 80
  },
  "profile": {
    "name": "John Doe",
    "age": 42,
    "allergies": "Penicillin",
    "history": "Hypertension"
  }
}
```

### 2. Server to Client (Audio & Text Stream)
The server responds with overlapping text tokens and Cartesia PCM audio chunks.

**Text Token Chunk:**
```json
{
  "type": "text_chunk",
  "content": "Administer"
}
```

**Audio PCM Chunk:**
```json
{
  "type": "audio_chunk",
  "data": "<base64_pcm_audio_string>"
}
```

## REST Endpoints

**POST** `/generate_epcr`
Generates a highly-formatted Electronic Patient Care Report using Groq.

**Request:**
```json
{
  "patient": {
    "name": "John Doe",
    "age": 42
  },
  "transcript": "Administered 1mg Epinephrine IV."
}
```
