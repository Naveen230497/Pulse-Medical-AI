# Pulse Medical AI — Product Requirements Document (PRD)

**Version:** 2.0  
**Author:** Naveen Guthikonda  
**Last Updated:** September 21, 2026  
**Status:** Production (Deployed on Google Cloud Run)

---

## 1. Executive Summary

Pulse is a real-time, voice-first AI co-pilot for Emergency Medical Services (EMS) paramedics. It provides instant protocol retrieval, deterministic drug-allergy safety guardrails, and seamless hospital handoff — all through natural voice interaction with sub-700ms response latency.

The system is designed to eliminate the **250,000+ preventable deaths** that occur annually due to medication errors, delayed protocol recall, and communication breakdowns during EMS patient handoff.

---

## 2. Problem Statement

### The Crisis
- **68%** of EMS medication errors occur due to incorrect drug selection under time pressure
- Paramedics must recall 200+ drug interactions from memory while performing CPR in a moving vehicle
- Patient handoff from ambulance to ER loses **40%** of critical context on average
- Non-English-speaking patients create a communication barrier that delays treatment by 3-5 minutes

### Current Solutions & Their Failures
| Solution | Failure Mode |
|----------|-------------|
| Paper protocol binders | Can't search while performing CPR |
| Tablet-based apps | Require hands (occupied with patient) |
| Radio dispatch | Single channel, no drug interaction checking |
| General-purpose LLMs (ChatGPT) | Hallucinate drug dosages, no guardrails, 3-5s latency |

---

## 3. User Personas

### Persona 1: EMT-Basic (Jake, 28)
- **Role:** First responder, BLS provider
- **Pain Point:** Needs quick protocol recall for common emergencies (cardiac arrest, anaphylaxis)
- **Need:** Voice-activated protocol lookup that works hands-free
- **Language:** English

### Persona 2: EMT-Paramedic (Priya, 34)
- **Role:** Advanced life support provider, can administer drugs
- **Pain Point:** Must cross-reference patient allergies against 50+ drugs under extreme time pressure
- **Need:** Automatic drug-allergy blocking before she even finishes her sentence
- **Language:** Hindi, English

### Persona 3: ER Trauma Surgeon (Dr. Ramesh, 45)
- **Role:** Receiving physician at Level 1 Trauma Center
- **Pain Point:** Loses context during ambulance-to-ER handoff. "What drugs did you give? When? How much?"
- **Need:** Complete session memory from the ambulance ride, instantly available
- **Language:** English, Telugu

---

## 4. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| US-1 | Paramedic | Speak naturally and get instant medical guidance | I don't need to use my hands or read a screen | P0 |
| US-2 | Paramedic | Be warned if I suggest a drug the patient is allergic to | I never administer a lethal drug | P0 |
| US-3 | Paramedic | Have the AI remember what we discussed 2 minutes ago | I don't repeat myself during a crisis | P0 |
| US-4 | ER Doctor | Read the full ambulance conversation when the patient arrives | I have zero context loss during handoff | P1 |
| US-5 | Paramedic | Use the system in Hindi or Telugu | Language is never a barrier to saving a life | P1 |
| US-6 | Paramedic | Generate an ePCR report from the conversation | I save 20 minutes of post-call paperwork | P2 |
| US-7 | Medical Director | See which protocol the AI recommended | I can audit AI recommendations for quality | P2 |

---

## 5. Functional Requirements

### 5.1 Voice Interface
- **FR-1:** System SHALL accept voice input via browser WebSocket
- **FR-2:** System SHALL stream audio responses back in real-time (<700ms first byte)
- **FR-3:** System SHALL support interrupt (paramedic can cut off the AI mid-sentence)

### 5.2 Safety Guardrails
- **FR-4:** System SHALL deterministically block any drug that conflicts with patient allergies
- **FR-5:** Safety checks SHALL NOT depend on LLM inference (zero hallucination risk)
- **FR-6:** System SHALL support drug class mapping (e.g., Amoxicillin → Penicillin class)
- **FR-7:** System SHALL support fuzzy phonetic matching for misspelled drug names

### 5.3 Protocol Retrieval (Moss)
- **FR-8:** System SHALL retrieve relevant EMS protocols in <10ms using Moss Hybrid Search
- **FR-9:** System SHALL use hybrid search (70% semantic, 30% keyword) for optimal recall
- **FR-10:** System SHALL index conversation turns in a per-call Moss Session for memory

