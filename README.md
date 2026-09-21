# 🚨 Pulse: Zero-Latency Medical AI Co-Pilot

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Production](https://img.shields.io/badge/Status-Production-success.svg)](https://pulse-frontend-297907968720.us-central1.run.app)
[![Moss: Hybrid Search](https://img.shields.io/badge/Moss-Hybrid%20Search-10B981.svg)](https://moss.dev)
[![Gemini: 3-Tier Routing](https://img.shields.io/badge/Gemini-Smart%20Routing-4285F4.svg)](https://llm.hidevs.xyz)

> **The ultimate voice-first AI co-pilot for paramedics.** Featuring sub-700ms glass-to-glass latency, deterministic drug-allergy guardrails, cross-agent hospital handoff, and 50+ indexed EMS protocols via Moss Hybrid Search.

🔴 **Live Demo:** [pulse-frontend-297907968720.us-central1.run.app](https://pulse-frontend-297907968720.us-central1.run.app)

---

## 🏆 Key Features (Hackathon Highlights)

We built Pulse to be a production-ready, zero-latency operating system for field medics. Our key technical achievements include:

1. **⚡ Live E2E Telemetry & Moss UI:** The dashboard features a real-time **Moss Hybrid Search panel** and an **End-to-End Latency Badge**. Judges can visually verify our <5ms Moss retrieval and ~600ms total pipeline latency live on the screen.
2. **🧠 Cross-Agent Handoff (Zero Context Loss):** Seamlessly swap from the "Paramedic" AI to the "ER Doctor" AI. Both agents share the exact same **Moss SessionIndex**, meaning the ER Doctor instantly knows the patient's entire ambulance history without any prompt re-injection.
3. **🛡️ Deterministic Guardrails (0 Token Cost):** If a paramedic orders "Penicillin" for a patient with a Penicillin allergy, our Python-based rule engine intercepts the WebSocket stream and blocks the action *before* it ever reaches the LLM. 100% hallucination-free safety.
4. **📚 50+ Medical Protocols:** Expanded from 20 to 50 comprehensive EMS protocols (Trauma, Cardiac, OB, Tox, Neuro) fully indexed in the Moss Cloud using the in-process Python SDK for maximum speed.
5. **🔀 Smart Model Routing:** Dynamically routes simple queries to `gemini-3.5-flash-lite` and complex medical logic to `gemini-3.6-flash`, optimizing token usage perfectly.

---

## 💀 The Problem

**250,000+ preventable deaths** occur annually in EMS due to medication errors, delayed protocol recall, and communication breakdowns during patient handoff. A paramedic in a moving ambulance has no time to flip through a textbook — they need instant, voice-activated medical intelligence with zero margin for error.

## 💡 The Solution

Pulse is a **real-time, voice-first AI co-pilot** that:
* **Listens continuously** via WebSocket-streamed speech recognition
* **Retrieves exact medical protocols** in <5ms using Moss Hybrid Search (in-process Python SDK)
* **Blocks dangerous drugs** with deterministic, rule-based allergy guardrails
* **Speaks back** with sub-second Cartesia Sonic TTS in a natural voice
* **Supports 8 languages** including Hindi and Telugu with browser-native TTS fallback

---

## 🏗️ System Architecture

```mermaid
graph TD
    subgraph Frontend["Next.js Frontend (Cloud Run)"]
        STT[Browser Speech Recognition]
        UI[Ambulance Dashboard]
        TelemetryUI[Live Moss & E2E Latency Badges]
    end

    subgraph Backend["FastAPI Backend (Cloud Run, 1GB RAM)"]
        WS[WebSocket /ws/voice]
        AG[Allergy Guardrail - Deterministic]
        SR[Smart Model Router]
        MossSDK["Moss Python SDK (In-Process)"]
        Session[Moss Live Session Memory]
    end

    subgraph External["External Services"]
        Gemini["HiDevs Gemini Gateway\n3.5-flash-lite | 3.5-flash | 3.6-flash"]
        Cartesia[Cartesia Sonic TTS]
        MossCloud[Moss Cloud Index]
    end

    STT -->|WebSocket JSON| WS
    WS --> AG
    AG -->|"❌ BLOCKED"| UI
    AG -->|"✅ PASS"| MossSDK
    MossSDK -->|"Hybrid Search α=0.7\n<5ms"| SR
    Session -->|"Conversation Memory"| SR
    SR -->|"Simple → flash-lite\nMedium → flash\nComplex → 3.6-flash"| Gemini
    Gemini -->|Streaming Text| Cartesia
    Gemini -->|Streaming Text| UI
    Cartesia -->|PCM Audio Chunks| UI
    MossSDK -.->|Telemetry| TelemetryUI
    MossCloud -.->|"Startup Load"| MossSDK
```

### Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | Next.js 14, React, TailwindCSS | Server-side rendering, responsive ambulance dashboard |
| **Backend** | FastAPI, Python 3.11, WebSockets | Async-native, sub-ms routing |
| **LLM** | HiDevs Gemini Gateway (OpenAI SDK) | 3-tier smart model routing for token efficiency |
| **RAG** | **Moss Python SDK** (in-process) | Hybrid Search, Live Sessions, Cross-Agent Handoff |
| **TTS** | Cartesia Sonic (Multilingual) | Streaming WebSocket TTS, <150ms first audio byte |
| **Safety** | Rule-based allergy checker | Deterministic — never depends on LLM for safety decisions |
| **Deployment** | Google Cloud Run | Auto-scaling, pay-per-use |

---

## 🧠 Moss Integration Deep-Dive

Pulse uses the **Moss Python SDK** (`from moss import MossClient`) loaded in-process at server startup — NOT the CLI. This gives us **178x faster** protocol retrieval.

| Feature | Implementation | Benefit |
|---------|---------------|---------|
| **In-Process SDK** | `await moss_client.load_index("pulse-protocols")` at startup | 2-5ms queries vs 500ms CLI subprocess |
| **Hybrid Search** | `QueryOptions(alpha=0.7)` — 70% semantic, 30% keyword | Catches both exact drug names AND semantic medical concepts |
| **Live Session Memory** | `moss_client.session(index_name=f"call-{id}")` | Every conversation turn is indexed in real-time for context recall |
| **Cross-Agent Handoff** | Paramedic and ER Doctor share the same Moss SessionIndex | Zero context loss during patient handoff |
| **50 EMS Protocols** | Indexed via `moss_client.upsert()` with metadata | Covers cardiac, trauma, neuro, tox, peds, OB, environmental |

📄 **Full Moss integration details:** [docs/MOSS_INTEGRATION.md](docs/MOSS_INTEGRATION.md)

---

## 🚀 Latency Benchmarks

| Stage | Latency | Notes |
|-------|---------|-------|
| Speech-to-Text (Browser) | ~150ms | Web Speech API |
| Network Transport | ~50ms | WebSocket, Cloud Run |
| **Moss Hybrid Search** | **~3ms** | In-process Python SDK |
| Allergy Guardrail | <1ms | Deterministic Python |
| Smart Model Router | <1ms | Heuristic keyword check |
| Gemini TTFT | ~250ms | HiDevs Gateway |
| Cartesia TTS (First Byte) | ~150ms | WebSocket streaming |
| **Total Glass-to-Glass** | **~600ms** | Tracked live on the UI Dashboard |

---

## 🌐 Multi-Language Support

| Language | STT | LLM Response | TTS |
|----------|-----|-------------|-----|
| English | ✅ Browser API | ✅ Gemini | ✅ Cartesia Sonic |
| Hindi | ✅ Browser API | ✅ Gemini | ✅ Browser TTS Fallback |
| Telugu | ✅ Browser API | ✅ Gemini | ✅ Browser TTS Fallback |
| Spanish | ✅ Browser API | ✅ Gemini | ✅ Cartesia Sonic |

---

## 🛠️ Local Installation

```bash
git clone https://github.com/Naveen230497/Pulse-Medical-AI.git
cd Pulse-Medical-AI
```

Create `backend/.env`:
```env
HIDEVS_API_KEY=your-key
CARTESIA_API_KEY=your-key
MOSS_PROJECT_ID=your-project-id
MOSS_PROJECT_KEY=your-project-key
```

Run with Docker:
```bash
docker-compose up --build
```

---

## 📄 Documentation

- [Product Requirements Document (PRD)](docs/PRD.md)
- [Moss Integration Deep-Dive](docs/MOSS_INTEGRATION.md)
- [Architecture & Data Flow](docs/ARCHITECTURE.md)

---

## 📝 License

MIT License. See [LICENSE](LICENSE) for details.
