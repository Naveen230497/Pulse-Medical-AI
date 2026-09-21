# Moss Integration Deep-Dive

> How Pulse achieves sub-5ms medical protocol retrieval using the Moss Python SDK

---

## Migration Story: CLI → Python SDK (178x Speedup)

### Before (v1): Moss CLI Subprocess
```python
# OLD: 500ms per query (subprocess overhead)
proc = await asyncio.create_subprocess_shell(
    f'moss query pulse-protocols "{user_text}" --cloud --json --top-k 1',
    stdout=asyncio.subprocess.PIPE
)
stdout, _ = await proc.communicate()
```

### After (v2): Moss Python SDK (In-Process)
```python
# NEW: 2-5ms per query (in-memory vector search)
from moss import MossClient, QueryOptions

# Load once at startup — index lives in RAM
moss_client = MossClient(PROJECT_ID, PROJECT_KEY)
await moss_client.load_index("pulse-protocols")

# Query in-process — no subprocess, no network
results = await moss_client.query(
    "pulse-protocols", 
    "chest pain with low blood pressure",
    QueryOptions(top_k=2, alpha=0.7)  # Hybrid Search
)
```

**Result: 500ms → 2.8ms = 178x faster**

---

## Feature 1: Hybrid Search (α = 0.7)

### Why Hybrid?
Pure semantic search misses exact drug names. Pure keyword search misses medical concepts.

| Query | Semantic Only | Keyword Only | Hybrid (α=0.7) |
|-------|--------------|-------------|-----------------|
| "chest pain" | ✅ Matches "Myocardial Infarction" | ❌ No exact match | ✅ Best of both |
| "give aspirin" | ❌ Matches irrelevant "pain management" | ✅ Exact "aspirin" match | ✅ Best of both |
| "patient is crashing" | ✅ Matches "Cardiac Arrest" | ❌ No exact match | ✅ Best of both |

### Implementation
```python
results = await moss_client.query(
    "pulse-protocols",
    user_query,
    QueryOptions(
        top_k=2,      # Return top 2 matches
        alpha=0.7      # 70% semantic, 30% keyword
    )
)
```

We chose `α=0.7` after testing because medical queries tend to be conceptual ("the patient is crashing") rather than keyword-based. The 30% keyword component catches exact drug names like "Epinephrine" or "Amiodarone."

---

## Feature 2: Live Session Memory

### The Problem
Traditional RAG is stateless. If a paramedic says "give epinephrine" and then 2 minutes later says "what was the last drug I gave?", the LLM has no memory.

### The Solution: Moss SessionIndex
```python
# Create a session per WebSocket connection
call_id = f"call-{id(websocket)}"
moss_session = await moss_client.session(index_name=call_id)

# After every turn, index both the query and the AI response
await moss_session.add_docs([
    DocumentInfo(id=f"turn-{timestamp}", text=f"Paramedic: {user_text}")
])
await moss_session.add_docs([
    DocumentInfo(id=f"ai-{timestamp}", text=f"AI: {ai_response}")
])

# Query the session for recent context
recent = await moss_session.query(user_text, QueryOptions(top_k=2))
```

### What This Enables
- **Context recall:** "What protocol did you recommend earlier?" → Moss finds it in <3ms
- **Contradiction detection:** If the paramedic says "no allergies" then later says "allergic to Penicillin", the session has both statements for the LLM to reconcile
- **ePCR generation:** The entire conversation is indexed and searchable for report generation

---

## Feature 3: Cross-Agent Handoff

### The Scenario
1. **Paramedic (Agent A)** talks to Pulse during the ambulance ride for 5 minutes
2. All 10+ conversation turns are indexed in the Moss SessionIndex
3. Paramedic clicks **"Handoff to ER"** on the dashboard
4. **ER Doctor (Agent B)** receives a completely different system prompt but reads THE SAME Moss session
5. ER Doctor says: *"I see from the ambulance report that the patient received Aspirin and has a Penicillin allergy. Prepare Trauma Bay 1."*

### Why This Is Unique
- **No massive prompt re-injection:** Traditional handoff requires passing the entire conversation as text (thousands of tokens). Moss retrieves only the relevant turns via semantic search.
- **Zero context loss:** The ER Doctor has access to every indexed turn from the ambulance ride.
- **Different voices:** The Paramedic agent uses a calm male voice. The ER Doctor uses an authoritative different voice via Cartesia.

---

## Feature 4: Real-Time Telemetry

Every Moss query emits a WebSocket telemetry event to the frontend:

```python
await frontend_ws.send_text(json.dumps({
    "type": "moss_telemetry",
    "latency_ms": 2.84,
    "protocol": "PROTOCOL AHA-202: Suspected Myocardial Infarction",
    "session_turns": 5
}))
```

The frontend renders this as a glowing green panel showing:
- ⚡ **LATENCY:** `2.8ms`
- 📚 **MATCHED PROTOCOL:** The exact protocol name
- 🧠 **SESSION TURNS:** Number of indexed conversation turns

This gives judges **visual proof** that Moss is running in real-time, not just called once at startup.

---

## Protocol Database

We indexed 20 comprehensive EMS protocols covering:

| Category | Protocols |
|----------|----------|
| Cardiac | MI (AHA-202), VF/pVT (AHA-301), Asystole/PEA (AHA-302) |
| Trauma | Major Trauma (PHTLS-100), Burns (ABA-201), Crush Injury, Tension Pneumothorax |
| Neurological | Seizure/Status Epilepticus, Stroke (AHA-501) |
| Toxicology | Opioid Overdose, Organophosphate Poisoning |
| Endocrine | Hypoglycemia, Hyperglycemia/DKA |
| Respiratory | Acute Respiratory Distress |
| Allergic | Anaphylaxis (AAAI-100) |
| Pediatric | Pediatric Croup |
| Obstetric | Postpartum Hemorrhage |
| Environmental | Heat Stroke, Hypothermia |

Each protocol includes: title, full step-by-step instructions, drug dosages, contraindications, and metadata tags for filtered search.

---

## Latency Comparison

| Method | Avg Latency | Token Cost | Network Required |
|--------|------------|-----------|-----------------|
| Moss CLI (`subprocess`) | 500ms | 0 | Yes (cloud API) |
| **Moss Python SDK (in-process)** | **2.8ms** | **0** | **No (RAM)** |
| Pinecone API | 150ms | 0 | Yes |
| ChromaDB (local) | 20ms | 0 | No |
| LLM-only (no RAG) | 0ms | +500 tokens/query | No |

**Moss Python SDK is the fastest option that supports hybrid search, sessions, and cloud sync.**
