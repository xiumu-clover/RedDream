from __future__ import annotations

import argparse
import json
import math
import platform
from pathlib import Path
from statistics import median
from typing import Any, Dict, List

from metrics import bpc_from_nll, empirical_compatibility, scoring_windows


SCRIPT_DIR = Path(__file__).resolve().parent


def robust_center(values: List[float]) -> Dict[str, float]:
    center = median(values)
    deviations = [abs(value - center) for value in values]
    scale = median(deviations) * 1.4826 or 1.0
    return {"center": center, "scale": scale}


def score_text(text: str, tokenizer: Any, model: Any, config: Dict[str, Any], torch: Any) -> float:
    token_ids = tokenizer(text, add_special_tokens=False)["input_ids"]
    total_nll = 0.0
    scored_tokens = 0
    with torch.no_grad():
        for window in scoring_windows(token_ids, config["contextTokens"], config["strideTokens"]):
            ids = torch.tensor([window["input_ids"]], device=model.device)
            logits = model(input_ids=ids).logits[:, :-1, :].float()
            labels = ids[:, 1:]
            score_from = max(0, int(window["score_from"]) - 1)
            logits = logits[:, score_from:, :]
            labels = labels[:, score_from:]
            if labels.numel() == 0:
                continue
            loss = torch.nn.functional.cross_entropy(
                logits.reshape(-1, logits.shape[-1]), labels.reshape(-1), reduction="sum"
            )
            total_nll += float(loss.item())
            scored_tokens += int(labels.numel())
    if scored_tokens == 0:
        raise ValueError("文本过短，无法计算神经 BPC")
    return bpc_from_nll(total_nll, len(text))


def main() -> None:
    major, minor = map(int, platform.python_version_tuple()[:2])
    if (major, minor) < (3, 11):
        raise SystemExit("Qwen LoRA 阶段要求 Python 3.11 或更高版本。")
    parser = argparse.ArgumentParser(description="计算基础模型与 LoRA 的 BPC/style lift")
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--adapter", type=Path, action="append", required=True, help="可重复两次，依次传入 A/B 风格簇适配器")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if not torch.cuda.is_available():
        raise SystemExit("神经阶段必须在 CUDA GPU 环境运行。")
    config = json.loads((SCRIPT_DIR / "config.json").read_text(encoding="utf-8"))
    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    audit = json.loads(args.audit.read_text(encoding="utf-8"))
    tokenizer = AutoTokenizer.from_pretrained(config["model"], revision=config["revision"])
    base = AutoModelForCausalLM.from_pretrained(
        config["model"], revision=config["revision"], torch_dtype=torch.bfloat16, device_map="auto"
    ).eval()

    calibration = [
        {"key": "cal:" + fragment["id"], "id": fragment["id"], "maskedText": fragment["maskedText"]}
        for fragment in corpus["fragments"]
        if fragment["track"] == "prose" and fragment["split"] == "calibration"
    ]
    candidates = [
        {"key": "candidate:" + fragment["id"], "id": fragment["id"], "maskedText": fragment["neuralInput"]}
        for item in audit["inputs"] for fragment in item["fragments"]
    ]
    base_bpc = {
        item["key"]: score_text(item["maskedText"], tokenizer, base, config, torch)
        for item in [*calibration, *candidates]
    }
    del base
    torch.cuda.empty_cache()
    adapted_sets = []
    for adapter_path in args.adapter:
        adapter_base = AutoModelForCausalLM.from_pretrained(
            config["model"], revision=config["revision"], torch_dtype=torch.bfloat16, device_map="auto"
        )
        adapted = PeftModel.from_pretrained(adapter_base, adapter_path).eval()
        adapted_sets.append({
            item["key"]: score_text(item["maskedText"], tokenizer, adapted, config, torch)
            for item in [*calibration, *candidates]
        })
        del adapted
        del adapter_base
        torch.cuda.empty_cache()

    def best_lift(key: str) -> Dict[str, Any]:
        lifts = [base_bpc[key] - values[key] for values in adapted_sets]
        cluster = max(range(len(lifts)), key=lambda index: lifts[index])
        return {
            "cluster": cluster,
            "lift": lifts[cluster],
            "adaptedBpc": adapted_sets[cluster][key],
            "clusterAdaptedBpc": [values[key] for values in adapted_sets],
        }

    calibration_lifts = [best_lift(fragment["key"])["lift"] for fragment in calibration]
    center = robust_center(calibration_lifts)
    calibration_nonconformity = [abs(value - center["center"]) / center["scale"] for value in calibration_lifts]
    output = {
        "schemaVersion": 1,
        "kind": "style-audit-neural-results",
        "model": config["model"],
        "revision": config["revision"],
        "adapters": [str(path.resolve()) for path in args.adapter],
        "corpusHash": corpus["corpusHash"],
        "fragments": [],
    }
    for candidate in candidates:
        fragment_id = candidate["id"]
        key = candidate["key"]
        best = best_lift(key)
        lift = best["lift"]
        nonconformity = abs(lift - center["center"]) / center["scale"]
        output["fragments"].append({
            "id": fragment_id,
            "baseBpc": base_bpc[key],
            "adaptedBpc": best["adaptedBpc"],
            "clusterAdaptedBpc": best["clusterAdaptedBpc"],
            "styleCluster": best["cluster"],
            "styleLift": lift,
            "compatibility": empirical_compatibility(nonconformity, calibration_nonconformity),
        })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
