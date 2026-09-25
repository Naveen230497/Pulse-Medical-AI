// Offline Protocol Cache Utility
// Option 1: Dead Reckoning Offline Mode
// Fetches and caches EMS protocols from the backend into localStorage.
// When the backend is unreachable, performs local keyword search.

const CACHE_KEY = "pulse_offline_protocols_v3";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface Protocol {
  id: string;
  text: string;
  metadata?: { topic?: string; keywords?: string };
}

export interface OfflineSearchResult {
  protocol: Protocol;
  score: number;
}

/** Fetches protocols from backend and stores in localStorage. */
export async function prefetchAndCacheProtocols(backendHost: string): Promise<void> {
  try {
    const protocol = window.location.protocol;
    const res = await fetch(`${protocol}//${backendHost}/offline/protocols`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const entry = {
      protocols: data.protocols as Protocol[],
      cachedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    console.log(`[Pulse Offline] Cached ${entry.protocols.length} protocols.`);
  } catch (e) {
    console.warn("[Pulse Offline] Could not prefetch protocols:", e);
  }
}

/** Loads cached protocols from localStorage. Returns null if stale or absent. */
export function loadCachedProtocols(): Protocol[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;
    return entry.protocols as Protocol[];
  } catch {
    return null;
  }
}

/** Deterministic keyword search against cached protocols. */
export function offlineSearch(query: string, protocols: Protocol[]): OfflineSearchResult[] {
  const words = query.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);

  const scored: OfflineSearchResult[] = protocols.map((p) => {
    const haystack = `${p.text} ${p.metadata?.keywords ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (haystack.includes(w)) score += w.length > 4 ? 3 : 1; // Longer word hits score higher
    }
    return { protocol: p, score };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2); // Top-2, matching Moss top_k
}

/** Inline allergy guardrail for offline mode (mirrors backend logic). */
const DRUG_CLASSES: Record<string, string[]> = {
  penicillin: ["amoxicillin", "ampicillin", "penicillin", "augmentin", "dicloxacillin"],
  cephalosporin: ["cephalexin", "cefazolin", "ceftriaxone", "cefdinir", "rocephin"],
  nsaid: ["ibuprofen", "advil", "naproxen", "aspirin", "ketorolac", "toradol"],
  opiate: ["morphine", "fentanyl", "oxycodone", "hydrocodone", "codeine", "tramadol"],
  sulfa: ["bactrim", "septra", "sulfamethoxazole"],
  benzodiazepine: ["diazepam", "valium", "lorazepam", "ativan", "midazolam", "versed"],
  anticoagulant: ["warfarin", "heparin", "enoxaparin", "rivaroxaban", "apixaban"],
  local_anesthetic: ["lidocaine", "bupivacaine", "benzocaine", "tetracaine"],
};

export function offlineAllergyCheck(transcript: string, allergies: string): string | null {
  if (!allergies || allergies.toLowerCase() === "none") return null;

  const allergyList = allergies.toLowerCase().split(",").map((a) => a.trim());
  const relatedDrugs = new Set<string>(allergyList);

  for (const allergy of allergyList) {
    if (DRUG_CLASSES[allergy]) {
      DRUG_CLASSES[allergy].forEach((d) => relatedDrugs.add(d));
    }
    for (const [cls, drugs] of Object.entries(DRUG_CLASSES)) {
      if (drugs.includes(allergy)) {
        relatedDrugs.add(cls);
        drugs.forEach((d) => relatedDrugs.add(d));
      }
    }
  }

  const words = transcript.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/);
  for (const word of words) {
    if (relatedDrugs.has(word)) {
      return `🚨 OFFLINE GUARDRAIL: ALLERGY ALERT. Do not administer ${word.toUpperCase()}. Check for safe alternatives.`;
    }
  }
  return null;
}
