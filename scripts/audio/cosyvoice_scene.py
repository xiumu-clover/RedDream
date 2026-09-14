#!/usr/bin/env python3
"""Render cached drama-scene dialogue units with CosyVoice2.

The process loads CosyVoice once, runs jobs serially, prefers instruct2, checks
speaker-embedding similarity against the supplied voice card, and falls back to
zero-shot when instruct2 visibly drifts below the configured threshold.
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render CosyVoice drama-scene jobs.")
    parser.add_argument("--cosyvoice-root", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--jobs", required=True, type=Path)
    parser.add_argument("--results-output", required=True, type=Path)
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--load-jit", action="store_true")
    parser.add_argument("--speech-tokenizer-cpu", action="store_true")
    parser.add_argument("--disable-text-frontend", action="store_true")
    parser.add_argument("--min-token-text-ratio", type=float, default=2.0)
    parser.add_argument("--max-token-text-ratio", type=float, default=12.0)
    parser.add_argument("--job-timeout-seconds", type=int, default=120)
    parser.add_argument("--min-instruct-speaker-similarity", type=float, default=0.70)
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


def require_file(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file() or resolved.stat().st_size <= 0:
        raise FileNotFoundError(f"{label} is missing or empty: {resolved}")
    return resolved


class JobTimeoutError(TimeoutError):
    pass


def alarm_handler(_signum: int, _frame: Any) -> None:
    raise JobTimeoutError("CosyVoice job produced no completed output before timeout.")


def synthesize(
    model: Any,
    torch: Any,
    *,
    method: str,
    text: str,
    instruction: str,
    card_text: str,
    card_path: Path,
    speed: float,
    text_frontend: bool,
    zero_shot_spk_id: str = "",
) -> Any:
    if method == "inference_instruct2":
        iterator = model.inference_instruct2(
            text,
            instruction,
            str(card_path),
            stream=False,
            speed=speed,
            text_frontend=text_frontend,
        )
    elif method == "inference_zero_shot":
        iterator = model.inference_zero_shot(
            text,
            card_text,
            str(card_path),
            zero_shot_spk_id=zero_shot_spk_id,
            stream=False,
            speed=speed,
            text_frontend=text_frontend,
        )
    else:
        raise ValueError(f"Unsupported inference method: {method}")
    chunks = [item["tts_speech"].detach().cpu() for item in iterator]
    if not chunks:
        raise RuntimeError("CosyVoice returned no audio chunks.")
    return torch.cat(chunks, dim=1)


def save_audio_atomic(torchaudio: Any, audio: Any, sample_rate: int, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.stem}.{os.getpid()}.{time.time_ns()}.tmp.wav")
    try:
        torchaudio.save(str(temporary), audio, sample_rate)
        if not temporary.is_file() or temporary.stat().st_size <= 44:
            raise RuntimeError(f"CosyVoice wrote an empty WAV: {temporary}")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def speaker_similarity(model: Any, torch: Any, left_embedding: Any, right: Path) -> float:
    right_embedding = model.frontend._extract_spk_embedding(str(right)).detach().float().cpu()
    return float(torch.nn.functional.cosine_similarity(left_embedding, right_embedding).item())


def cached_speaker_embedding(model: Any, speaker_id: str) -> Any:
    """Return the embedding stored by either bundled or runtime-added speakers."""
    speaker_info = model.frontend.spk2info[speaker_id]
    for key in ("embedding", "flow_embedding", "llm_embedding"):
        if key in speaker_info:
            return speaker_info[key].detach().float().cpu()
    raise KeyError(f"cached speaker {speaker_id!r} has no usable embedding")


def validate_jobs(document: Any) -> list[dict[str, Any]]:
    if not isinstance(document, dict) or not isinstance(document.get("jobs"), list):
        raise ValueError("Jobs JSON must contain a jobs array.")
    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in document["jobs"]:
        if not isinstance(raw, dict):
            raise ValueError("Every CosyVoice job must be an object.")
        job_id = str(raw.get("id", ""))
        if not job_id or job_id in seen:
            raise ValueError(f"CosyVoice job id is missing or duplicated: {job_id}")
        seen.add(job_id)
        for field in ("text", "instruction", "voiceCardText", "voiceCardPath", "outputPath"):
            if not isinstance(raw.get(field), str) or not raw[field]:
                raise ValueError(f"CosyVoice job {job_id} has invalid {field}.")
        if not raw["instruction"].endswith("<|endofprompt|>"):
            raise ValueError(f"CosyVoice job {job_id} instruction lacks <|endofprompt|>.")
        speed = float(raw.get("speed", 1.0))
        if speed <= 0:
            raise ValueError(f"CosyVoice job {job_id} speed must be positive.")
        jobs.append({**raw, "id": job_id, "speed": speed})
    return jobs


def main() -> int:
    args = parse_args()
    if args.min_token_text_ratio <= 0:
        raise ValueError("--min-token-text-ratio must be positive.")
    if args.max_token_text_ratio < args.min_token_text_ratio:
        raise ValueError("--max-token-text-ratio must not be below the minimum.")
    if args.max_token_text_ratio < 12:
        raise ValueError("--max-token-text-ratio below 12 is forbidden for this workflow.")
    if args.job_timeout_seconds < 1:
        raise ValueError("--job-timeout-seconds must be positive.")

    cosyvoice_root = args.cosyvoice_root.expanduser().resolve()
    model_dir = args.model_dir.expanduser().resolve()
    require_file(model_dir / "cosyvoice2.yaml", "CosyVoice2 model config")
    jobs_path = require_file(args.jobs, "CosyVoice jobs JSON")
    jobs = validate_jobs(json.loads(jobs_path.read_text(encoding="utf-8")))
    results_output = args.results_output.expanduser().resolve()

    sys.path.insert(0, str(cosyvoice_root))
    sys.path.insert(0, str(cosyvoice_root / "third_party" / "Matcha-TTS"))
    os.chdir(cosyvoice_root)

    import onnxruntime
    import torch
    import torchaudio
    from cosyvoice.cli.cosyvoice import AutoModel

    original_inference_session = onnxruntime.InferenceSession

    def create_inference_session(model_path: str, *session_args: Any, **session_kwargs: Any) -> Any:
        if args.speech_tokenizer_cpu and Path(model_path).name.startswith("speech_tokenizer"):
            session_kwargs["providers"] = ["CPUExecutionProvider"]
        return original_inference_session(model_path, *session_args, **session_kwargs)

    if args.speech_tokenizer_cpu:
        onnxruntime.InferenceSession = create_inference_session
    process_started = time.perf_counter()
    model_started = time.perf_counter()
    try:
        model = AutoModel(model_dir=str(model_dir), fp16=args.fp16, load_jit=args.load_jit)
    finally:
        onnxruntime.InferenceSession = original_inference_session
    model_load_seconds = time.perf_counter() - model_started
    model.model.llm.inference = functools.partial(
        model.model.llm.inference,
        min_token_text_ratio=args.min_token_text_ratio,
        max_token_text_ratio=args.max_token_text_ratio,
    )

    # The same card is reused by many short lines. CosyVoice otherwise repeats
    # speech-token, acoustic-feature and speaker-embedding extraction for every
    # line. Cache those prompt features once per exact card + transcript inside
    # the already-loaded process. This is valid for zero-shot; instruct2 keeps
    # using the live instruction path because its prompt text is different.
    prompt_cache_started = time.perf_counter()
    prompt_cache: dict[tuple[str, str], str] = {}
    for job in jobs:
        card_path = require_file(Path(job["voiceCardPath"]), f"voice card for {job['id']}")
        key = (str(card_path), job["voiceCardText"])
        if key in prompt_cache:
            continue
        identity = hashlib.sha256(f"{key[0]}\0{key[1]}".encode("utf-8")).hexdigest()[:24]
        speaker_id = f"drama-{identity}"
        model.add_zero_shot_spk(job["voiceCardText"], str(card_path), speaker_id)
        prompt_cache[key] = speaker_id
    prompt_cache_seconds = time.perf_counter() - prompt_cache_started

    signal.signal(signal.SIGALRM, alarm_handler)
    results: list[dict[str, Any]] = []
    text_frontend = not args.disable_text_frontend
    try:
        for index, job in enumerate(jobs, start=1):
            card_path = require_file(Path(job["voiceCardPath"]), f"voice card for {job['id']}")
            output_path = Path(job["outputPath"]).expanduser().resolve()
            attempt_path = Path(job.get("instructAttemptPath") or (
                output_path.parent / "attempts" / f"{output_path.stem}-instruct.wav"
            )).expanduser().resolve()
            output_metadata_path = Path(job.get("metadataPath") or f"{output_path}.json").expanduser().resolve()
            seed = int(job.get("seed", 20260911))
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)

            if args.verbose:
                print(f"JOB_START {index}/{len(jobs)} {job['id']}", flush=True)
            job_started = time.perf_counter()
            signal.alarm(args.job_timeout_seconds)
            force_zero_shot = bool(job.get("forceZeroShot"))
            method_used = "inference_zero_shot" if force_zero_shot else "inference_instruct2"
            fallback_reason = job.get("fallbackReason") if force_zero_shot else None
            instruct_attempted = not force_zero_shot
            try:
                if force_zero_shot:
                    fallback_audio = synthesize(
                        model,
                        torch,
                        method="inference_zero_shot",
                        text=job["text"],
                        instruction=job["instruction"],
                        card_text=job["voiceCardText"],
                        card_path=card_path,
                        speed=job["speed"],
                        text_frontend=text_frontend,
                        zero_shot_spk_id=prompt_cache[(str(card_path), job["voiceCardText"])],
                    )
                    save_audio_atomic(torchaudio, fallback_audio, model.sample_rate, output_path)
                    instruct_similarity = None
                    card_embedding = cached_speaker_embedding(
                        model,
                        prompt_cache[(str(card_path), job["voiceCardText"])],
                    )
                    final_similarity = speaker_similarity(model, torch, card_embedding, output_path)
                    final_audio = fallback_audio
                else:
                    instruct_audio = synthesize(
                        model,
                        torch,
                        method="inference_instruct2",
                        text=job["text"],
                        instruction=job["instruction"],
                        card_text=job["voiceCardText"],
                        card_path=card_path,
                        speed=job["speed"],
                        text_frontend=text_frontend,
                    )
                    save_audio_atomic(torchaudio, instruct_audio, model.sample_rate, attempt_path)
                    card_embedding = cached_speaker_embedding(
                        model,
                        prompt_cache[(str(card_path), job["voiceCardText"])],
                    )
                    instruct_similarity = speaker_similarity(model, torch, card_embedding, attempt_path)
                if force_zero_shot:
                    pass
                elif instruct_similarity < args.min_instruct_speaker_similarity:
                    fallback_reason = (
                        f"instruct2 card similarity {instruct_similarity:.4f} below "
                        f"{args.min_instruct_speaker_similarity:.4f}"
                    )
                    method_used = "inference_zero_shot"
                    torch.manual_seed(seed + 1)
                    if torch.cuda.is_available():
                        torch.cuda.manual_seed_all(seed + 1)
                    fallback_audio = synthesize(
                        model,
                        torch,
                        method="inference_zero_shot",
                        text=job["text"],
                        instruction=job["instruction"],
                        card_text=job["voiceCardText"],
                        card_path=card_path,
                        speed=job["speed"],
                        text_frontend=text_frontend,
                        zero_shot_spk_id=prompt_cache[(str(card_path), job["voiceCardText"])],
                    )
                    save_audio_atomic(torchaudio, fallback_audio, model.sample_rate, output_path)
                    final_similarity = speaker_similarity(model, torch, card_embedding, output_path)
                    final_audio = fallback_audio
                else:
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(attempt_path, output_path)
                    final_similarity = instruct_similarity
                    final_audio = instruct_audio

                elapsed = time.perf_counter() - job_started
                result = {
                    "id": job["id"],
                    "renderHash": job.get("renderHash"),
                    "text": job["text"],
                    "sourceText": job.get("sourceText", job["text"]),
                    "pronunciations": job.get("pronunciations"),
                    "voiceCardId": job.get("voiceCardId"),
                    "voiceCardPath": str(card_path),
                    "voiceCardText": job["voiceCardText"],
                    "voiceCardFileHash": job.get("voiceCardFileHash"),
                    "instruction": job["instruction"],
                    "preferredMethod": "inference_instruct2",
                    "methodUsed": method_used,
                    "instructAttempted": instruct_attempted,
                    "speed": job["speed"],
                    "seed": seed,
                    "cachedPromptFeatures": force_zero_shot or method_used == "inference_zero_shot",
                    "durationSeconds": round(final_audio.shape[1] / model.sample_rate, 3),
                    "fileHash": sha256_file(output_path),
                    "cardToInstructSimilarity": (
                        round(instruct_similarity, 6) if instruct_similarity is not None else None
                    ),
                    "cardToFinalSimilarity": round(final_similarity, 6),
                    "fallbackReason": fallback_reason,
                    "failedInstructAttemptPath": (
                        str(attempt_path) if fallback_reason and instruct_attempted else None
                    ),
                    "elapsedSeconds": round(elapsed, 3),
                    "sampleRate": model.sample_rate,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                }
                write_json_atomic(output_metadata_path, result)
                results.append(result)
                if args.verbose:
                    print(
                        f"JOB_DONE {index}/{len(jobs)} {job['id']} "
                        f"{method_used} {elapsed:.1f}s similarity={final_similarity:.4f}",
                        flush=True,
                    )
            finally:
                signal.alarm(0)
    finally:
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    document = {
        "version": 1,
        "engine": "CosyVoice2",
        "modelDir": str(model_dir),
        "sampleRate": 24000,
        "fp16": args.fp16,
        "loadJit": args.load_jit,
        "speechTokenizerDevice": "cpu" if args.speech_tokenizer_cpu else "automatic",
        "textFrontend": text_frontend,
        "minTokenTextRatio": args.min_token_text_ratio,
        "maxTokenTextRatio": args.max_token_text_ratio,
        "jobTimeoutSeconds": args.job_timeout_seconds,
        "minInstructSpeakerSimilarity": args.min_instruct_speaker_similarity,
        "modelLoadSeconds": round(model_load_seconds, 3),
        "promptCacheEntries": len(prompt_cache),
        "promptCacheSeconds": round(prompt_cache_seconds, 3),
        "totalElapsedSeconds": round(time.perf_counter() - process_started, 3),
        "results": results,
    }
    write_json_atomic(results_output, document)
    print(
        json.dumps(
            {
                "jobs": len(results),
                "modelLoadSeconds": document["modelLoadSeconds"],
                "totalElapsedSeconds": document["totalElapsedSeconds"],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"CosyVoice scene rendering failed: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from error
