import time
import re

# Mock database representing a Moss semantic index of EMS Protocols
PROTOCOLS = {
    "chest pain": "PROTOCOL AHA-202: Suspected Myocardial Infarction. Administer 324mg Aspirin chewed, 0.4mg Nitroglycerin sublingual (if SBP > 90).",
    "low blood pressure": "PROTOCOL EMS-105: Hypotension/Shock. Administer 500mL Normal Saline bolus. Reassess BP.",
    "seizure": "PROTOCOL EMS-304: Active Seizure. Protect airway. Administer 5mg Midazolam IM or 2mg IV.",
    "allergic": "PROTOCOL EMS-401: Anaphylaxis. Administer 0.3mg Epinephrine (1:1000) IM.",
    "shortness of breath": "PROTOCOL EMS-502: Respiratory Distress. Administer Oxygen to maintain SpO2 > 94%. Consider Albuterol 2.5mg nebulized."
}

async def query_moss(query: str) -> dict:
    """
    Simulates a sub-10ms semantic search against the Moss runtime.
    In production, this connects to the local Moss instance or remote Moss REST API.
    """
    start_time = time.time()
    
    # Simulate semantic extraction/matching
    query_lower = query.lower()
    matched_protocol = None
    
    # Naive keyword matching to simulate semantic search for the prototype
    for key, protocol in PROTOCOLS.items():
        if key in query_lower:
            matched_protocol = protocol
            break
            
    latency_ms = (time.time() - start_time) * 1000
    
    return {
        "protocol": matched_protocol if matched_protocol else "No specific protocol matched.",
        "latency_ms": latency_ms
    }
