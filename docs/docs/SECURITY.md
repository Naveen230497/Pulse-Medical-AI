# Security & HIPAA Compliance

## Overview
Pulse is designed with enterprise-grade security protocols to handle Protected Health Information (PHI) in compliance with standard medical regulations (e.g., HIPAA).

## Data Encryption
1. **In-Transit:** All WebSocket connections (`wss://`) and REST API endpoints (`https://`) are secured using TLS 1.3.
2. **At-Rest:** Pulse does not persistently store any voice transcripts or PHI on local disks. Data is held in memory purely for the duration of the context window.

## Zero-Retention Policy
- The Moss Retrieval Layer acts as a stateless proxy. It fetches the EHR data required for the LLM context and immediately purges it from memory after inference.
- Groq Cloud inference is configured with zero-data-retention agreements for medical deployments, ensuring no PHI is used for model training.

## Access Control
- All endpoints require Bearer Token Authentication (JWT).
- WebSocket connections are established only after a successful handshake containing an encrypted OAuth2 token.
