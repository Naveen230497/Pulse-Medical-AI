import os
import json
import logging
import asyncio
import socket
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import websockets
from openai import AsyncOpenAI
from moss import MossClient, QueryOptions, DocumentInfo

MOSS_CACHE = {} # LRU cache for demo

from services.allergy_checker import check_allergies

# IPv4-only patch for Cloud Run
orig_getaddrinfo = socket.getaddrinfo
def new_getaddrinfo(*args, **kwargs):
    responses = orig_getaddrinfo(*args, **kwargs)
    return [r for r in responses if r[0] == socket.AF_INET]
socket.getaddrinfo = new_getaddrinfo

logging.basicConfig(level=logging.INFO)
load_dotenv()

moss_client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global moss_client
    MOSS_PROJECT_ID = os.getenv("MOSS_PROJECT_ID")
    MOSS_PROJECT_KEY = os.getenv("MOSS_PROJECT_KEY")
    if MOSS_PROJECT_ID and MOSS_PROJECT_KEY:
        try:
            logging.info("⏳ Connecting to Moss Cloud (timeout = 10s)...")
            moss_client = MossClient(MOSS_PROJECT_ID, MOSS_PROJECT_KEY)
            await asyncio.wait_for(moss_client.load_index("pulse-protocols"), timeout=10.0)
            logging.info("✅ Moss index 'pulse-protocols' loaded successfully.")
        except asyncio.TimeoutError:
            logging.error("❌ Moss Cloud connection timed out. Booting without Moss.")
            moss_client = None
        except Exception as e:
            logging.error(f"❌ Failed to initialize Moss Client: {e}")
            moss_client = None
    else:
        logging.warning("⚠️ MOSS_PROJECT_ID or MOSS_PROJECT_KEY not set. Moss disabled.")
    yield

app = FastAPI(title="Pulse Voice Backend v3.0 - Finale Edition", lifespan=lifespan)

ALLOWED_ORIGINS = [
    "https://pulse-frontend-297907968720.us-central1.run.app",
    "http://localhost:3000",
    "http://localhost:3001",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

HIDEVS_API_KEY = os.getenv("HIDEVS_API_KEY")
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")

llm_client = AsyncOpenAI(api_key=HIDEVS_API_KEY, base_url="https://llm.hidevs.xyz/v1") if HIDEVS_API_KEY else None

SYSTEM_PROMPT_PARAMEDIC = """You are Pulse, an ultra-fast, Universal Medical AI Co-Pilot for a Paramedic en route to the hospital.
CRITICAL SAFETY GUARDRAILS (ALLERGY & VITALS CHECK):
Before you recommend or confirm ANY medication or intervention, you MUST silently read the Patient's File (Allergies/History) and the Telemetry Vitals.
If the paramedic suggests a drug that the patient is ALLERGIC to, you must instantly reply with a critical warning stating the patient is allergic and suggest a safe alternative.
If the vitals indicate a crashing patient, interrupt their query to address the life-threatening vitals immediately!
Answer EVERYTHING asked by the user. Do not refuse health questions. Use [RECENT CONVERSATION HISTORY] to remember context. NO MARKDOWN.
CRITICAL RULE: KEEP YOUR RESPONSES EXTREMELY SHORT (MAXIMUM 2 SENTENCES)."""

SYSTEM_PROMPT_ER_DOCTOR = """You are Dr. Pulse, the Lead Trauma Surgeon at the receiving Level 1 Trauma Center.
The paramedic has just arrived and handed off the patient to you.
You are reviewing the [RECENT CONVERSATION HISTORY] which contains the exact Moss session memory from the ambulance ride.
Your job is to read the ambulance history, synthesize the patient's condition, and tell your trauma team what to do next.
Be authoritative, concise, and medical. Say things like "I see from the ambulance report that...", "Prepare Trauma Bay 1", "We need a CT scan". NO MARKDOWN.
CRITICAL RULE: KEEP YOUR RESPONSES EXTREMELY SHORT (MAXIMUM 2 SENTENCES)."""


# ─────────────────────────────────────────────
# OPTION 2: ADAPTIVE VITALS CLASSIFIER
# Shifts Moss alpha and top_k based on patient severity
# ─────────────────────────────────────────────
def classify_vitals(vitals: dict) -> dict:
    """
    Classifies patient vitals severity and returns the optimal
    Moss query parameters (alpha, top_k) for the current state.

    STABLE  -> alpha=0.70, top_k=2  (balanced hybrid search)
    ELEVATED -> alpha=0.80, top_k=3  (weight toward semantic)
    CRITICAL -> alpha=0.95, top_k=4  (pure semantic, maximum recall)
    """
    if not vitals:
        return {"severity": "STABLE", "alpha": 0.70, "top_k": 2}

    hr = vitals.get("hr", 75)
    spo2 = vitals.get("spo2", 98)
    bp_sys = vitals.get("bpSys", 120)

    # CRITICAL: Flatline, profound hypoxia, or severe hypotension
    if hr == 0 or spo2 < 85 or bp_sys < 70:
        return {"severity": "CRITICAL", "alpha": 0.95, "top_k": 4}

    # ELEVATED: Tachycardia, low sat, or moderate hypotension
    if hr > 130 or hr < 40 or spo2 < 92 or bp_sys < 90:
        return {"severity": "ELEVATED", "alpha": 0.80, "top_k": 3}

    return {"severity": "STABLE", "alpha": 0.70, "top_k": 2}


class EPCRRequest(BaseModel):
    transcript: str
    patient: dict


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "version": "3.0-finale",
        "llm": "configured" if llm_client else "missing",
        "moss": "loaded" if moss_client else "unloaded"
    }


