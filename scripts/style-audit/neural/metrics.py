from __future__ import annotations

import math
from typing import Dict, Iterable, List


def scoring_windows(token_ids: List[int], context_tokens: int, stride_tokens: int) -> Iterable[Dict[str, object]]:
    """Yield overlapping windows while assigning every predictable token once."""
    if context_tokens < 2:
        raise ValueError("context_tokens must be at least 2")
    if stride_tokens < 1 or stride_tokens > context_tokens:
        raise ValueError("stride_tokens must be between 1 and context_tokens")
    previous_end = 0
    while previous_end < len(token_ids):
        end = min(len(token_ids), previous_end + (context_tokens if previous_end == 0 else stride_tokens))
        begin = max(0, end - context_tokens)
        score_from = max(1, previous_end - begin)
        yield {
            "input_ids": token_ids[begin:end],
            "begin": begin,
            "end": end,
            "score_from": score_from,
            "scored_tokens": max(0, end - begin - score_from),
        }
        if end == len(token_ids):
            break
        previous_end = end


def bpc_from_nll(total_nll: float, character_count: int) -> float:
    if character_count <= 0:
        raise ValueError("character_count must be positive")
    return total_nll / (math.log(2.0) * character_count)


def empirical_compatibility(nonconformity: float, calibration: List[float]) -> float:
    if not calibration:
        return 0.0
    tail = sum(1 for value in calibration if value >= nonconformity)
    return 100.0 * (tail + 1) / (len(calibration) + 1)
