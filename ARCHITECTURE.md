# Pulse: Real-Time EMS Voice AI Assistant
**Architecture Design Document**

## Overview
Pulse is an ultra-low latency, real-time Voice AI Assistant designed specifically for paramedics and emergency medical services (EMS). Built for the Moss Zero Latency Builder Sprint, the architecture guarantees a **sub-500ms voice-to-voice latency**, enabling seamless, hands-free conversational triage in high-stress environments.

---

## 1. Core Architecture Pipeline

### Audio Ingestion (Edge)
*   **Clients:** Ruggedized ambulance tablets running a React Native frontend.
*   **Protocol:** Raw audio is streamed bidirectionally via **WebRTC**.
*   **Edge Server:** A Node.js signaling server handles WebRTC termination and connection state (managed via Redis).

### Speech-to-Text (STT)
*   **Chunking:** The Node.js edge server chunks the inbound audio stream into 200ms segments.
*   **Model:** GPU-accelerated OpenAI Whisper.
*   **Inference Engine:** Nvidia T4 GPUs running on GKE (Google Kubernetes Engine) via Triton Inference Server to achieve sub-50ms transcription latency.

### Security & Orchestration (API Gateway)
*   **Gateway:** Kong API Gateway (Golang).
*   **PII Stripping:** A custom Golang plugin runs regex and NER (Named Entity Recognition) to strip Personally Identifiable Information (PII) like names and SSNs from the transcript before passing it to the core AI orchestrator.

### Intelligence & Context Retrieval (RAG)
*   **Database:** PostgreSQL with the `pgvector` extension.
*   **Context:** The Agent Orchestrator converts the incoming transcript into embeddings and queries the database for relevant medical protocols (e.g., Cardiac Arrest protocols) in under 10ms.
*   **LLM Inference:** The context and the sanitized transcript are streamed to **Groq's Llama 3 API**, leveraging Groq's LPU architecture for lightning-fast token generation.

### Text-to-Speech (TTS) & Delivery
*   **TTS Provider:** Cartesia (Sonic).
*   **Streaming:** As Groq generates tokens, they are streamed immediately to Cartesia to generate the synthetic voice response chunk-by-chunk.
*   **Delivery:** The synthesized audio chunks are pushed back down the WebRTC socket to the paramedic's tablet, achieving a total round-trip latency of under 500ms.

---

## 2. Infrastructure & Observability

*   **State Management:** Redis cluster for ephemeral WebRTC signaling and session state.
*   **Asynchronous Events:** Apache Kafka is used to publish non-blocking webhooks (e.g., dispatch alerts, SMS triggers via Twilio) so the critical voice loop is never interrupted.
*   **Deployment:** The entire stack is containerized and deployed across a multi-region Google Kubernetes Engine (GKE) cluster for high availability.
*   **GitOps:** ArgoCD automatically syncs Kubernetes manifests from the Git repository.
*   **Observability:** Prometheus and Grafana are strictly configured to monitor TTFT (Time to First Token) and end-to-end voice latency percentiles.
