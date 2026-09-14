# Use official Python 3.12 slim image
FROM python:3.12-slim

# Set the working directory
WORKDIR /app

# Prevent Python from writing pyc files and keep stdout unbuffered
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies (if any are needed later for audio processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend code
COPY . .

# Expose the port Cloud Run expects
EXPOSE 8080

# Start the FastAPI server on port 8080 (Required for Cloud Run)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
