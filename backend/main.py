import os
import json
import logging
import asyncio
import socket
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import websockets
from openai import AsyncOpenAI

# IPv4 Force fix for Windows
orig_getaddrinfo = socket.getaddrinfo
def new_getaddrinfo(*args, **kwargs):
    responses = orig_getaddrinfo(*args, **kwargs)
    return [r for r in responses if r[0] == socket.AF_INET]
socket.getaddrinfo = new_getaddrinfo

logging.basicConfig(level=logging.INFO)
load_dotenv("backend/.env")

app = FastAPI(title="Pulse Voice Backend - Final Polish")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

HIDEVS_API_KEY = os.getenv("HIDEVS_API_KEY")
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")

llm_client = AsyncOpenAI(api_key=HIDEVS_API_KEY, base_url="https://llm.hidevs.xyz/v1") if HIDEVS_API_KEY else None

SYSTEM_PROMPT = """You are Pulse, an ultra-fast, Universal Medical AI Co-Pilot. 
You possess comprehensive knowledge of all medical fields, pharmacology, and trauma protocols.

CRITICAL SAFETY GUARDRAILS (ALLERGY & VITALS CHECK):
Before you recommend or confirm ANY medication or intervention, you MUST silently read the Patient's File (Allergies/History) and the Telemetry Vitals. 
If the paramedic suggests a drug that the patient is ALLERGIC to, you must instantly reply with a critical warning stating the patient is allergic and suggest a safe alternative.
If the vitals indicate a crashing patient (e.g., Cardiac Arrest or Shock), interrupt their query to address the life-threatening vitals immediately!

Guidelines:
1. For MAJOR emergencies, use strict Closed-Loop Communication (state the drug, dose, route).
2. Answer EVERYTHING asked by the user. Do not refuse health questions.


4. NO MARKDOWN: Do NOT use asterisks or special characters. Use plain text only."""

class EPCRRequest(BaseModel):
    transcript: str
    patient: dict

@app.get("/health")
async def health_check():
    health_status = {"status": "ok", "service": "pulse-backend", "llm": "untested"}
    if llm_client:
        try:
            # Ping llm to verify external dependency is alive
            await llm_client.models.list()
            health_status["llm"] = "ok"
        except Exception as e:
            health_status["status"] = "degraded"
            health_status["llm"] = "down"
    else:
        health_status["status"] = "degraded"
        health_status["llm"] = "missing_key"
    return health_status

@app.post("/generate_epcr")
async def generate_epcr(request: EPCRRequest):
    if not llm_client: return {"error": "HIDEVS_API_KEY missing."}
    pat = request.patient
    prompt = f"""Generate an official EMS ePCR (Electronic Patient Care Report) based on this audio transcript.
{request.transcript}"""
    try:
        completion = await llm_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="gemini-3.6-flash",
        )
        return {"epcr": completion.choices[0].message.content}
    except Exception as e:
        return {"error": str(e)}

