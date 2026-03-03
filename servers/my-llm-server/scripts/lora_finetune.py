#!/usr/bin/env python3
"""LoRA 微调脚本（基于 Hugging Face Transformers + PEFT）

用法示例：
python lora_finetune.py \
  --train_file data/train.jsonl \
  --validation_file data/valid.jsonl \
  --model_name_or_path gpt2 \
  --output_dir ./lora_output \
  --num_train_epochs 3 \
  --per_device_train_batch_size 8 \
  --learning_rate 2e-4 \
  --lora_r 8 \
  --lora_alpha 32 \
  --lora_dropout 0.1

说明：脚本适用于因资源有限而只微调 LoRA adapter 的场景。
请根据目标模型选择合适的 tokenizer/model 类型（causal / seq2seq）。
"""

import argparse
import os
from dataclasses import dataclass, field
from typing import Optional

from datasets import load_dataset
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    Trainer,
    TrainingArguments,
    DataCollatorForLanguageModeling,
)

try:
    from peft import LoraConfig, get_peft_model, prepare_model_for_int8_training
except Exception:
    raise


def parse_args():
    parser = argparse.ArgumentParser(description="LoRA fine-tuning script")
    parser.add_argument("--train_file", required=True, help="训练文件（JSONL/CSV/text）")
    parser.add_argument("--validation_file", required=False, help="验证文件（可选）")
    parser.add_argument("--model_name_or_path", required=True, help="基础模型路径或名称")
    parser.add_argument("--output_dir", required=True, help="保存 LoRA adapter 的目录")
    parser.add_argument("--num_train_epochs", type=int, default=3)
    parser.add_argument("--per_device_train_batch_size", type=int, default=8)
    parser.add_argument("--per_device_eval_batch_size", type=int, default=8)
    parser.add_argument("--learning_rate", type=float, default=2e-4)
    parser.add_argument("--weight_decay", type=float, default=0.0)
    parser.add_argument("--logging_steps", type=int, default=50)
    parser.add_argument("--save_steps", type=int, default=500)
    parser.add_argument("--max_seq_length", type=int, default=1024)
    # LoRA params
    parser.add_argument("--lora_r", type=int, default=8)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--lora_dropout", type=float, default=0.1)
    parser.add_argument("--adapter_name", type=str, default="lora_adapter")
    parser.add_argument("--use_int8", action="store_true", help="是否使用 int8 量化以节省显存（需要 bitsandbytes）")
    args = parser.parse_args()
    return args


def load_text_dataset(file_path: str, split_name: str = "train"):
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".json" or ext == ".jsonl":
        ds = load_dataset("json", data_files={split_name: file_path})[split_name]
    elif ext == ".csv":
        ds = load_dataset("csv", data_files={split_name: file_path})[split_name]
    else:
        # plain text, 每行一个样本
        ds = load_dataset("text", data_files={split_name: file_path})[split_name]
    return ds


def preprocess_function(examples, tokenizer, key_name: Optional[str], max_length: int):
    texts = None
    if key_name and key_name in examples:
        texts = examples[key_name]
    else:
        # datasets 的文本列可能是 'text' 或一整行字符串
        texts = examples.get('text') or examples.get('dialog') or examples

    # 如果是 JSONL 并且包含 prompt/response 字段，请在使用前将数据转换成单列文本：prompt + response
    if isinstance(texts, list):
        tokenized = tokenizer(texts, truncation=True, max_length=max_length, padding=False)
    else:
        tokenized = tokenizer([texts], truncation=True, max_length=max_length, padding=False)
    return tokenized


def main():
    args = parse_args()

    # 加载 tokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.model_name_or_path, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.add_special_tokens({"pad_token": "<|pad|>"})

    # 加载模型
    if args.use_int8:
        # 需要 bitsandbytes 和 transformers 支持
        model = AutoModelForCausalLM.from_pretrained(
            args.model_name_or_path,
            load_in_8bit=True,
            device_map="auto",
        )
        model = prepare_model_for_int8_training(model)
    else:
        model = AutoModelForCausalLM.from_pretrained(args.model_name_or_path, device_map="auto")

    # 配置 LoRA
    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        target_modules=["q_proj", "v_proj"],  # 常见于 causal LM 的模块名；根据模型调整
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
    )

    model = get_peft_model(model, lora_config)

    # 加载数据集
    train_ds = load_text_dataset(args.train_file, split_name="train")
    eval_ds = None
    if args.validation_file:
        eval_ds = load_text_dataset(args.validation_file, split_name="validation")

    # 预处理：如果 JSONL 包含 "text" 字段，则使用；否则用户需自行准备好一列文本
    key_name = None
    sample_keys = list(train_ds.column_names) if hasattr(train_ds, "column_names") else []
    if "text" in sample_keys:
        key_name = "text"
    elif "prompt" in sample_keys:
        key_name = "prompt"

    tokenized_train = train_ds.map(
        lambda examples: preprocess_function(examples, tokenizer, key_name, args.max_seq_length),
        batched=True,
        remove_columns=sample_keys if sample_keys else None,
    )

    tokenized_eval = None
    if eval_ds is not None:
        sample_keys = list(eval_ds.column_names) if hasattr(eval_ds, "column_names") else []
        tokenized_eval = eval_ds.map(
            lambda examples: preprocess_function(examples, tokenizer, key_name, args.max_seq_length),
            batched=True,
            remove_columns=sample_keys if sample_keys else None,
        )

    # 数据整理器
    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.per_device_train_batch_size,
        per_device_eval_batch_size=args.per_device_eval_batch_size,
        num_train_epochs=args.num_train_epochs,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        fp16=not args.use_int8,
        push_to_hub=False,
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_train,
        eval_dataset=tokenized_eval,
        data_collator=data_collator,
        tokenizer=tokenizer,
    )

    trainer.train()

    # 保存 LoRA adapter
    os.makedirs(args.output_dir, exist_ok=True)
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    print(f"LoRA adapter saved to {args.output_dir}")


if __name__ == "__main__":
    main()
