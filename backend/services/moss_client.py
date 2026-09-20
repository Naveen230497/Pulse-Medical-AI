import asyncio
import json
import os
import time
import logging

async def query_moss(query: str) -> dict:
    """
    Sub-10ms semantic search against the Moss cloud API.
    """
    start_time = time.time()
    
    project_id = os.environ.get("MOSS_PROJECT_ID")
    project_key = os.environ.get("MOSS_PROJECT_KEY")
    
    if not project_id or not project_key:
        logging.warning("MOSS credentials missing, falling back to basic search.")
        return {"protocol": "No protocol found (Missing Credentials)", "latency_ms": 0}
    
    # Using --cloud to hit the ultra-fast semantic index directly
    cmd = f'moss query pulse-protocols "{query}" --cloud --json --top-k 1'
    
    env = os.environ.copy()
    env["MOSS_PROJECT_ID"] = project_id
    env["MOSS_PROJECT_KEY"] = project_key
    
    try:
        process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env
        )
        
        stdout, stderr = await process.communicate()
        latency_ms = (time.time() - start_time) * 1000
        
        matched_protocol = "No specific protocol matched."
        if process.returncode == 0 and stdout:
            try:
                result = json.loads(stdout.decode('utf-8'))
                docs = result.get("docs", [])
                if docs:
                    matched_protocol = docs[0].get("text", matched_protocol)
            except Exception as e:
                logging.error(f"Error parsing Moss JSON: {e}")
        else:
            logging.error(f"Moss query failed: {stderr.decode('utf-8')}")
            
        return {
            "protocol": matched_protocol,
            "latency_ms": latency_ms
        }
    except Exception as e:
        logging.error(f"Moss execution error: {e}")
        return {"protocol": "Error accessing protocols", "latency_ms": 0}
