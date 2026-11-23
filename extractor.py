"""Candidate generation and ranking shared by training and the web app."""

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

WORD = re.compile(r"[^\W_]+(?:[‐‑–-][^\W_]+)*(?:['’][^\W_]+)?", re.UNICODE)
STOP = frozenset("""
a about above across after again against all almost along already also although am among an and any are around as at away
be because been before being below between both but by can cannot could did do does doing done down during each either else
enough even ever every few first for from further get gets given go had has have having he her here hers him his how however
i if in into is it its itself just last less many may me might more most much must my near neither never next no nor not now
of off often on once one only onto or other our ours out over own per rather same see several shall she should since so some
such than that the their them then there these they this those through thus till to together too toward under until up upon us
use used uses using very via was we were what whatever when where whether which while who whom whose why will with within
without would you your according addition another based case compared considered especially example found generally instead
including mostly obtained paper possible present presented proposed provides respectively results show shown study therefore
three two well work approach method methods new described discuss discusses known performed regard related results similar
said set take taken make made makes using used use various yet fairly hence indeed whilst thereof thereby able
""".split())
CONNECTORS = frozenset("of for in and to on with".split())
WEAK_EDGE = frozenset("""
algorithm algorithms alternative analysis different efficient effective evaluation generated high important increased large
major measured multiple particular provides relatively simple small specific standard suitable useful
""".split())
METHODS = ("learned", "tfidf", "rake")
FEATURES = (
    "log_frequency", "log_first_position", "idf", "mean_word_idf", "log_rake",
    "two_words", "three_words", "four_words", "title_match", "weak_edge",
    "nested_in_similarly_frequent_phrase", "has_connector", "log_mean_token_length",
)
MAX_WORDS = 4


def normalize_token(word):
    word = unicodedata.normalize("NFKC", word).casefold().replace("’", "'")
    word = re.sub(r"[‐‑–]", "-", word)
    return word.removesuffix("'s")


def canonical(phrase):
    return " ".join(normalize_token(word.group()) for word in WORD.finditer(phrase))


def is_content(word):
    return word not in STOP and len(word) > 1 and any(char.isalpha() for char in word)


@dataclass
class Candidate:
    words: tuple[str, ...]
    text: str
    first: int
    title: bool
    spans: list[tuple[int, int]] = field(default_factory=list)


def tokens_for(text):
    return list(WORD.finditer(text))


def candidate_index(text, title_end=0):
    matches = tokens_for(text)
    words = [normalize_token(match.group()) for match in matches]
    content = [is_content(word) for word in words]
    breaks = [True] + [
        gap != "" and (not gap.isspace() or "\n" in gap or "\r" in gap)
        for left, right in zip(matches, matches[1:])
        for gap in (text[left.end():right.start()],)
    ]
    candidates = {}
    for start, can_start in enumerate(content):
        if not can_start:
            continue
        left = matches[start].start()
        for end in range(start, min(start + MAX_WORDS, len(words))):
            if end > start and (breaks[end] or not (content[end] or words[end] in CONNECTORS)):
                break
            if not content[end]:
                continue
            key = tuple(words[start:end + 1])
            right = matches[end].end()
            if key not in candidates:
                candidates[key] = Candidate(key, text[left:right], start, bool(title_end and right <= title_end))
            candidates[key].spans.append((left, right))

    # RAKE counts how often a word shares a run with other content words.
    degree, frequency = Counter(), Counter()
    run = []
    for index, word in enumerate(words):
        if breaks[index] or not content[index]:
            for member in run:
                degree[member] += len(run)
                frequency[member] += 1
            run.clear()
        if content[index]:
            run.append(word)
    for member in run:
        degree[member] += len(run)
        frequency[member] += 1
    return candidates, {word: degree[word] / frequency[word] for word in frequency}, len(matches)


def fit_idf(indexes):
    frequency = Counter()
    for index in indexes:
        frequency.update(" ".join(key) for key in index)
    count = len(indexes)
    return {"documents": count, "terms": {key: value for key, value in frequency.items() if value >= 2}}


def analyze(text, model, title_end=0):
    candidates, rake, word_count = candidate_index(text, title_end)
    document_counts = model["idf"]["terms"]
    document_count = model["idf"]["documents"]

    def idf(term):
        return 1 + math.log((document_count + 1) / (document_counts.get(term, 1) + 1))

    larger_frequency = Counter()
    for key, candidate in candidates.items():
        for sub in (key[1:], key[:-1]):
            larger_frequency[sub] = max(larger_frequency[sub], len(candidate.spans))

    rows = []
    for key, candidate in candidates.items():
        count = len(candidate.spans)
        length = len(key)
        term_idf = idf(" ".join(key))
        rake_score = sum(rake.get(word, 0) for word in key)
        features = (
            math.log1p(count), math.log1p(candidate.first), term_idf,
            sum(idf(word) for word in key) / length, math.log1p(rake_score),
            int(length == 2), int(length == 3), int(length == 4), int(candidate.title),
            int(key[0] in WEAK_EDGE or key[-1] in WEAK_EDGE),
            larger_frequency[key] / count, int(any(word in CONNECTORS for word in key)),
            math.log1p(sum(map(len, key)) / length),
        )
        rows.append((candidate, features, (1 + math.log(count)) * term_idf, rake_score))
    return rows, word_count


def rank_rows(rows, model, method):
    if method not in METHODS:
        raise ValueError("Choose a valid ranking method.")
    weights = model.get("weights", ())
    scales = model.get("scales", ())
    means = model.get("means", ())
    centered_weights = [weight / scale for weight, scale in zip(weights, scales)]
    intercept = model.get("bias", 0) - sum(weight * mean for weight, mean in zip(centered_weights, means))
    scored = []
    for candidate, features, tfidf, rake in rows:
        if method == "learned":
            logit = intercept + sum(value * weight for value, weight in zip(features, centered_weights))
            score = 100 / (1 + math.exp(-max(-40, min(40, logit))))
        else:
            score = tfidf if method == "tfidf" else rake
        scored.append((candidate, score))
    return sorted(scored, key=lambda item: (-item[1], item[0].first, len(item[0].words), item[0].words))


def extract(text, model, method, limit):
    first_line, separator, _ = text.partition("\n")
    title_end = len(first_line) if separator and 1 <= len(first_line.split()) <= 22 else 0
    rows, word_count = analyze(text, model, title_end)
    results = rank_rows(rows, model, method)[:limit]
    return {
        "words": word_count,
        "candidates": len(rows),
        "results": [
            {"term": candidate.text, "score": round(score, 2), "count": len(candidate.spans),
             "length": len(candidate.words), "spans": candidate.spans}
            for candidate, score in results
        ],
    }
