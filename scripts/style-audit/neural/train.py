from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path
from typing import Any, Dict, List


SCRIPT_DIR = Path(__file__).resolve().parent


def require_runtime() -> None:
    major, minor = map(int, platform.python_version_tuple()[:2])
    if (major, minor) < (3, 11):
        raise SystemExit("Qwen LoRA 阶段要求 Python 3.11 或更高版本。")


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def fragment_texts(
    corpus: Dict[str, Any],
    fold: int | None,
    held_out: bool,
    allowed_chapters: List[int] | None = None,
) -> List[str]:
    fragments = [
        fragment for fragment in corpus["fragments"]
        if fragment["track"] == "prose" and fragment["split"] == "training"
    ]
    if allowed_chapters is not None:
        fragments = [fragment for fragment in fragments if fragment["chapter"] in allowed_chapters]
    if fold is not None:
        fragments = [
            fragment for fragment in fragments
            if (fragment["fold"] == fold) == held_out
        ]
    return [fragment["maskedText"] for fragment in fragments]


def tokenize_blocks(tokenizer: Any, texts: List[str], context_tokens: int) -> List[List[int]]:
    blocks: List[List[int]] = []
    eos = tokenizer.eos_token_id
    for text in texts:
        token_ids = tokenizer(text, add_special_tokens=False)["input_ids"]
        if eos is not None:
            token_ids.append(eos)
        for start in range(0, len(token_ids), context_tokens):
            block = token_ids[start : start + context_tokens]
            if len(block) >= 16:
                blocks.append(block)
    return blocks


def main() -> None:
    require_runtime()
    parser = argparse.ArgumentParser(description="前八十回文风模型 Qwen LoRA 训练")
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fold", type=int, choices=range(5))
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--style-model", type=Path)
    parser.add_argument("--cluster", type=int, choices=(0, 1))
    args = parser.parse_args()

    config = load_json(SCRIPT_DIR / "config.json")
    corpus = load_json(args.corpus)
    if args.cluster is not None and args.style_model is None:
        raise SystemExit("按风格簇训练时必须提供 --style-model。")
    style_model = load_json(args.style_model) if args.style_model else None
    allowed_chapters = (
        style_model["mixture"]["masked"]["chapters"][args.cluster]
        if style_model is not None and args.cluster is not None
        else None
    )
    training_texts = fragment_texts(corpus, args.fold, held_out=False, allowed_chapters=allowed_chapters)
    evaluation_texts = fragment_texts(
        corpus, args.fold, held_out=True, allowed_chapters=allowed_chapters
    ) if args.fold is not None else []
    if args.fold is None and not args.max_steps:
        raise SystemExit("全量训练必须提供由五折最佳步数中位数确定的 --max-steps。")

    import torch
    from peft import LoraConfig, get_peft_model
    from torch.utils.data import Dataset
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        DataCollatorForLanguageModeling,
        EarlyStoppingCallback,
        Trainer,
        TrainingArguments,
    )

    if not torch.cuda.is_available():
        raise SystemExit("神经阶段必须在 CUDA GPU 环境运行；本地字符模型不受此限制。")

    tokenizer = AutoTokenizer.from_pretrained(config["model"], revision=config["revision"])
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    base_model = AutoModelForCausalLM.from_pretrained(
        config["model"],
        revision=config["revision"],
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )
    lora = config["lora"]
    model = get_peft_model(base_model, LoraConfig(
        task_type="CAUSAL_LM",
        r=lora["rank"],
        lora_alpha=lora["alpha"],
        lora_dropout=lora["dropout"],
        target_modules=lora["targetModules"],
    ))

    class Blocks(Dataset):
        def __init__(self, values: List[List[int]]) -> None:
            self.values = values

        def __len__(self) -> int:
            return len(self.values)

        def __getitem__(self, index: int) -> Dict[str, List[int]]:
            return {"input_ids": self.values[index]}

    train_dataset = Blocks(tokenize_blocks(tokenizer, training_texts, config["contextTokens"]))
    eval_dataset = Blocks(tokenize_blocks(tokenizer, evaluation_texts, config["contextTokens"])) if evaluation_texts else None
    args.output.mkdir(parents=True, exist_ok=True)
    has_eval = eval_dataset is not None and len(eval_dataset) > 0
    training_args = TrainingArguments(
        output_dir=str(args.output / "checkpoints"),
        learning_rate=config["learningRate"],
        num_train_epochs=config["maxEpochs"],
        max_steps=args.max_steps or -1,
        per_device_train_batch_size=2,
        per_device_eval_batch_size=2,
        gradient_accumulation_steps=8,
        bf16=True,
        logging_steps=10,
        eval_strategy="steps" if has_eval else "no",
        save_strategy="steps" if has_eval else "no",
        eval_steps=25,
        save_steps=25,
        load_best_model_at_end=has_eval,
        metric_for_best_model="eval_loss" if has_eval else None,
        greater_is_better=False if has_eval else None,
        save_total_limit=2,
        report_to=[],
        seed=corpus["seed"],
        data_seed=corpus["seed"],
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)] if has_eval else [],
    )
    result = trainer.train()
    adapter_dir = args.output / "adapter"
    trainer.model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    metrics = {
        "schemaVersion": 1,
        "model": config["model"],
        "revision": config["revision"],
        "corpusHash": corpus["corpusHash"],
        "fold": args.fold,
        "cluster": args.cluster,
        "trainingChapters": allowed_chapters,
        "bestCheckpoint": trainer.state.best_model_checkpoint,
        "globalStep": trainer.state.global_step,
        "trainMetrics": result.metrics,
    }
    (args.output / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
