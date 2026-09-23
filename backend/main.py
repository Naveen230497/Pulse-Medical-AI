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
from services.allergy_checker import check_allergies  # FIX BUG-08: top-level import

# IPv4-only patch for Cloud Run
orig_getaddrinfo = socket.getaddrinfo
def new_getaddrinfo(*args, **kwargs):
    responses = orig_getaddrinfo(*args, **kwargs)
    return [r for r in responses if r[0] == socket.AF_INET]
socket.getaddrinfo = new_getaddrinfo

logging.basicConfig(level=logging.INFO)
load_dotenv()  # FIX BUG-05: auto-detect .env in CWD, works in Docker too

# FIX WEAK-07: use modern lifespan instead of deprecated @app.on_event
moss_client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global moss_client
    MOSS_PROJECT_ID = os.getenv("MOSS_PROJECT_ID")
    MOSS_PROJECT_KEY = os.getenv("MOSS_PROJECT_KEY")
    if MOSS_PROJECT_ID and MOSS_PROJECT_KEY:
        try:
            moss_client = MossClient(MOSS_PROJECT_ID, MOSS_PROJECT_KEY)
            await moss_client.load_index("pulse-protocols")
            logging.info("âœ… Moss index 'pulse-protocols' loaded successfully.")
        except Exception as e:
            logging.error(f"âŒ Failed to initialize Moss Client: {e}")
            moss_client = None
    else:
        logging.warning("âš ï¸ MOSS_PROJECT_ID or MOSS_PROJECT_KEY not set. Moss disabled.")
    yield
    # Shutdown: nothing to clean up for now

app = FastAPI(title="Pulse Voice Backend v2.0 - Bug-Fixed", lifespan=lifespan)

# FIX WEAK-03: Restrict origins to the known frontend. Keep * for hackathon judges.
# For production, replace "*" with: "https://pulse-frontend-297907968720.us-central1.run.app"
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

class EPCRRequest(BaseModel):
    transcript: str
    patient: dict

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "llm": "configured" if llm_client else "missing",
        "moss": "loaded" if moss_client else "unloaded"
    }

@app.post("/generate_epcr")
async def generate_epcr(request: EPCRRequest):
    if not llm_client:
        return {"error": "HIDEVS_API_KEY missing."}
    # FIX WEAK-04: log all ePCR calls for monitoring
    logging.info(f"ePCR generation requested for patient: {request.patient.get('name', 'Unknown')}")
    prompt = (
        f"Generate an official EMS ePCR (Electronic Patient Care Report) for:\n"
        f"Patient: {request.patient}\n\n"
        f"Incident Transcript:\n{request.transcript}\n\n"
        f"Format it with sections: Incident Summary, Vitals, Interventions, Assessment, Disposition."
    )
    try:
        completion = await llm_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="gemini-3.5-flash"
        )
        return {"report": completion.choices[0].message.content}
    except Exception as e:
        logging.error(f"ePCR generation error: {e}")
        return {"error": str(e)}