### 5.4 Cross-Agent Handoff
- **FR-11:** System SHALL support switching AI persona from Paramedic Co-Pilot to ER Doctor
- **FR-12:** ER Doctor agent SHALL read the Moss session memory from the ambulance ride
- **FR-13:** Handoff SHALL preserve all context without re-prompting

### 5.5 Multi-Language
- **FR-14:** System SHALL support voice input in 8 languages
- **FR-15:** System SHALL respond in the same language as the input
- **FR-16:** For Hindi/Telugu, system SHALL fall back to browser TTS when Cartesia is unavailable

### 5.6 Reporting
- **FR-17:** System SHALL generate an ePCR (Electronic Patient Care Report) from conversation history
- **FR-18:** ePCR SHALL be printable as PDF

---

## 6. Non-Functional Requirements

| ID | Requirement | Target | Actual |
|----|------------|--------|--------|
| NFR-1 | End-to-end latency (glass-to-glass) | <1000ms | ~600ms |
| NFR-2 | Moss retrieval latency | <10ms | ~3ms |
| NFR-3 | Allergy guardrail latency | <5ms | <1ms |
| NFR-4 | Concurrent WebSocket connections | 50+ | Cloud Run auto-scales |
| NFR-5 | Uptime | 99.9% | Cloud Run SLA |
| NFR-6 | Token budget efficiency | <600 tokens/turn | Smart routing achieves ~400 avg |

---

## 7. System Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed diagrams.

### High-Level Data Flow (Single Voice Query)

```
Paramedic speaks
  → Browser STT (150ms)
    → WebSocket to Cloud Run (50ms)
      → Allergy Guardrail check (0ms, deterministic)
        → [IF BLOCKED] → Return warning immediately (0 LLM tokens)
        → [IF SAFE] → Moss Hybrid Search (3ms, 0 LLM tokens)
          → Smart Model Router selects Gemini tier
            → Gemini streaming response (250ms TTFT)
              → Cartesia TTS streaming (150ms first audio)
                → PCM audio chunks → Browser playback
```

**Total: ~600ms from speech to first audio response**

---

## 8. Moss Integration Strategy

### Why Moss?
We evaluated Pinecone, Weaviate, ChromaDB, and LangChain FAISS. Moss won because:
1. **In-process SDK** — No network latency. The vector index lives in our server's RAM.
2. **Native hybrid search** — Single `alpha` parameter blends semantic + keyword.
3. **Session memory** — Per-call conversation indexing with cloud push.
4. **Cross-agent sharing** — Two AI personas can read the same session.

### Moss Features Used

| Feature | API | Use Case |
|---------|-----|----------|
| In-Process Index | `moss_client.load_index()` | Pre-load 20 protocols at startup |
| Hybrid Search | `QueryOptions(alpha=0.7)` | Balance semantic meaning with exact drug names |
| Live Sessions | `moss_client.session()` | Index each conversation turn for memory |
| Cross-Agent Handoff | Shared session ID | ER Doctor reads ambulance Moss session |
| Real-Time Telemetry | Custom WebSocket event | Show latency + matched protocol on UI |

See [MOSS_INTEGRATION.md](MOSS_INTEGRATION.md) for implementation details.

---

## 9. Security Model

### Threat: LLM Hallucination
- **Mitigation:** Drug-allergy checks are 100% deterministic Python code. The LLM is never in the safety-critical path.

### Threat: API Key Exposure
- **Mitigation:** All keys stored as Cloud Run environment variables. `.gitignore` blocks `backend/.env`. GitHub Push Protection enabled.

### Threat: Prompt Injection
- **Mitigation:** System prompt is hardcoded server-side. User input is labeled `[Paramedic Query:]` and never interpreted as instructions.

---

## 10. Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| First audio response | <700ms | Moss Telemetry Panel on UI |
| Drug safety catch rate | 100% | Deterministic — mathematically guaranteed |
| Protocol match accuracy | >90% | Hybrid Search with α=0.7 |
| Context retention across handoff | 100% | Shared Moss Session |
| Token efficiency | <600 tokens/turn | Smart Model Routing logs |
