import pytest
from services.allergy_checker import check_allergies, get_all_related_drugs

def test_reverse_lookup():
    # If allergic to amoxicillin, medic giving augmentin (same class) must be blocked
    res = check_allergies("give them augmentin", "amoxicillin")
    assert res is not None
    assert "AUGMENTIN" in res or "AMOXICILLIN" in res

def test_fuzzy_matching_stt_error():
    # "amoxacilin" is a common STT misspelling for amoxicillin
    res = check_allergies("administering amoxacilin now", "penicillin")
    assert res is not None
    assert "AMOXICILLIN" in res

def test_direct_class_match():
    # Patient allergic to penicillin, medic says amoxicillin
    res = check_allergies("starting IV amoxicillin now", "penicillin")
    assert res is not None
    assert "AMOXICILLIN" in res

def test_multiple_allergies():
    # Patient allergic to sulfa and nsaid, medic gives ibuprofen
    res = check_allergies("give them some advil", "sulfa, nsaid")
    assert res is not None
    assert "ADVIL" in res

def test_no_allergy():
    assert check_allergies("administer amoxicillin", "none") is None
    assert check_allergies("administer amoxicillin", "") is None