async def stream_ai_to_cartesia(
    text: str,
    frontend_ws: WebSocket,
    vitals: dict = None,
    profile: dict = None,
    lang: str = "en-US",
    moss_session=None,
    persona: str = "PARAMEDIC",
    req_start: float = 0.0,
    session_turn_counter: list = None,  # FIX BUG-06: real turn counter passed by reference
) -> str:
    # FIX BUG-07: removed dead `start_time = time.time()` variable

    patient_allergies = profile.get('allergies', 'none') if profile else 'none'
    allergy_warning = check_allergies(text, patient_allergies)

    if allergy_warning:
        # FIX BUG-04: emit Moss telemetry even on guardrail path so the panel isn't blank
        await frontend_ws.send_text(json.dumps({
            "type": "moss_telemetry",
            "latency_ms": 0.0,
            "protocol": "âš ï¸ GUARDRAIL TRIGGERED â€” Allergy conflict detected...",
            "session_turns": session_turn_counter[0] if session_turn_counter else 0
        }))
        await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": allergy_warning}))
        e2e_ms = (time.time() - req_start) * 1000
        await frontend_ws.send_text(json.dumps({"type": "e2e_latency", "latency_ms": e2e_ms, "model": "guardrail-0-tokens"}))
        return allergy_warning

    moss_protocol = "No specific protocol matched."
    recent_context = ""
    session_count = session_turn_counter[0] if session_turn_counter else 0

    if moss_client:
        m_start = time.time()
        try:
            # FIX BUG-01: replaced bare `except: pass` with proper error logging
            k_res = await moss_client.query("pulse-protocols", text, QueryOptions(top_k=2, alpha=0.7))
            if k_res.docs:
                moss_protocol = "\n".join([f"- {d.text}" for d in k_res.docs])

            if moss_session:
                await moss_session.add_docs([
                    DocumentInfo(id=f"user-{int(time.time()*1000)}", text=f"Paramedic: {text}")
                ])
                s_res = await moss_session.query(text, QueryOptions(top_k=3))
                if s_res.docs:
                    recent_context = "\n".join([f"- {d.text}" for d in s_res.docs])
                # FIX BUG-06: increment the real session counter
                if session_turn_counter is not None:
                    session_turn_counter[0] += 1
                session_count = session_turn_counter[0] if session_turn_counter else 0

            m_ms = (time.time() - m_start) * 1000
            await frontend_ws.send_text(json.dumps({
                "type": "moss_telemetry",
                "latency_ms": m_ms,
                "protocol": moss_protocol[:60] + "...",
                "session_turns": session_count
            }))
        except Exception as e:
            # FIX BUG-01: log the actual error instead of silently ignoring it
            logging.error(f"Moss SDK error during query: {e}")
            await frontend_ws.send_text(json.dumps({
                "type": "moss_telemetry",
                "latency_ms": -1,
                "protocol": "Moss unavailable â€” using base knowledge",
                "session_turns": session_count
            }))

    # FIX WEAK-09: smarter model routing based on medical keywords, not just word count
    COMPLEX_KEYWORDS = ["cardiac", "arrest", "overdose", "trauma", "hemorrhage", "anaphylaxis", "stroke", "seizure", "protocol"]
    is_complex = any(kw in text.lower() for kw in COMPLEX_KEYWORDS) or len(text.split()) > 20
    ai_model = "gemini-3.5-flash" if is_complex else "gemini-3.5-flash-lite"
    logging.info(f"Model routing: '{ai_model}' for query: '{text[:40]}...'")

    user_content = f"[PATIENT FILE - Allergies: {patient_allergies}]\n"
    if vitals:
        user_content += f"[TELEMETRY - HR {vitals.get('hr')}, SpO2 {vitals.get('spo2')}, BP {vitals.get('bpSys')}/{vitals.get('bpDia')}]\n"
    user_content += f"[MOSS PROTOCOL SEARCH]\n{moss_protocol}\n"
    if recent_context:
        user_content += f"[RECENT CONVERSATION HISTORY]\n{recent_context}\n"
    user_content += f"\nQuery: {text}"

    sys_prompt = SYSTEM_PROMPT_ER_DOCTOR if persona == "ER_DOCTOR" else SYSTEM_PROMPT_PARAMEDIC
    sys_prompt += f"\nCRITICAL RULE: You MUST reply EXCLUSIVELY in the language of this BCP-47 tag: {lang}. Do not use any other language!"

    full_ai_response = ""
    try:
        # Indian language path â€” use browser TTS, no Cartesia
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
                        await frontend_ws.send_text(json.dumps({"type": "e2e_latency", "latency_ms": e2e_ms, "model": ai_model}))
                        first_token = False
                    full_ai_response += content
                    await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": content}))
            if moss_session:
                await moss_session.add_docs([
                    DocumentInfo(id=f"ai-{int(time.time()*1000)}", text=f"AI: {full_ai_response}")
                ])
            return full_ai_response

        # English path â€” stream to Cartesia TTS
        stream = await llm_client.chat.completions.create(
            messages=[{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_content}],
            model=ai_model, temperature=0.3, max_tokens=300, stream=True
        )
        if not CARTESIA_API_KEY:
            logging.warning("No CARTESIA_API_KEY â€” returning text only")
            return ""

        voice_id = "f114a467-c40a-4db8-964d-aaba89cd08fa" if persona == "ER_DOCTOR" else "a0e99841-438c-4a64-b679-ae501e7d6091"
        # FIX BUG-03: unique context_id per request to prevent multi-user audio collision
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
                            await frontend_ws.send_text(json.dumps({"type": "e2e_latency", "latency_ms": e2e_ms, "model": ai_model}))
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
                # Flush remaining buffer
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
                    res = await asyncio.wait_for(cartesia_ws.recv(), timeout=5.0)
                    data = json.loads(res)
                    if data.get("done", False):
                        break
                    if "data" in data:
                        await frontend_ws.send_text(json.dumps({"type": "audio_chunk", "data": data["data"]}))

            await asyncio.gather(pump_tokens(), read_audio())

        return full_ai_response

    except Exception as e:
        # FIX BUG-09: use `raise ... from e` to preserve the original stack trace
        logging.error(f"stream_ai_to_cartesia error: {e}")
        raise Exception(f"AI stream failed: {e}") from e


@app.websocket("/ws/voice")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    current_task = None
    moss_session = None
    # FIX BUG-06: use a mutable list so the counter can be incremented inside nested async functions
    session_turn_counter = [0]

    if moss_client:
        try:
            call_id = f"call-{id(websocket)}-{int(time.time())}"
            moss_session = await moss_client.session(index_name=call_id)
            logging.info(f"Moss session created: {call_id}")
        except Exception as e:
            # FIX BUG-01: log Moss session creation errors
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
                # FIX BUG-02: capture all loop variables as local copies to prevent stale closure
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

                # FIX BUG-02: pass all captured values as default arguments to avoid closure capture bug
                async def run_stream(
                    _text=user_text,
                    _vitals=vitals_snap,
                    _profile=profile_snap,
                    _lang=lang_snap,
                    _persona=persona,
                    _req_start=req_start,
                ):
                    try:
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
        # Connection closed â€” cleanup gracefully
        if current_task and not current_task.done():
            current_task.cancel()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

