import re
import difflib

# FIX WEAK-10: Expanded from 4 to 12 major drug families covering real EMS scenarios
DRUG_CLASSES = {
    "penicillin": ["amoxicillin", "ampicillin", "penicillin", "augmentin", "amoxil", "dicloxacillin", "nafcillin", "oxacillin", "piperacillin"],
    "cephalosporin": ["cephalexin", "cefazolin", "ceftriaxone", "cefdinir", "cefuroxime", "cephalosporin", "keflex", "ancef", "rocephin"],
    "nsaid": ["ibuprofen", "advil", "motrin", "naproxen", "aleve", "aspirin", "ketorolac", "toradol", "meloxicam", "celecoxib", "indomethacin"],
    "opiate": ["morphine", "fentanyl", "oxycodone", "hydrocodone", "vicodin", "percocet", "codeine", "tramadol", "hydromorphone", "dilaudid", "meperidine", "demerol"],
    "sulfa": ["bactrim", "septra", "sulfamethoxazole", "sulfadiazine", "sulfonamide", "sulfadoxine"],
    "benzodiazepine": ["diazepam", "valium", "lorazepam", "ativan", "midazolam", "versed", "clonazepam", "klonopin", "alprazolam", "xanax"],
    "ace_inhibitor": ["lisinopril", "enalapril", "ramipril", "captopril", "benazepril", "fosinopril", "quinapril", "perindopril"],
    "beta_blocker": ["metoprolol", "atenolol", "propranolol", "carvedilol", "labetalol", "bisoprolol", "nadolol", "timolol"],
    "statin": ["atorvastatin", "simvastatin", "rosuvastatin", "lipitor", "zocor", "crestor", "pravastatin", "lovastatin"],
    "anticoagulant": ["warfarin", "coumadin", "heparin", "enoxaparin", "lovenox", "rivaroxaban", "xarelto", "apixaban", "eliquis", "dabigatran"],
    "contrast_dye": ["iodine", "iodinated", "contrast", "omnipaque", "visipaque", "isovue"],
    "local_anesthetic": ["lidocaine", "xylocaine", "bupivacaine", "marcaine", "tetracaine", "benzocaine", "procaine", "novocaine"],
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
    Also handles cross-reactive families (e.g. penicillin <-> cephalosporin 10% cross-reactivity).
    """
    if not allergy_str:
        return set()

    allergies = [a.strip().lower() for a in allergy_str.split(",")]
    related_drugs = set(allergies)

    # Cross-reactivity map — if allergic to one family, flag the related family too
    CROSS_REACTIVE = {
        "penicillin": "cephalosporin",
        "cephalosporin": "penicillin",
    }

    families_to_add = set()
    for a in allergies:
        # Forward lookup: class name -> all drugs in the class
        if a in DRUG_CLASSES:
            related_drugs.update(DRUG_CLASSES[a])
            if a in CROSS_REACTIVE:
                families_to_add.add(CROSS_REACTIVE[a])

        # Reverse lookup: specific drug -> parent class -> all drugs in class
        if a in DRUG_TO_CLASS:
            parent_class = DRUG_TO_CLASS[a]
            related_drugs.update(DRUG_CLASSES[parent_class])
            related_drugs.add(parent_class)
            if parent_class in CROSS_REACTIVE:
                families_to_add.add(CROSS_REACTIVE[parent_class])

    # Add cross-reactive family members
    for family in families_to_add:
        if family in DRUG_CLASSES:
            related_drugs.update(DRUG_CLASSES[family])
            related_drugs.add(family)

    return related_drugs


def check_allergies(transcript: str, patient_allergies: str) -> str:
    """
    Deterministic, zero-token rule-based check with:
    - Forward/reverse class lookup
    - Cross-reactivity detection (penicillin <-> cephalosporin)
    - Fuzzy phonetic matching (catches STT errors)
    Returns a warning string if a conflict is found, else None.
    """
    if not patient_allergies or patient_allergies.lower() == "none":
        return None

    related_drugs = get_all_related_drugs(patient_allergies)
    transcript_words = re.findall(r'\b\w+\b', transcript.lower())

    for word in transcript_words:
        # 1. Exact Match Check
        if word in related_drugs:
            return (
                f"🚨 CRITICAL ALLERGY ALERT: Protocol STOPPED. "
                f"Patient has a documented allergy conflict with {word.upper()}. "
                f"DO NOT ADMINISTER. Check chart for safe alternatives."
            )

        # 2. Fuzzy Match Check (catches STT errors like "amoxacilin" for "amoxicillin")
        # Only run on longer words to avoid false positives on short words
        if len(word) > 5:
            matches = difflib.get_close_matches(word, related_drugs, n=1, cutoff=0.82)
            if matches:
                return (
                    f"🚨 CRITICAL ALLERGY ALERT: Protocol STOPPED. "
                    f"STT detected '{word}' — matched known allergy: {matches[0].upper()}. "
                    f"DO NOT ADMINISTER. Verify with patient chart."
                )

    return None
