# Architecture & Data Flow

## High-Level System Architecture

```mermaid
graph TD
    subgraph Client["🖥️ Paramedic Dashboard (Next.js)"]
        MIC[🎤 Microphone] --> STT[Browser Speech-to-Text]
        PLAYER[🔊 Audio Player] 
        TELEM[📊 Moss Telemetry Panel]
        VITALS[❤️ Live Vitals Monitor]
    end

    subgraph Backend["⚡ FastAPI Backend (Cloud Run, 1GB RAM)"]
        WS[WebSocket Handler]
        GUARD[🛡️ Allergy Guardrail]
        MOSS[🧠 Moss SDK - In-Process]
        SESSION[📝 Moss Session Memory]
        ROUTER[🔀 Smart Model Router]
    end

    subgraph LLM["🤖 LLM Layer"]
        LITE[gemini-3.5-flash-lite<br/>Simple acknowledgments]
        FLASH[gemini-3.5-flash<br/>Standard medical queries]
        PRO[gemini-3.6-flash<br/>Complex multi-drug interactions]
    end

    subgraph Voice["🗣️ Voice Layer"]
        CARTESIA[Cartesia Sonic TTS<br/>WebSocket Streaming]
    end

    STT -->|WebSocket JSON| WS
    WS --> GUARD
    GUARD -->|"❌ ALLERGY DETECTED"| WS
    GUARD -->|"✅ SAFE"| MOSS
    MOSS --> SESSION
    SESSION --> ROUTER
    ROUTER -->|"≤4 words, simple"| LITE
    ROUTER -->|"Standard query"| FLASH
    ROUTER -->|">20 words, complex"| PRO
    LITE --> CARTESIA
    FLASH --> CARTESIA
    PRO --> CARTESIA
    CARTESIA -->|PCM Audio| WS
    WS --> PLAYER
    MOSS -->|Telemetry Event| TELEM
```

---

## Single Request Lifecycle

```mermaid
sequenceDiagram
    participant P as Paramedic
    participant F as Frontend (Next.js)
    participant B as Backend (FastAPI)
    participant G as Allergy Guard
    participant M as Moss SDK
    participant S as Moss Session
    participant R as Smart Router
    participant L as Gemini LLM
    participant T as Cartesia TTS

    P->>F: Speaks: "Give the patient Amoxicillin"
    F->>F: Browser STT (150ms)
    F->>B: WebSocket: {type: "text", text: "...", vitals: {...}, profile: {...}}
    
    B->>G: check_allergies("Amoxicillin", "Penicillin")
    
    alt Allergy Detected
        G-->>B: "⚠️ CRITICAL: Patient allergic to Penicillin class!"
        B-->>F: {type: "text_chunk", content: "⚠️ CRITICAL..."}
        Note over B: LLM never called. 0 tokens spent.
    else Safe
        G-->>B: null (no allergy)
        B->>M: query("pulse-protocols", "Amoxicillin", alpha=0.7)
        M-->>B: Protocol: "Antibiotic Administration" (2.8ms)
        B->>F: {type: "moss_telemetry", latency_ms: 2.8, protocol: "..."}
        B->>S: query("Amoxicillin") — check conversation history
        S-->>B: Recent context: "Patient has infection"
        B->>S: add_docs("Paramedic asked about Amoxicillin")
        B->>R: Route based on query complexity
        R->>L: Stream to gemini-3.5-flash (standard query)
        
        par Parallel Streaming
            L-->>B: Streaming text chunks
            B-->>F: {type: "text_chunk", content: "..."}
            L-->>T: Streaming text to TTS
            T-->>B: PCM audio chunks
            B-->>F: {type: "audio_chunk", data: "base64..."}
        end
        
        B->>S: add_docs("AI recommended: ...")
        B-->>F: {type: "end_response"}
    end
    
    F->>P: Plays audio + shows text
```

---

## Cross-Agent Handoff Flow

```mermaid
sequenceDiagram
    participant P as Paramedic
    participant F as Frontend
    participant B as Backend
    participant M as Moss Session
    participant A1 as Agent: Paramedic Co-Pilot
    participant A2 as Agent: ER Doctor

    Note over P,A1: Phase 1: Ambulance Ride (5 minutes)
    
    P->>F: "Patient has chest pain, give aspirin"
    F->>B: {persona: "PARAMEDIC"}
    B->>M: Index turn: "Paramedic: chest pain, aspirin"
    B->>A1: System prompt: "You are a field medic co-pilot..."
    A1-->>P: "Copy. Administering 325mg Aspirin orally."
    B->>M: Index turn: "AI: Aspirin 325mg"

    Note over P,A2: Phase 2: Hospital Arrival — Handoff

    P->>F: Clicks "Handoff to ER" button
    F->>F: setPersona('ER_DOCTOR')
    P->>F: "Doctor, I'm handing the patient over"
    F->>B: {persona: "ER_DOCTOR"}
    B->>M: Query session: "handoff patient"
    M-->>B: Returns ALL ambulance turns (chest pain, aspirin, allergy)
    B->>A2: System prompt: "You are Dr. Pulse, Lead Trauma Surgeon..."
    A2-->>P: "I see from the ambulance report: chest pain, Aspirin given, Penicillin allergy. Prepare Trauma Bay 1."
    
    Note over M: Same Moss SessionIndex. Zero context loss.
```

---

## Smart Model Routing Logic

```mermaid
flowchart TD
    INPUT[Paramedic Query] --> CHECK{Word Count & Keywords}
    
    CHECK -->|"≤4 words AND contains<br/>yes/no/copy/stable/ok"| LITE["gemini-3.5-flash-lite<br/>~100 tokens max<br/>Cost: Lowest"]
    
    CHECK -->|">20 words OR contains<br/>complex/interaction"| PRO["gemini-3.6-flash<br/>~500 tokens max<br/>Cost: Highest"]
    
    CHECK -->|"Everything else"| FLASH["gemini-3.5-flash<br/>~300 tokens max<br/>Cost: Medium"]
    
    LITE --> SAVE["Saves ~60% tokens<br/>on simple acknowledgments"]
    FLASH --> BALANCE["Optimal balance of<br/>speed and quality"]
    PRO --> QUALITY["Maximum quality for<br/>complex medical decisions"]
```

---

## Deployment Architecture

```mermaid
graph LR
    subgraph GCP["Google Cloud Platform"]
        subgraph CR1["Cloud Run: pulse-frontend"]
            FE[Next.js 14<br/>SSR + Static Assets]
        end
        subgraph CR2["Cloud Run: pulse-backend"]
            BE[FastAPI<br/>1GB RAM<br/>Moss Index in Memory]
        end
    end
    
    subgraph External
        HIDEVS[HiDevs Gemini Gateway<br/>llm.hidevs.xyz/v1]
        CARTESIA[Cartesia TTS API<br/>WebSocket Streaming]
        MOSSCLOUD[Moss Cloud<br/>Index Sync]
    end
    
    USER[👤 Paramedic Browser] -->|HTTPS| FE
    USER -->|WSS| BE
    BE -->|HTTPS| HIDEVS
    BE -->|WSS| CARTESIA
    BE -.->|Startup Sync| MOSSCLOUD
```