# ─────────────────────────────────────────────
# OPTION 3: STRUCTURED ePCR GENERATION
# Returns JSON-structured sections, not plain text
# ─────────────────────────────────────────────
@app.post("/generate_epcr")
async def generate_epcr(request: EPCRRequest):
    if not llm_client:
        return {"error": "HIDEVS_API_KEY missing."}
    logging.info(f"ePCR generation requested for patient: {request.patient.get('name', 'Unknown')}")

    import datetime
    ist_time = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
    timestamp = ist_time.strftime("%Y-%m-%d %H:%M:%S IST")
    prompt = (
        f"Generate an official EMS ePCR (Electronic Patient Care Report).\n"
        f"Timestamp: {timestamp}\n"
        f"Patient File: {json.dumps(request.patient)}\n\n"
        f"Incident Transcript:\n{request.transcript}\n\n"
        f"Format strictly with these markdown sections:\n"
        f"## 1. Incident Summary\n"
        f"## 2. Vitals Log\n"
        f"## 3. Interventions Administered\n"
        f"## 4. Clinical Assessment\n"
        f"## 5. Disposition & Handoff Notes\n\n"
        f"Write it as a professional hospital legal record. Include the timestamp. "
        f"Be specific, use medical terminology. No conversational filler."
    )
    try:
        completion = await llm_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="gemini-3.5-flash",
            max_tokens=800,
        )
        return {"report": completion.choices[0].message.content}
    except Exception as e:
        logging.error(f"ePCR generation error: {e}")
        return {"error": str(e)}


# ─────────────────────────────────────────────
# OPTION 1: OFFLINE PROTOCOL EXPORT ENDPOINT
# Frontend fetches this on load and caches it in localStorage
# ─────────────────────────────────────────────
@app.get("/offline/protocols")
async def get_offline_protocols():
    """
    Returns the full protocols list for the frontend to cache in localStorage.
    This enables the Dead Reckoning offline mode.
    """
    try:
        protocols_path = os.path.join(os.path.dirname(__file__), "data", "protocols.json")
        with open(protocols_path, "r", encoding="utf-8") as f:
            protocols = json.load(f)
        return {"protocols": protocols, "cached_at": time.time()}
    except Exception as e:
        logging.error(f"Failed to serve offline protocols: {e}")
        return {"protocols": [], "cached_at": time.time()}


