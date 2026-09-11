#!/usr/bin/env python3
"""Generate a canonical voice card and a second-pass CosyVoice demo.

Run this script with the Python environment that can import the local
CosyVoice checkout. The source reference must already be a clean WAV with an
accurate transcript. Generated media belongs in content/audio/.cache/.
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a CosyVoice voice card, then use it for a demo.",
    )
    parser.add_argument(
        "--cosyvoice-root",
        required=True,
        type=Path,
        help="CosyVoice checkout containing cosyvoice/ and third_party/.",
    )
    parser.add_argument(
        "--model-dir",
        default="pretrained_models/CosyVoice2-0.5B",
        help="Absolute model path, or a path relative to --cosyvoice-root.",
    )
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--reference-text", required=True)
    parser.add_argument("--card-text", required=True)
    parser.add_argument("--demo-text", required=True)
    parser.add_argument("--card-output", required=True, type=Path)
    parser.add_argument("--demo-output", required=True, type=Path)
    parser.add_argument("--metadata-output", required=True, type=Path)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=20260909)
    parser.add_argument(
        "--min-token-text-ratio",
        type=float,
        default=2.0,
        help="Minimum speech-token count per normalized text token.",
    )
    parser.add_argument(
        "--max-token-text-ratio",
        type=float,
        default=20.0,
        help="Maximum speech-token count per normalized text token.",
    )
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument(
        "--load-jit",
        action="store_true",
        help="Load the model's official JIT flow encoder when available.",
    )
    parser.add_argument(
        "--stream",
        action="store_true",
        help="Use CosyVoice streaming inference and concatenate returned chunks.",
    )
    parser.add_argument(
        "--disable-text-frontend",
        action="store_true",
        help="Skip optional text-normalization resources for already normalized text.",
    )
    parser.add_argument(
        "--speech-tokenizer-cpu",
        action="store_true",
        help="Run the ONNX speech tokenizer on CPU to save GPU memory.",
    )
    return parser.parse_args()


def require_file(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"{label} does not exist: {resolved}")
    return resolved


def prepare_output(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def synthesize(
    model,
    torch,
    text: str,
    prompt_text: str,
    prompt_wav: Path,
    speed: float,
    stream: bool,
    text_frontend: bool,
):
    chunks = [
        item["tts_speech"].detach().cpu()
        for item in model.inference_zero_shot(
            text,
            prompt_text,
            str(prompt_wav),
            stream=stream,
            speed=speed,
            text_frontend=text_frontend,
        )
    ]
    if not chunks:
        raise RuntimeError("CosyVoice returned no audio chunks.")
    return torch.cat(chunks, dim=1)


def main() -> int:
    args = parse_args()
    if args.speed <= 0:
        raise ValueError("--speed must be greater than zero.")
    if args.min_token_text_ratio <= 0:
        raise ValueError("--min-token-text-ratio must be greater than zero.")
    if args.max_token_text_ratio < args.min_token_text_ratio:
        raise ValueError(
            "--max-token-text-ratio must be greater than or equal to "
            "--min-token-text-ratio.",
        )

    cosyvoice_root = args.cosyvoice_root.expanduser().resolve()
    if not (cosyvoice_root / "cosyvoice").is_dir():
        raise FileNotFoundError(
            f"CosyVoice package directory is missing: {cosyvoice_root / 'cosyvoice'}",
        )
    matcha_root = cosyvoice_root / "third_party" / "Matcha-TTS"
    sys.path.insert(0, str(cosyvoice_root))
    sys.path.insert(0, str(matcha_root))

    model_dir = Path(args.model_dir).expanduser()
    if not model_dir.is_absolute():
        model_dir = cosyvoice_root / model_dir
    model_dir = require_file(model_dir / "cosyvoice2.yaml", "CosyVoice2 model config").parent
    reference = require_file(args.reference, "Reference WAV")
    card_output = prepare_output(args.card_output)
    demo_output = prepare_output(args.demo_output)
    metadata_output = prepare_output(args.metadata_output)

    os.chdir(cosyvoice_root)
    import torch
    import torchaudio
    import onnxruntime
    from cosyvoice.cli.cosyvoice import AutoModel

    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    elif args.fp16:
        print("CUDA is unavailable; CosyVoice will disable fp16.", file=sys.stderr)

    original_inference_session = onnxruntime.InferenceSession

    def create_inference_session(model_path, *session_args, **session_kwargs):
        if (
            args.speech_tokenizer_cpu
            and Path(model_path).name.startswith("speech_tokenizer")
        ):
            session_kwargs["providers"] = ["CPUExecutionProvider"]
        return original_inference_session(model_path, *session_args, **session_kwargs)

    if args.speech_tokenizer_cpu:
        onnxruntime.InferenceSession = create_inference_session
    try:
        model = AutoModel(
            model_dir=str(model_dir),
            fp16=args.fp16,
            load_jit=args.load_jit,
        )
    finally:
        onnxruntime.InferenceSession = original_inference_session
    model.model.llm.inference = functools.partial(
        model.model.llm.inference,
        min_token_text_ratio=args.min_token_text_ratio,
        max_token_text_ratio=args.max_token_text_ratio,
    )
    print("[1/2] Generating canonical voice card...", flush=True)
    card_started = time.perf_counter()
    card_audio = synthesize(
        model,
        torch,
        args.card_text,
        args.reference_text,
        reference,
        args.speed,
        args.stream,
        not args.disable_text_frontend,
    )
    torchaudio.save(str(card_output), card_audio, model.sample_rate)
    card_elapsed = time.perf_counter() - card_started
    print(f"[1/2] Saved {card_output} in {card_elapsed:.1f}s", flush=True)

    torch.manual_seed(args.seed + 1)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed + 1)
    print("[2/2] Generating demo from the voice card...", flush=True)
    demo_started = time.perf_counter()
    demo_audio = synthesize(
        model,
        torch,
        args.demo_text,
        args.card_text,
        card_output,
        args.speed,
        args.stream,
        not args.disable_text_frontend,
    )
    torchaudio.save(str(demo_output), demo_audio, model.sample_rate)
    demo_elapsed = time.perf_counter() - demo_started
    print(f"[2/2] Saved {demo_output} in {demo_elapsed:.1f}s", flush=True)

    metadata = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "engine": "CosyVoice2",
        "modelDir": str(model_dir),
        "sampleRate": model.sample_rate,
        "speed": args.speed,
        "seed": args.seed,
        "minTokenTextRatio": args.min_token_text_ratio,
        "maxTokenTextRatio": args.max_token_text_ratio,
        "fp16": args.fp16,
        "loadJit": args.load_jit,
        "stream": args.stream,
        "textFrontend": not args.disable_text_frontend,
        "speechTokenizerDevice": (
            "cpu" if args.speech_tokenizer_cpu else "automatic"
        ),
        "timingsSeconds": {
            "voiceCard": round(card_elapsed, 3),
            "demo": round(demo_elapsed, 3),
        },
        "reference": {
            "path": str(reference),
            "text": args.reference_text,
            "sha256": sha256_file(reference),
        },
        "voiceCard": {
            "path": str(card_output),
            "text": args.card_text,
            "durationSeconds": round(card_audio.shape[1] / model.sample_rate, 3),
            "sha256": sha256_file(card_output),
        },
        "demo": {
            "path": str(demo_output),
            "text": args.demo_text,
            "durationSeconds": round(demo_audio.shape[1] / model.sample_rate, 3),
            "sha256": sha256_file(demo_output),
        },
    }
    metadata_output.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"CosyVoice demo failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
