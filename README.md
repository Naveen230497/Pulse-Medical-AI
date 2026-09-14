# 🚑 Pulse: Zero-Latency Field Medic OS

**Track:** Real-Time Voice and Conversational AI  
**Hackathon:** YC Fall 2026 x Moss: The Zero Latency Builder Sprint

Pulse is a hands-free, voice-first EMS Co-Pilot built to eliminate prehospital medication dosing errors by providing paramedics with instant, sub-second auditory access to critical medical protocols.

> **🛑 NON-CLINICAL BETA:** This software is in active development and currently utilizes third-party cloud APIs (Google Cloud STT, Groq, Cartesia) without signed Business Associate Agreements (BAAs). It is not yet HIPAA compliant and must not be used with real Protected Health Information (PHI) or in live patient care environments.

---

## ⚠️ The Problem: Cognitive Load in Crisis

Pediatric prehospital drug dosing errors are a severe patient-safety crisis. Paramedics operate under immense time pressure and stress, leading to calculation and recall errors. 

* One major study covering 56,000 U.S. children found that for critical drugs like epinephrine, **over 60% of prehospital preparations contained an error**, with average overdoses exceeding 800%. 
* Existing physical tools like the Broselow tape still leave error rates above 30%.
* When treating a critical patient, a paramedic's hands are full. Stopping CPR or wound management to type a search query into a tablet takes too long and breaks focus.

## 💡 The Solution

Pulse bypasses screens and physical tapes. A paramedic can verbally request protocols and dosages while keeping their hands on the patient. 

Built on a deeply optimized streaming architecture, Pulse achieves a **sub-second** post-trigger processing latency, resulting in a total perceived wait time (from silence to audio) of just over 1 second.

---

## ⚡ Architecture & Tech Stack

Pulse orchestrates multiple bleeding-edge APIs via WebSockets to achieve near-instantaneous Voice-to-Voice interactions.

* **Frontend:** Next.js 15, React 19, Tailwind CSS (Glassmorphism Dashboard)
* **Voice Input (STT):** Browser-Native Web Speech API (Near-real-time, cloud-processed by default)
* **Backend:** Python FastAPI & asyncio WebSockets
* **Retrieval (RAG):** Moss (Sub-10ms semantic search for EMS protocols)
* **Inference (LLM):** Groq `qwen/qwen3.8-27b` (TTFT ~150ms)
* **Speech Synthesis (TTS):** Cartesia Sonic API (<100ms generation)

### The Realistic Latency Breakdown
True Voice AI latency isn't just LLM generation—it's the entire human-computer interaction loop. Here is the exact math from silence to audio:

1. **Interaction Buffer (VAD):** 500ms silence hangover. *(Note: This is an aggressive baseline optimized for speed. The known trade-off is that mid-sentence cognitive pauses under stress may trigger premature submission. Production will require dynamic/adaptive VAD rather than a static timeout).*
2. **System Processing Floor:** Once triggered, network hops + Groq TTFT (~150ms) + Cartesia synthesis (~100ms) = 600-900ms depending on Wi-Fi/LTE conditions.
3. **Total Perceived Wait Time:** ~1.1s to 1.4s from the moment the paramedic stops speaking to the first audio byte.

---

## 🛡️ Core Features & Safety Mechanisms

### 1. "Barge-in" Interruption
If the paramedic realizes they misspoke, or the patient's condition changes, they can speak over the AI. The frontend instantly drops the audio buffer and sends an interrupt signal to FastAPI, terminating the LLM/TTS generation mid-sentence to listen to the new command.

### 2. Mitigating AI Trust Liability (Closed-Loop Communication)
"Zero hallucinations" does not exist in LLMs, and mixing up `mg` and `mcg` causes fatal overdoses. To reduce the risk of blind AI trust, Pulse is strictly programmed with **Closed-Loop Communication**. The AI explicitly reads back the patient criteria, drug, dose, and unit, and ends with *"Do you copy?"* This doesn't magically prevent hallucinations, but it forces an active human confirmation of every value before action is taken.

### 3. Sirens & UI Fallback
Because voice interfaces degrade in loud environments, Pulse includes a multimodal fallback: a massive **"Tap to Send"** button that overrides Voice Activity Detection, and a persistent visual log of the exact retrieved protocol so paramedics can read it if the audio is drowned out.

---

## 💻 How to Run Locally

### Prerequisites
* Node.js 20+
* Python 3.12+
* Google Chrome (Required for Web Speech API support)
* API Keys for Groq and Cartesia

### 1. Start the Backend
```bash
cd backend
python -m venv venv
# Activate venv (Windows: .\venv\Scripts\activate | Mac: source venv/bin/activate)
pip install -r requirements.txt

# Create a .env file and add your keys:
# GROQ_API_KEY=your_key
# CARTESIA_API_KEY=your_key

uvicorn main:app --reload
```

### 2. Start the Frontend
Open a new terminal:
```bash
cd frontend
npm install
npm run dev
```

### 3. Test the Application
Open **Google Chrome** and navigate to `http://localhost:3001`.
Click "Press to Speak" and ask: *"What is the pediatric dose for Fentanyl?"*

---

## 🚀 Future Roadmap for Production

**1. Acoustic Environment & Noise Robustness**
Ambulances are exceptionally loud (sirens, radio chatter, engine noise). The MVP Web Speech API degrades rapidly in these conditions. Our production roadmap includes moving to a custom STT pipeline utilizing **contextual phrase-biasing** (weighting the STT engine to expect a known EMS vocabulary) and integrating DSP noise-cancellation or directional mic hardware requirements to isolate the medic's voice.

**2. Offline Capability & HIPAA Compliance**
While this MVP utilizes the browser's default cloud-based STT for rapid prototyping, deployment will replace this with a local, on-device Whisper model. This reduces reliance on network hops and addresses strict HIPAA requirements for patient-adjacent audio. (Full zero-connectivity operation will require migrating the LLM, RAG, and TTS legs to local hardware).
