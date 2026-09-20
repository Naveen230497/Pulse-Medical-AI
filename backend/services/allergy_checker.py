import re
import difflib

# Comprehensive map of drug classes to their generic and common brand names
DRUG_CLASSES = {
    "penicillin": ["amoxicillin", "ampicillin", "penicillin", "augmentin", "amoxil"],
    "nsaid": ["ibuprofen", "advil", "motrin", "naproxen", "aleve", "aspirin"],
    "opiate": ["morphine", "fentanyl", "oxycodone", "hydrocodone", "vicodin", "percocet"],
    "sulfa": ["bactrim", "septra", "sulfamethoxazole"],
}

# Reverse mapping for quick lookup: specific drug -> its class
DRUG_TO_CLASS = {}
for drug_class, drugs in DRUG_CLASSES.items():
    for d in drugs:
        DRUG_TO_CLASS[d] = drug_class

ALL_KNOWN_DRUGS = list(DRUG_TO_CLASS.keys()) + list(DRUG_CLASSES.keys())

def get_all_related_drugs(allergy_str: str) -> set:
    """
    Returns a set of all specific drugs a patient might be allergic to.
    Handles both forward (class -> drugs) and reverse (drug -> class -> all drugs) lookups.
    """
    if not allergy_str:
        return set()
    
    allergies = [a.strip().lower() for a in allergy_str.split(",")]
    related_drugs = set(allergies)
    
    for a in allergies:
        # Forward lookup
        if a in DRUG_CLASSES:
            related_drugs.update(DRUG_CLASSES[a])
        # Reverse lookup (if they list a specific drug, block the whole class)
        if a in DRUG_TO_CLASS:
            parent_class = DRUG_TO_CLASS[a]
            related_drugs.update(DRUG_CLASSES[parent_class])
            related_drugs.add(parent_class)
            
    return related_drugs

def check_allergies(transcript: str, patient_allergies: str) -> str:
    """
    Deterministic rule-based check with reverse-lookup and fuzzy phonetic matching.
    """
    if not patient_allergies or patient_allergies.lower() == "none":
        return None
        
    related_drugs = get_all_related_drugs(patient_allergies)
    transcript_words = re.findall(r'\b\w+\b', transcript.lower())
    
    for word in transcript_words:
        # 1. Exact Match Check
        if word in related_drugs:
            return f"CRITICAL WARNING: Protocol stopped. Patient has a documented allergy conflict with {word.upper()}. DO NOT ADMINISTER."
            
        # 2. Fuzzy Match Check (catch STT errors like "amoxacilin" instead of "amoxicillin")
        # Only fuzzy match longer words to avoid false positives on short functional words
        if len(word) > 4:
            matches = difflib.get_close_matches(word, related_drugs, n=1, cutoff=0.8)
            if matches:
                return f"CRITICAL WARNING: Protocol stopped. STT detected '{word}', matching known allergy conflict {matches[0].upper()}. DO NOT ADMINISTER."
            
    return None
