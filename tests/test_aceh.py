"""Unit tests for the Aceh (Bahasa Aceh) local-language module.

Covers glossary integrity, detection confidence, and enrichment wiring.
Run: pytest tests/test_aceh.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "python"))

from aceh import COMMON_ACEH_WORDS, detect_aceh  # noqa: E402


def test_glossary_has_no_merged_keys():
    """Regression guard: a missing comma once merged 'seu'+'tanyo' into 'seutanyo'."""
    assert "seutanyo" not in COMMON_ACEH_WORDS, "bug: 'seu' 'tanyo' merged into one key"
    assert "tanyo" in COMMON_ACEH_WORDS, "real Aceh word 'tanyo' (to ask) must be present"
    assert "seu" in COMMON_ACEH_WORDS


def test_glossary_is_unique():
    """No duplicate entries — duplicates hide real words and waste memory."""
    assert len(COMMON_ACEH_WORDS) == len(set(COMMON_ACEH_WORDS))


def test_glossary_size_expanded():
    """TIM pass expanded the lexicon; ensure it stays meaningfully populated."""
    assert len(COMMON_ACEH_WORDS) >= 110


def test_detect_aceh_empty():
    assert detect_aceh("") == 0.0
    assert detect_aceh(None) == 0.0
    assert detect_aceh(123) == 0.0


def test_detect_aceh_positive():
    text = "Lôn jak u gampong, ulôn galak seunang"
    score = detect_aceh(text)
    assert score > 0.5, f"expected high Aceh confidence, got {score}"


def test_detect_aceh_negative():
    text = "The model routes requests to free providers with low latency."
    score = detect_aceh(text)
    assert score < 0.15, f"expected low Aceh confidence, got {score}"


def test_detect_aceh_suffix_matching():
    """Words ending in 'nyan'/'nyoe' are treated as Aceh markers."""
    score = detect_aceh("gopnyan droeneuh nyoe")
    assert score > 0.0


if __name__ == "__main__":
    for fn in [
        test_glossary_has_no_merged_keys,
        test_glossary_is_unique,
        test_glossary_size_expanded,
        test_detect_aceh_empty,
        test_detect_aceh_positive,
        test_detect_aceh_negative,
        test_detect_aceh_suffix_matching,
    ]:
        fn()
        print("PASS", fn.__name__)
    print("All Aceh tests passed")
