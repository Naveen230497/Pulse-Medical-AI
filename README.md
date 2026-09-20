# 🚨 Pulse: Zero-Latency Field Medic OS (Prototype)
**Built for the YC Fall 2026 x Moss Zero-Latency Builder Sprint**

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

> **⚠️ NON-CLINICAL HACKATHON PROTOTYPE:** This software is a proof-of-concept built in 48 hours. It uses simulated patient data, lacks SOC 2 / HIPAA certification, and must **never** be used in live patient care.

Pulse is a zero-latency, voice-first AI co-pilot designed for single-patient field triage. By monitoring real-time patient telemetry and cross-referencing Electronic Health Records (EHR), Pulse acts as an always-listening supervisor to prevent fatal medical errors.

---

## 💡 The Solution
1. **Zero-Latency Voice:** The medic speaks naturally. Pulse processes the audio via WebSockets for ultra-fast response times.
2. **Deterministic Guardrails:** Pulse actively ingests the patient's EHR. If a medic suggests administering a drug (e.g., Amoxicillin) that conflicts with the patient's allergies (e.g., Penicillin class), a hardcoded, rule-based safety check instantly overrides the AI and flashes a critical warning.
3. **Multi-Lingual:** Pulse processes queries and responds natively in English, Hindi, and Telugu.

---

## 🏗️ System Architecture

Pulse utilizes a duplex WebSocket architecture to stream text and telemetry context directly into the LLM, bypassing traditional HTTP overhead. 

*   **Frontend:** Next.js, React, Tailwind CSS (Deployed on Google Cloud Run)
*   **Backend:** FastAPI, Python, WebSockets (Deployed on Google Cloud Run)
*   **AI/Inference:** Groq Cloud (Qwen 3.8-27b)
*   **Voice:** Web Speech API, Cartesia Sonic

### 🧠 Semantic Search (Moss Gateway Plan)
*Current State:* Telemetry and EHR data are directly injected into the prompt based on a 1:1 patient ID match.
*Future State:* We plan to integrate the **Moss Gateway** to perform sub-10ms semantic searches over thousands of medical protocols (e.g., matching "chest pain and low BP" to the correct EMS protocol).

---

## 🚀 Latency Benchmarks
In our testing, average latency across the pipeline:
*   **Speech-to-Text (Browser):** ~150ms
*   **Network Transport:** ~50ms
*   **Groq Inference (TTFT):** ~250ms
*   **Cartesia TTS (First Audio Byte):** ~150ms
*   **Total Glass-to-Glass Latency:** **~600ms**

---

## 🛠️ Local Installation (Docker)

You can run the entire stack locally with one command:

```bash
docker-compose up --build
```

(Ensure you have created a `.env` file in the `backend/` directory with `GROQ_API_KEY` and `CARTESIA_API_KEY`).
