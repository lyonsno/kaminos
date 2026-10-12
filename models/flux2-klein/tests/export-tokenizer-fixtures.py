"""Write Qwen tokenizer parity fixtures from the pinned Hugging Face tokenizer.

Each case records the Flux2KleinPipeline framing (chat template with thinking
disabled, right padding to 512) and the resulting ids and mask, so the browser
tokenizer can be checked without Python.

  python export-tokenizer-fixtures.py --model-dir <hf snapshot> --out fixtures/qwen-tokenizer.json
"""
import argparse
import json
from transformers import AutoTokenizer

PROMPTS = [
    "A small brass toy steam locomotive, isolated on a plain white background, studio product photo",
    "A neon sign that reads OPEN ALL NIGHT above a rainy diner doorway at night",
    "it's 3:45pm and the café's naïve barista can't find 12,345 crème brûlées!!",
    "  leading spaces,\ttabs\tand\nnew\n\nlines   trailing  ",
    "emoji 🚂🔥 and CJK 火车头 and Ελληνικά and العربية",
    "Mixed-case 'Ll 'VE 'S 'd contractions and URLs like https://example.com/a_b?c=d#e",
    "numbers 0123456789 1e-6 3.14159 -42 +7 100%",
    "<|im_start|> literal special token text <think> inside a prompt",
    "",
    "x" * 3000,
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    tok = AutoTokenizer.from_pretrained(args.model_dir, subfolder="tokenizer")
    cases = []
    for prompt in PROMPTS:
        text = tok.apply_chat_template([{"role": "user", "content": prompt}], tokenize=False,
                                       add_generation_prompt=True, enable_thinking=False)
        enc = tok(text, padding="max_length", truncation=True, max_length=512)
        cases.append({"prompt": prompt, "text": text, "input_ids": enc["input_ids"], "attention_mask": enc["attention_mask"]})
    json.dump({"tokenizer_class": type(tok).__name__, "cases": cases}, open(args.out, "w"), ensure_ascii=False)


if __name__ == "__main__":
    main()
