"""Train and evaluate the Termfolio ranker on the original Inspec splits."""

import argparse
import hashlib
import io
import json
import re
import statistics
import tarfile
import unicodedata
import zipfile
from collections import Counter
from pathlib import Path

import numpy as np

from extractor import FEATURES, METHODS, analyze, candidate_index, canonical, fit_idf, rank_rows

ROOT = Path(__file__).resolve().parent
SPLITS = {"train": "Training", "validation": "Validation", "test": "Test"}


def decode(data):
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def load_corpus(path):
    documents, cleaning = {}, {}
    seen = set()
    with tarfile.open(path) as archive:
        for split, name in SPLITS.items():
            stream = archive.extractfile(f"Hulth2003/{name}.zip")
            with zipfile.ZipFile(io.BytesIO(stream.read())) as source:
                files = set(source.namelist())
                counts = Counter({"raw": 0, "missing": 0, "duplicate": 0})
                dataset = []
                for filename in sorted(files):
                    if not filename.endswith(".abstr"):
                        continue
                    counts["raw"] += 1
                    label_file = filename.removesuffix(".abstr") + ".uncontr"
                    if label_file not in files:
                        counts["missing"] += 1
                        continue
                    text = unicodedata.normalize("NFKC", decode(source.read(filename)))
                    text = re.sub(r"\r?\n[ \t]+(?=\S)", " ", text)
                    text = "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())
                    labels = {canonical(label) for label in decode(source.read(label_file)).split(";")}
                    labels.discard("")
                    fingerprint = canonical(text)
                    if not fingerprint or not labels:
                        counts["missing"] += 1
                        continue
                    if fingerprint in seen:
                        counts["duplicate"] += 1
                        continue
                    seen.add(fingerprint)
                    first_line, separator, _ = text.partition("\n")
                    title_end = len(first_line) if separator and 1 <= len(first_line.split()) <= 22 else 0
                    dataset.append((text, labels, title_end))
                documents[split] = dataset
                cleaning[split] = dict(counts)
    return documents, cleaning


def prepare(dataset, model):
    return [(analyze(text, model, title), labels) for text, labels, title in dataset]


def gold_matches(rows, labels):
    return {" ".join(candidate.words) for candidate, *_ in rows} & labels


def eda(prepared, cleaning):
    labels_count, length_bins = Counter(), Counter()
    split_stats = {}
    for split, docs in prepared.items():
        words = [count for (_, count), _ in docs]
        gold = sum(len(labels) for _, labels in docs)
        cover = sum(len(gold_matches(rows, labels)) for (rows, _), labels in docs)
        split_stats[split] = {
            **cleaning[split], "documents": len(docs), "median_words": statistics.median(words),
            "mean_gold": round(gold / len(docs), 2), "candidate_coverage": round(cover / gold, 4),
        }
        for word_count in words:
            length_bins[min(word_count // 50, 5)] += 1
        for _, labels in docs:
            labels_count.update(min(len(label.split()), 5) for label in labels)
    return {"splits": split_stats, "document_lengths": dict(sorted(length_bins.items())),
            "reference_lengths": dict(sorted(labels_count.items()))}


def scores_for(prepared, model, method, cutoffs=(5, 10)):
    totals = {k: np.zeros(3) for k in cutoffs}
    for (rows, _), labels in prepared:
        ordered = rank_rows(rows, model, method)
        for k in cutoffs:
            predicted = {" ".join(candidate.words) for candidate, _ in ordered[:k]}
            hits = len(predicted & labels)
            precision = hits / len(predicted) if predicted else 0
            recall = hits / len(labels)
            f1 = 2 * precision * recall / (precision + recall) if hits else 0
            totals[k] += [precision, recall, f1]
    return {str(k): dict(zip(("precision", "recall", "f1"), (totals[k] / len(prepared)).round(5).tolist()))
            for k in cutoffs}


def train(prepared, model):
    features, labels = [], []
    for (rows, _), gold in prepared["train"]:
        for candidate, values, *_ in rows:
            features.append(values)
            labels.append(" ".join(candidate.words) in gold)
    x, y = np.asarray(features, dtype=np.float64), np.asarray(labels, dtype=np.float64)
    means, scales = x.mean(axis=0), x.std(axis=0).clip(min=1e-6)
    x = (x - means) / scales
    weights = np.zeros(len(FEATURES))
    bias = float(np.log(y.mean() / (1 - y.mean())))
    rng = np.random.default_rng(42)
    best, history = None, []
    for epoch in range(1, 21):
        order = rng.permutation(len(x))
        for offset in range(0, len(x), 2048):
            indices = order[offset:offset + 2048]
            batch, targets = x[indices], y[indices]
            error = 1 / (1 + np.exp(-(batch @ weights + bias).clip(-40, 40))) - targets
            weights -= 0.28 * (batch.T @ error / len(batch) + 0.0005 * weights)
            bias -= 0.28 * error.mean()
        if epoch not in (1, 2, 4, 8, 12, 16, 20):
            continue
        current = {**model, "weights": weights.tolist(), "bias": float(bias), "epoch": epoch,
                   "means": means.tolist(), "scales": scales.tolist()}
        f1 = scores_for(prepared["validation"], current, "learned", (10,))["10"]["f1"]
        history.append({"epoch": epoch, "validation_f1_at_10": f1})
        if best is None or f1 > best[0]:
            best = f1, current
    return best[1], {"candidates": len(y), "positives": int(y.sum()), "checkpoints": history}


def write_json(path, data, indent=None):
    path.parent.mkdir(exist_ok=True, parents=True)
    path.write_text(json.dumps(data, indent=indent) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=ROOT / "data/Hulth2003.tar.gz")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    args = parser.parse_args()
    docs, cleaning = load_corpus(args.dataset)
    model = {"features": FEATURES, "idf": fit_idf([candidate_index(text, title)[0] for text, _, title in docs["train"]])}
    prepared = {split: prepare(dataset, model) for split, dataset in docs.items()}
    model, training_stats = train(prepared, model)
    results = {method: scores_for(prepared["test"], model, method) for method in METHODS}
    report = {"dataset": "Inspec (Hulth 2003)", "sha256": hashlib.sha256(args.dataset.read_bytes()).hexdigest(),
              "eda": eda(prepared, cleaning), "training": training_stats, "chosen_epoch": model["epoch"],
              "held_out_test": results}
    write_json(args.output / "model.json", model)
    write_json(args.output / "evaluation.json", report, 2)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
