LoRA 微调说明
=================

这个目录提供一个基于 Hugging Face Transformers + PEFT 的 LoRA 微调脚本 `lora_finetune.py`。脚本适用于在资源受限时只训练 LoRA adapter，而保持主模型权重不变。

快速开始（建议使用虚拟环境）
-----------------

1. 创建并激活 Python 虚拟环境：

```bash
python -m venv .venv
source .venv/bin/activate
```

2. 安装依赖（CPU 或 GPU 环境）

```bash
pip install -U pip
pip install transformers datasets accelerate peft
# 如果使用 bitsandbytes/int8，需要额外安装：
# pip install bitsandbytes
```

3. 准备数据

数据格式可以是 JSONL、CSV、或纯文本。脚本期望每条样本为一整段文本（例如 prompt+response 或 问题+答案）。如果数据是多字段的 JSON，请先合并成一列文本字段（例如 `text`）。

示例 JSONL（每行 JSON）:

{"text": "病人主诉：咳嗽两周。回答：可能的原因..."}

4. 运行微调

```bash
python lora_finetune.py \
  --train_file data/train.jsonl \
  --validation_file data/valid.jsonl \
  --model_name_or_path gpt2 \
  --output_dir ./lora_output \
  --num_train_epochs 3 \
  --per_device_train_batch_size 4 \
  --learning_rate 2e-4 \
  --lora_r 8 \
  --lora_alpha 32 \
  --lora_dropout 0.1
```

常见注意事项
---------
- 如果使用大型模型（如 Llama / LLaMA 2 / Falcon 等），请确认你有合适的算力，并考虑使用 `--use_int8` 以及 `bitsandbytes` 安装以节省显存。
- `target_modules` 在脚本中默认是 `["q_proj","v_proj"]`，这对许多 causal LM 有效；对于其他模型（如 Falcon/ MPT）需要根据模块名调整。
- 脚本使用 Hugging Face 的 `Trainer` 做示例训练流程；在需要更复杂的训练策略时可以改用 `accelerate` 的自定义训练循环。

下一步建议
---------
- 将训练脚本接入后端接口以支持通过上传数据从前端触发训练（注意安全与资源隔离）。
- 为训练任务加入队列与监控（例如使用 Redis + worker），避免在生产服务器上直接运行长期训练任务。
- 保存并管理 LoRA adapter 的版本（例如命名规则、元数据 JSON），便于回滚与复用。

如果需要，我可以：
- 将训练触发接口添加到 `servers/my-llm-server`（包含上传、验证、触发训练任务与查看训练日志）；
- 为前端添加上传训练数据与触发训练的 UI。
