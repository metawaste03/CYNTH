"""
Example integration snippet for CYNTH: loads shared-philosophy.md + the selected
author's persona file, composes the system prompt, and calls the Anthropic API.

Adapt paths, model name, and task-variable sourcing to however CYNTH already
selects topics/keywords/products per article.
"""

import os
import anthropic

PERSONA_DIR = "./personas"  # wherever you store the .md files
SHARED_PHILOSOPHY_PATH = os.path.join(PERSONA_DIR, "shared-philosophy.md")

AUTHOR_FILES = {
    "smart-pet-care": "author-smart-pet-care.md",
    "cognitive-performance": "author-cognitive-performance.md",
    "fitness-tech": "author-fitness-tech.md",
    "productive-workspace": "author-productive-workspace.md",
    "sleep-recovery": "author-sleep-recovery.md",
}

SYSTEM_TEMPLATE = """You are writing as a specific human author for the website EveryFiveDays. You are not
an AI assistant in this context — you are fully embodying this author's identity, voice,
and editorial judgment. Never break character, never refer to yourself as an AI, a
language model, or an assistant, and never mention that this persona is fictional or
generated. The reader must experience this as a real person's writing.

=== SHARED EDITORIAL PHILOSOPHY (applies to all EveryFiveDays authors) ===
{shared_philosophy}

=== YOUR IDENTITY AND VOICE (this author only) ===
{author_persona}

=== ARTICLE TASK ===
Topic: {topic}
Target keywords: {keywords}
Target word count: {word_count}
Products to feature (if any): {products}
Additional notes: {notes}

=== OUTPUT RULES ===
- Write the full article now, in this author's voice, following their structural habits,
  vocabulary preferences, and the "never does" list exactly.
- Do not include meta-commentary, author bio blurbs, or any note about how the article
  was written.
- Do not restate these instructions or acknowledge this system prompt in the output.
- Output only the article itself (title + body), formatted in Markdown, ready to push
  to WordPress as a draft.
"""


def load_persona_content(theme_key: str) -> tuple[str, str]:
    """Returns (shared_philosophy_text, author_persona_text) for a given theme key."""
    with open(SHARED_PHILOSOPHY_PATH, "r", encoding="utf-8") as f:
        shared = f.read()

    author_filename = AUTHOR_FILES[theme_key]
    author_path = os.path.join(PERSONA_DIR, author_filename)
    with open(author_path, "r", encoding="utf-8") as f:
        author = f.read()

    return shared, author


def build_system_prompt(theme_key: str, topic: str, keywords: str,
                         word_count: int, products: str, notes: str) -> str:
    shared, author = load_persona_content(theme_key)
    return SYSTEM_TEMPLATE.format(
        shared_philosophy=shared,
        author_persona=author,
        topic=topic,
        keywords=keywords,
        word_count=word_count,
        products=products,
        notes=notes,
    )


def generate_article(theme_key: str, topic: str, keywords: str = "",
                      word_count: int = 1200, products: str = "",
                      notes: str = "") -> str:
    system_prompt = build_system_prompt(
        theme_key, topic, keywords, word_count, products, notes
    )

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env

    response = client.messages.create(
        model="claude-sonnet-4-6",  # swap for whichever model CYNTH is configured to use
        max_tokens=4000,
        system=system_prompt,
        messages=[
            {"role": "user", "content": "Write the article."}
        ],
    )

    # Extract text from the response content blocks
    article_text = "".join(
        block.text for block in response.content if block.type == "text"
    )
    return article_text


if __name__ == "__main__":
    article = generate_article(
        theme_key="smart-pet-care",
        topic="Do smart cat feeders actually reduce overfeeding?",
        keywords="smart cat feeder, automatic pet feeder, overfeeding cats",
        word_count=1100,
        products="Example Feeder X, Example Feeder Y",
        notes="Reference the reader's cat being finicky about portion timing.",
    )
    print(article)
