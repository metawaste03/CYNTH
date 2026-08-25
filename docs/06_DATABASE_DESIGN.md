# Database Design

## Purpose

This document is intended to define how Cynth persists data — articles, authors, drafts, review state, and related editorial records — once a database design has actually been decided.

## Scope

This document covers data persistence design only. It does not cover the in-memory or file-based structures used by `data/` (article types, authors, products) at the documentation stage, nor application architecture broadly (see [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md)).

## Responsibilities

Once defined, the database design should account for:

- Storage of article drafts and their revision history.
- Storage of author identity/profile data (see [07_AUTHOR_SYSTEM.md](07_AUTHOR_SYSTEM.md)).
- Storage of quality gate and SEO review results per article.
- Support for the local-first principle established in [00_PROJECT_VISION.md](00_PROJECT_VISION.md).

## Current Status

**No schema exists.** No tables, fields, relationships, or storage engine have been chosen. The `database/` directory exists as a placeholder in the folder structure only. Per this milestone's constraints, no schema is to be invented, and no database (e.g. SQLite) is to be installed or initialized.

## Future Expansion

A concrete schema should be proposed here once Version 1 scope defines what data the system actually needs to track, and once the system architecture defines how that data will be accessed.

## TODO

- TODO: Choose a storage engine consistent with the local-first principle.
- TODO: Define the article data model (fields, states, revision history).
- TODO: Define the author data model.
- TODO: Define how quality gate and SEO results are stored and linked to articles.
- TODO: Define backup/versioning strategy for local data.