async def stream_ai_to_cartesia(
    text: str,
    frontend_ws: WebSocket,
    vitals: dict = None,
    profile: dict = None,
    lang: str = "en-US",
    moss_session=None,
    persona: str = "PARAMEDIC",
    req_start: float = 0.0,
    session_turn_counter: list = None,
) -> str:

    patient_allergies = profile.get('allergies', 'none') if profile else 'none'
    allergy_warning = check_allergies(text, patient_allergies)

    if allergy_warning:
        # Emit guardrail telemetry with severity tag
        await frontend_ws.send_text(json.dumps({
            "type": "moss_telemetry",
            "latency_ms": 0.0,
            "alpha": 0.0,
            "severity": "GUARDRAIL",
            "protocol": "⚠️ GUARDRAIL TRIGGERED — Allergy conflict detected",
            "session_turns": session_turn_counter[0] if session_turn_counter else 0
        }))
        await frontend_ws.send_text(json.dumps({"type": "guardrail_alert", "message": allergy_warning}))
        await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": allergy_warning}))
        e2e_ms = (time.time() - req_start) * 1000
        await frontend_ws.send_text(json.dumps({"type": "e2e_latency", "latency_ms": e2e_ms, "model": "guardrail-0-tokens"}))
        return allergy_warning

    # ── OPTION 2: Adaptive Moss query parameters based on vitals ──
    vitals_meta = classify_vitals(vitals)
    adaptive_alpha = vitals_meta["alpha"]
    adaptive_top_k = vitals_meta["top_k"]
    vitals_severity = vitals_meta["severity"]
    logging.info(f"Vitals severity: {vitals_severity} | Moss alpha={adaptive_alpha}, top_k={adaptive_top_k}")

    moss_protocol = "No specific protocol matched."
    recent_context = ""
    session_count = session_turn_counter[0] if session_turn_counter else 0

    if moss_client:
        m_start = time.time()
        try:
            # RUN MOSS RAG AND MOSS SESSION CONCURRENTLY with ULTRA-FAST LRU CACHE
            cache_key = f"{text.lower().strip()}_{adaptive_top_k}_{adaptive_alpha}"
            
            if cache_key in MOSS_CACHE:
                moss_protocol, recent_context, session_count = MOSS_CACHE[cache_key]
                logging.info("?? MOSS CACHE HIT! Latency: <1ms")
            else:
                async def fetch_knowledge():
                    try:
                        res = await asyncio.wait_for(
                            moss_client.query("pulse-protocols", text, QueryOptions(top_k=adaptive_top_k, alpha=adaptive_alpha)),
                            timeout=1.5
                        )
                        return "\n".join([f"- {d.text}" for d in res.docs]) if res and res.docs else "Base protocol fallback."
                    except Exception as e:
                        logging.warning(f"Moss Query Error/Timeout: {e}")
                        return "Base protocol fallback due to timeout."

                async def fetch_session():
                    if not moss_session: return "", 0
                    try:
                        await moss_session.add_docs([DocumentInfo(id=f"user-{int(time.time()*1000)}", text=f"Paramedic: {text}")])
                        s_res = await moss_session.query(text, QueryOptions(top_k=2))
                        ctx = "\n".join([f"- {d.text}" for d in s_res.docs]) if s_res and s_res.docs else ""
                        if session_turn_counter is not None:
                            session_turn_counter[0] += 1
                        return ctx, session_turn_counter[0] if session_turn_counter else 0
                    except Exception as e:
                        logging.warning(f"Moss Session Error: {e}")
                        return "", session_turn_counter[0] if session_turn_counter else 0

                moss_protocol, (recent_context, session_count) = await asyncio.gather(fetch_knowledge(), fetch_session())
                MOSS_CACHE[cache_key] = (moss_protocol, recent_context, session_count)


            m_ms = (time.time() - m_start) * 1000
            # Emit telemetry including adaptive alpha and vitals severity
            await frontend_ws.send_text(json.dumps({
                "type": "moss_telemetry",
                "latency_ms": round(m_ms, 2),
                "alpha": adaptive_alpha,
                "severity": vitals_severity,
                "protocol": moss_protocol[:80] + "..." if len(moss_protocol) > 80 else moss_protocol,
                "session_turns": session_count
            }))
        except Exception as e:
            logging.error(f"Moss SDK error during query: {e}")
            await frontend_ws.send_text(json.dumps({
                "type": "moss_telemetry",
                "latency_ms": -1,
                "alpha": adaptive_alpha,
                "severity": vitals_severity,
                "protocol": "Moss unavailable — using base knowledge",
                "session_turns": session_count
            }))

    # Smart model routing based on medical keywords
    COMPLEX_KEYWORDS = ["cardiac", "arrest", "overdose", "trauma", "hemorrhage", "anaphylaxis", "stroke", "seizure", "protocol"]
    is_complex = any(kw in text.lower() for kw in COMPLEX_KEYWORDS) or len(text.split()) > 20 or vitals_severity == "CRITICAL"
    ai_model = "gemini-3.5-flash" if is_complex else "gemini-3.5-flash-lite"
    logging.info(f"Model routing: '{ai_model}' | severity={vitals_severity} | query='{text[:40]}...'")

    user_content = f"[PATIENT FILE - Allergies: {patient_allergies}]\n"
    if vitals:
        user_content += (
            f"[TELEMETRY - HR {vitals.get('hr')}, SpO2 {vitals.get('spo2')}%, "
            f"BP {vitals.get('bpSys')}/{vitals.get('bpDia')} | SEVERITY: {vitals_severity}]\n"
        )
    user_content += f"[MOSS PROTOCOL SEARCH (alpha={adaptive_alpha}, top_k={adaptive_top_k})]\n{moss_protocol}\n"
    if recent_context:
        user_content += f"[RECENT CONVERSATION HISTORY]\n{recent_context}\n"
    user_content += f"\nQuery: {text}"

    sys_prompt = SYSTEM_PROMPT_ER_DOCTOR if persona == "ER_DOCTOR" else SYSTEM_PROMPT_PARAMEDIC
    sys_prompt += f"\nCRITICAL RULE: You MUST reply EXCLUSIVELY in the language of this BCP-47 tag: {lang}. Do not use any other language!"

    full_ai_response = ""
    try:
        # Indian language path — use browser TTS, no Cartesia
        if lang.startswith("hi") or lang.startswith("te"):
            stream = await llm_client.chat.completions.create(
                messages=[{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
                model=ai_model, temperature=0.3, max_tokens=300, stream=True
            )
            first_token = True
            async for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    if first_token:
                        e2e_ms = (time.time() - req_start) * 1000
                        await frontend_ws.send_text(json.dumps({"type": "e2e_latency", "latency_ms": round(e2e_ms, 2), "model": ai_model}))
                        first_token = False
                    full_ai_response += content
                    await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": content}))
            if moss_session:
                await moss_session.add_docs([
                    DocumentInfo(id=f"ai-{int(time.time()*1000)}", text=f"AI: {full_ai_response}")
                ])
            return full_ai_response

        # English path — stream to Cartesia TTS
        stream = await llm_client.chat.completions.create(
            messages=[{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
            model=ai_model, temperature=0.3, max_tokens=300, stream=True
        )
        if not CARTESIA_API_KEY:
            logging.warning("No CARTESIA_API_KEY — returning text only")
            async for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    full_ai_response += content
                    await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": content}))
            return full_ai_response

        voice_id = "f114a467-c40a-4db8-964d-aaba89cd08fa" if persona == "ER_DOCTOR" else "a0e99841-438c-4a64-b679-ae501e7d6091"
        cartesia_context_id = f"pulse-{id(frontend_ws)}-{int(time.time()*1000)}"

        async with websockets.connect(
            f"wss://api.cartesia.ai/tts/websocket?api_key={CARTESIA_API_KEY}&cartesia_version=2024-06-10"
        ) as cartesia_ws:
            await cartesia_ws.send(json.dumps({
                "context_id": cartesia_context_id,
                "model_id": "sonic-multilingual",
                "voice": {"mode": "id", "id": voice_id},
                "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": 24000}
            }))

            async def pump_tokens():
                nonlocal full_ai_response
                sentence_buffer = ""
                first_token = True
                async for chunk in stream:
                    content = chunk.choices[0].delta.content
                    if content:
                        if first_token:
                            e2e_ms = (time.time() - req_start) * 1000
                            await frontend_ws.send_text(json.dumps({"type": "e2e_latency", "latency_ms": round(e2e_ms, 2), "model": ai_model}))
                            first_token = False
                        full_ai_response += content
                        sentence_buffer += content
                        await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": content}))
                        if any(char in content for char in [".", "?", "!", ","]):
                            await cartesia_ws.send(json.dumps({
                                "context_id": cartesia_context_id,
                                "transcript": sentence_buffer,
                                "continue": True
                            }))
                            sentence_buffer = ""
                final_chunk = sentence_buffer.strip()
                await cartesia_ws.send(json.dumps({
                    "context_id": cartesia_context_id,
                    "transcript": final_chunk if final_chunk else "",
                    "continue": False
                }))
                if moss_session:
                    await moss_session.add_docs([
                        DocumentInfo(id=f"ai-{int(time.time()*1000)}", text=f"AI: {full_ai_response}")
                    ])

            async def read_audio():
                while True:
                    try:
                        res = await asyncio.wait_for(cartesia_ws.recv(), timeout=5.0)
                        data = json.loads(res)
                        if data.get("done", False):
                            break
                        if "data" in data:
                            await frontend_ws.send_text(json.dumps({"type": "audio_chunk", "data": data["data"]}))
                    except asyncio.TimeoutError:
                        continue

            try:
                await asyncio.gather(pump_tokens(), read_audio())
            except asyncio.CancelledError:
                logging.info("Cartesia stream interrupted by user. Closing socket gracefully.")
                # Ensure the socket is cleanly closed before the context manager exits
                await cartesia_ws.close()
                raise

        return full_ai_response

    except Exception as e:
        logging.error(f"stream_ai_to_cartesia error: {e}")
        raise Exception(f"AI stream failed: {e}") from e


@app.websocket("/ws/voice")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    current_task = None
    moss_session = None
    session_turn_counter = [0]

    if moss_client:
        try:
            call_id = f"call-{id(websocket)}-{int(time.time())}"
            moss_session = await moss_client.session(index_name=call_id)
            logging.info(f"Moss session created: {call_id}")
        except Exception as e:
            logging.error(f"Failed to create Moss session: {e}")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = payload.get("type", "text")
            if msg_type == "ping":
                continue

            if msg_type == "text":
                user_text = payload.get("text", "")
                persona = payload.get("persona", "PARAMEDIC")
                vitals_snap = payload.get("vitals")
                profile_snap = payload.get("profile")
                lang_snap = payload.get("lang", "en-US")
                req_start = time.time()

                if not user_text.strip():
                    continue

                if current_task and not current_task.done():
                    current_task.cancel()

                await websocket.send_text(json.dumps({"type": "start_response"}))

                async def run_stream(
                    _text=user_text,
                    _vitals=vitals_snap,
                    _profile=profile_snap,
                    _lang=lang_snap,
                    _persona=persona,
                    _req_start=req_start,
                ):
                    try:
                        if _persona == "ER_DOCTOR" and session_turn_counter[0] > 0 and "HANDOFF" not in _text:
                            _text = f"[HANDOFF TRIGGERED] Paramedic is handing patient to trauma team. Summarize the entire ambulance case from memory and give trauma bay instructions. Original query: {_text}"

                        f_text = await asyncio.wait_for(
                            stream_ai_to_cartesia(
                                _text, websocket, _vitals, _profile, _lang,
                                moss_session, _persona, _req_start, session_turn_counter
                            ),
                            timeout=20.0
                        )
                        await websocket.send_text(json.dumps({"type": "end_response", "full_text": f_text}))
                    except asyncio.CancelledError:
                        logging.info("Stream task cancelled (user sent new query)")
                    except Exception as e:
                        logging.error(f"run_stream error: {e}")
                        await websocket.send_text(json.dumps({"type": "end_response", "full_text": ""}))

                current_task = asyncio.create_task(run_stream())

    except Exception:
        if current_task and not current_task.done():
            current_task.cancel()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
