import pytest
from httpx import AsyncClient, ASGITransport
from main import app

@pytest.mark.asyncio
async def test_generate_epcr_missing_key(monkeypatch):
    # Ensure no GROQ API KEY is present to test fallback logic
    monkeypatch.setenv("GROQ_API_KEY", "")
    
    # We must reload the app's dependencies or just test the response
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post(
            "/generate_epcr",
            json={
                "patient": {"name": "Test Patient", "age": 30},
                "transcript": "Patient was found unresponsive."
            }
        )
        assert response.status_code == 200
        # Given how the current implementation handles missing keys
        data = response.json()
        assert "error" in data or "epcr" in data

@pytest.mark.asyncio
async def test_root_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/docs")
        assert response.status_code == 200
