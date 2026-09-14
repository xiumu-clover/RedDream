#!/usr/bin/env python3
"""Transcribe cached drama dialogue fragments after CosyVoice has exited."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


WHISPER_INITIAL_PROMPT = "以下是普通话录音，请使用简体中文转写。"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate drama dialogue with Whisper.")
    parser.add_argument("--jobs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", default="small")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower()
    return "".join(character for character in normalized if (
        not character.isspace()
        and not unicodedata.category(character).startswith(("P", "S"))
    ))


def difference_opcodes(expected: str, actual: str) -> list[dict[str, Any]]:
    matcher = difflib.SequenceMatcher(a=expected, b=actual, autojunk=False)
    return [
        {
            "operation": tag,
            "expected": expected[left_start:left_end],
            "actual": actual[right_start:right_end],
            "expectedRange": [left_start, left_end],
            "actualRange": [right_start, right_end],
        }
        for tag, left_start, left_end, right_start, right_end in matcher.get_opcodes()
        if tag != "equal"
    ]


def repeated_unexpected_span(expected: str, actual: str) -> str | None:
    """Find a meaningful non-overlapping phrase duplicated only by the render."""
    maximum = min(20, len(actual) // 2)
    for length in range(maximum, 1, -1):
        for start in range(0, len(actual) - length + 1):
            candidate = actual[start:start + length]
            second = actual.find(candidate, start + length)
            # Two- and three-character phrases are common in Chinese; only flag
            # them when the duplicate is immediate (for example “哄人哄人”).
            immediate_short_repeat = length <= 3 and second == start + length
            expected_window = expected[start:start + (2 * length)]
            expected_repeats_here = (
                len(expected_window) == 2 * length
                and expected_window[:length] == expected_window[length:]
            )
            meaningful_long_repeat = length >= 4 and second >= 0
            if (immediate_short_repeat or meaningful_long_repeat) and not expected_repeats_here and (
                actual.count(candidate) > expected.count(candidate)
            ):
                return candidate
    return None


def transcription_hash(*, file_hash: str, model: str) -> str:
    payload = json.dumps(
        {
            "version": "whisper-transcription-v1",
            "fileHash": file_hash,
            "model": model,
            "language": "zh",
            "temperature": 0,
            "conditionOnPreviousText": False,
            "initialPrompt": WHISPER_INITIAL_PROMPT,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def analysis_hash(*, transcription_key: str, expected_text: str) -> str:
    payload = json.dumps(
        {
            "version": "whisper-structural-analysis-v2",
            "transcriptionHash": transcription_key,
            "expectedText": expected_text,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def analyze_transcript(
    *,
    job: dict[str, Any],
    path: Path,
    file_hash: str,
    transcription_key: str,
    transcript: str,
    transcription_seconds: float,
) -> dict[str, Any]:
    expected_normalized = normalize_text(job["expectedText"])
    actual_normalized = normalize_text(transcript)
    similarity = difflib.SequenceMatcher(
        a=expected_normalized,
        b=actual_normalized,
        autojunk=False,
    ).ratio()
    repetition = repeated_unexpected_span(expected_normalized, actual_normalized)
    length_ratio = len(actual_normalized) / max(1, len(expected_normalized))
    if repetition:
        status = "reject-unexpected-repetition"
    elif expected_normalized == actual_normalized:
        status = "exact"
    elif similarity >= 0.78:
        status = "review-homophone-or-minor"
    else:
        status = "review-required"
    return {
        **job,
        "path": str(path),
        "fileHash": file_hash,
        "transcriptionHash": transcription_key,
        "analysisHash": analysis_hash(
            transcription_key=transcription_key,
            expected_text=job["expectedText"],
        ),
        "transcript": transcript,
        "expectedNormalized": expected_normalized,
        "transcriptNormalized": actual_normalized,
        "characterSimilarity": round(similarity, 6),
        "lengthRatio": round(length_ratio, 6),
        "repeatedUnexpectedSpan": repetition,
        "differences": difference_opcodes(expected_normalized, actual_normalized),
        "status": status,
        "transcriptionSeconds": round(transcription_seconds, 3),
    }


def main() -> int:
    args = parse_args()
    jobs_document = json.loads(args.jobs.read_text(encoding="utf-8"))
    jobs = jobs_document.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("Whisper jobs JSON must contain a jobs array.")

    output_path = args.output.expanduser().resolve()
    previous: dict[str, Any] = {}
    if output_path.is_file():
        try:
            previous = json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous = {}
    cached_by_hash = {
        result["transcriptionHash"]: result
        for result in previous.get("results", [])
        if isinstance(result, dict) and isinstance(result.get("transcriptionHash"), str)
    }
    # One-time migration from the previous combined validation cache. The v3
    # report used exactly the same ASR settings; reuse its transcript by file
    # hash, then recompute quality rules below without loading Whisper.
    legacy_by_file_hash = {
        result["fileHash"]: result
        for result in previous.get("results", [])
        if (
            previous.get("model") == args.model
            and isinstance(result, dict)
            and isinstance(result.get("validationHash"), str)
            and isinstance(result.get("fileHash"), str)
            and isinstance(result.get("transcript"), str)
        )
    }

    started = time.perf_counter()
    prepared = []
    for job in jobs:
        path = Path(job["path"]).expanduser().resolve()
        if not path.is_file() or path.stat().st_size <= 44:
            raise FileNotFoundError(f"Whisper input is missing or empty: {path}")
        file_hash = sha256_file(path)
        cache_key = transcription_hash(
            file_hash=file_hash,
            model=args.model,
        )
        prepared.append((job, path, file_hash, cache_key))

    missing = [
        item for item in prepared
        if item[3] not in cached_by_hash and item[2] not in legacy_by_file_hash
    ]
    model = None
    model_load_seconds = 0.0
    device = previous.get("device", "cache-only")
    if missing:
        import torch
        import whisper

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model_started = time.perf_counter()
        model = whisper.load_model(args.model, device=device)
        model_load_seconds = time.perf_counter() - model_started

    results = []
    for index, (job, path, file_hash, cache_key) in enumerate(prepared, start=1):
        cached = cached_by_hash.get(cache_key) or legacy_by_file_hash.get(file_hash)
        if cached is not None:
            results.append(analyze_transcript(
                job=job,
                path=path,
                file_hash=file_hash,
                transcription_key=cache_key,
                transcript=cached["transcript"],
                transcription_seconds=float(
                    cached.get("transcriptionSeconds", cached.get("elapsedSeconds", 0.0))
                ),
            ))
            continue
        if args.verbose:
            print(f"WHISPER_START {index}/{len(jobs)} {job['id']}", flush=True)
        item_started = time.perf_counter()
        assert model is not None
        transcription = model.transcribe(
            str(path),
            language="zh",
            task="transcribe",
            fp16=device == "cuda",
            temperature=0,
            condition_on_previous_text=False,
            initial_prompt=WHISPER_INITIAL_PROMPT,
            verbose=False,
        )
        actual = str(transcription.get("text", "")).strip()
        result = analyze_transcript(
            job=job,
            path=path,
            file_hash=file_hash,
            transcription_key=cache_key,
            transcript=actual,
            transcription_seconds=time.perf_counter() - item_started,
        )
        results.append(result)
        if args.verbose:
            print(
                f"WHISPER_DONE {index}/{len(jobs)} {job['id']} "
                f"similarity={result['characterSimilarity']:.3f} {result['status']}: {actual}",
                flush=True,
            )

    statuses = sorted({result["status"] for result in results})
    counts = {key: sum(result["status"] == key for result in results) for key in statuses}
    kinds = sorted({result["kind"] for result in results})
    counts_by_kind = {
        kind: {
            status: sum(
                result["kind"] == kind and result["status"] == status
                for result in results
            )
            for status in statuses
        }
        for kind in kinds
    }
    document = {
        "version": 2,
        "transcriptionCacheVersion": "whisper-transcription-v1",
        "analysisVersion": "whisper-structural-analysis-v2",
        "model": args.model,
        "device": device,
        "modelLoadSeconds": round(model_load_seconds, 3),
        "cacheHits": len(prepared) - len(missing),
        "transcriptions": len(missing),
        "totalElapsedSeconds": round(time.perf_counter() - started, 3),
        "counts": counts,
        "countsByKind": counts_by_kind,
        "results": results,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    write_json_atomic(output_path, document)
    print(json.dumps({
        "counts": counts,
        "cacheHits": document["cacheHits"],
        "transcriptions": document["transcriptions"],
    }, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Whisper validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