async def stream_ai_to_cartesia(text: str, frontend_ws: WebSocket, vitals: dict = None, profile: dict = None, lang: str = "en-US") -> str:
    import time
    start_time = time.time()
    
    # 1. Deterministic Rule-Based Allergy Check
    from services.allergy_checker import check_allergies
    patient_allergies = profile.get('allergies', 'none') if profile else 'none'
    allergy_warning = check_allergies(text, patient_allergies)
    
    if allergy_warning:
        # Short-circuit the LLM and return the deterministic warning immediately
        latency = time.time() - start_time
        logging.warning(f"Allergy Guardrail Triggered in {latency:.3f}s: {allergy_warning}")
        await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": allergy_warning}))
        return allergy_warning

    # 2. Moss Semantic Protocol Search
    from services.moss_client import query_moss
    moss_result = await query_moss(text)
    moss_protocol = moss_result["protocol"]
    moss_latency = moss_result["latency_ms"]
    logging.info(f"Moss Retrieval Latency: {moss_latency:.2f}ms")

    # 3. LLM / Moss Context Injection
    user_content = f"[PATIENT FILE - Allergies: {patient_allergies}]\n"
    if vitals:
        user_content += f"[TELEMETRY - HR {vitals.get('hr')}, SpO2 {vitals.get('spo2')}]\n"
    user_content += f"[MOSS PROTOCOL SEARCH] {moss_protocol}\n"
    user_content += f"\nParamedic Query: {text}"

    forced_system_prompt = SYSTEM_PROMPT
    if lang != "en-US":
        forced_system_prompt += f"\n\n!!! CRITICAL LANGUAGE OVERRIDE !!!\nYou must reply EXCLUSIVELY in the language of this BCP-47 tag: {lang}. Do NOT use English under any circumstances.\nCRITICAL: You are a medical expert. Use professional medical terminology in {lang}. Answer the query directly and completely (1 to 3 sentences).\nIf the user asks an open-ended question (like 'what injection?'), clarify what symptoms you are treating first."

    if not llm_client:
        await frontend_ws.send_text(json.dumps({"type": "error", "content": "HIDEVS_API_KEY is missing."}))
        return ""

    full_ai_response = ""
    try:
        patient_allergies = profile.get('allergies', 'none') if profile else 'none'
        allergy_warning = check_allergies(text, patient_allergies)
        
        if allergy_warning:
            # Short-circuit the LLM and return the deterministic warning immediately
            latency = time.time() - start_time
            logging.warning(f"Allergy Guardrail Triggered in {latency:.3f}s: {allergy_warning}")
            await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": allergy_warning}))
            return allergy_warning

        forced_system_prompt = SYSTEM_PROMPT
        if lang != "en-US":
            forced_system_prompt += f"\n\n!!! CRITICAL LANGUAGE OVERRIDE !!!\nYou must reply EXCLUSIVELY in the language of this BCP-47 tag: {lang}. Do NOT use English under any circumstances.\nCRITICAL: You are a medical expert. Use professional medical terminology in {lang}. Answer the query directly and completely (1 to 3 sentences).\nIf the user asks an open-ended question (like 'what injection?'), clarify what symptoms you are treating first."

        if lang.startswith("hi") or lang.startswith("te"):
            async def pump_tokens_only():
                nonlocal full_ai_response
                try:
                    stream = await llm_client.chat.completions.create(
                        messages=[{"role": "system", "content": forced_system_prompt}, {"role": "user", "content": user_content}],
                        model="gemini-3.6-flash", temperature=0.3, max_tokens=500, stream=True
                    )
                    async for chunk in stream:
                        content = chunk.choices[0].delta.content
                        if content:
                            full_ai_response += content
                            await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": content}))
                except asyncio.CancelledError:
                    raise
            await pump_tokens_only()
            return full_ai_response

        # For supported languages, continue with Cartesia:
        stream = await llm_client.chat.completions.create(
            messages=[{"role": "system", "content": forced_system_prompt}, {"role": "user", "content": user_content}],
            model="gemini-3.6-flash", temperature=0.3, max_tokens=500, stream=True
        )

        if not CARTESIA_API_KEY:
            await frontend_ws.send_text(json.dumps({"type": "error", "content": "CARTESIA_API_KEY is missing."}))
            return ""

        cartesia_ws_url = f"wss://api.cartesia.ai/tts/websocket?api_key={CARTESIA_API_KEY}&cartesia_version=2024-06-10"
        async with websockets.connect(cartesia_ws_url) as cartesia_ws:
            await cartesia_ws.send(json.dumps({
                "context_id": "pulse-stream",
                "model_id": "sonic-multilingual",
                "voice": {"mode": "id", "id": "a0e99841-438c-4a64-b679-ae501e7d6091"},
                "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": 24000}
            }))

            async def pump_tokens():
                nonlocal full_ai_response
                sentence_buffer = ""
                try:
                    async for chunk in stream:
                        content = chunk.choices[0].delta.content
                        if content:
                            full_ai_response += content
                            await frontend_ws.send_text(json.dumps({"type": "text_chunk", "content": content}))
                            sentence_buffer += content
                            if any(char in content for char in [".", "?", "!", ","]):
                                await cartesia_ws.send(json.dumps({"context_id": "pulse-stream", "transcript": sentence_buffer, "continue": True}))
                                sentence_buffer = ""
                    if sentence_buffer.strip():
                        await cartesia_ws.send(json.dumps({"context_id": "pulse-stream", "transcript": sentence_buffer, "continue": False}))
                    else:
                        await cartesia_ws.send(json.dumps({"context_id": "pulse-stream", "transcript": "", "continue": False}))
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logging.error(f"Error pumping tokens: {e}")

            async def read_audio():
                try:
                    while True:
                        response = await asyncio.wait_for(cartesia_ws.recv(), timeout=5.0)
                        data = json.loads(response)
                        if not data.get("done", False):
                            if "data" in data:
                                await frontend_ws.send_text(json.dumps({"type": "audio_chunk", "data": data["data"]}))
                        else:
                            break
                except asyncio.TimeoutError:
                    logging.warning("Cartesia stream timed out.")
                except websockets.exceptions.ConnectionClosed:
                    logging.warning("Cartesia connection closed early.")
                except asyncio.CancelledError:
                    raise

            await asyncio.gather(pump_tokens(), read_audio())
        
        return full_ai_response
        
    except asyncio.CancelledError:
        logging.info("Stream explicitly cancelled.")
        raise
    except Exception as e:
        raise Exception(f"llm API Error: {str(e)}")

@app.websocket("/ws/voice")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    current_task = None
    try:
        while True:
            data = await websocket.receive_text()
            try: payload = json.loads(data)
            except: continue
            
            msg_type = payload.get("type", "text")
            if msg_type == "ping": continue
            if msg_type == "interrupt":
                if current_task and not current_task.done(): current_task.cancel()
                continue
            
            if msg_type == "text":
                user_text = payload.get("text", "")
                vitals = payload.get("vitals", None)
                profile = payload.get("profile", None)
                lang = payload.get("lang", "en-US")
                
                if current_task and not current_task.done():
                    current_task.cancel()
                    try: await current_task
                    except asyncio.CancelledError: pass
                
                await websocket.send_text(json.dumps({"type": "start_response"}))
                
                async def run_stream():
                    try:
                        final_text = await asyncio.wait_for(stream_ai_to_cartesia(user_text, websocket, vitals, profile, lang), timeout=15.0)
                        if final_text:
                            await websocket.send_text(json.dumps({"type": "end_response", "full_text": final_text}))
                        else:
                            await websocket.send_text(json.dumps({"type": "end_response"}))
                    except asyncio.CancelledError:
                        logging.info("Stream task cleanly aborted.")
                    except Exception as e:
                        await websocket.send_text(json.dumps({"type": "error", "content": str(e)}))
                        await websocket.send_text(json.dumps({"type": "end_response"}))
                        
                current_task = asyncio.create_task(run_stream())
            
    except WebSocketDisconnect:
        if current_task and not current_task.done(): current_task.cancel()
    except Exception as e:
        logging.error(f"WebSocket fatal error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)




