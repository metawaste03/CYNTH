# Project Vision

## Purpose

Cynth is a local-first, AI-assisted editorial engine built to support the production of articles for the EveryFiveDays website. It exists to help a human editorial team produce a higher volume of high-quality, consistent content without surrendering editorial judgment to automation. Cynth is a tool that assists the writing and editing process — it does not replace the human editor.

## Scope

This document defines the guiding vision for Cynth as a whole. It does not define version-specific scope (see [02_VERSION1_SCOPE.md](02_VERSION1_SCOPE.md)) or technical architecture (see [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md)). It is intended to be a stable reference point that future milestones can be checked against.

## Responsibilities

The vision, as currently understood, commits Cynth to the following:

- **Local-first operation.** Cynth is designed to run locally rather than depend on a hosted, multi-tenant service, keeping editorial data and drafts under the operator's control.
- **AI-assisted, not AI-automated.** Cynth generates drafts, suggestions, and analysis. It does not autonomously publish content.
- **Editorial consistency.** Cynth should help maintain a consistent voice, quality bar, and set of standards across articles and across authors.
- **Author identity preservation.** Cynth should help preserve distinct author identities where the site uses multiple bylines, rather than flattening all output into a single generic voice.
- **SEO readiness.** Cynth should help articles meet baseline SEO expectations as part of the editorial process, not as an afterthought.
- **Human oversight as a non-negotiable checkpoint.** No article should reach publication without a human reviewing and approving it.

## Current Status

This is Milestone 0. No application code, prompts, database schema, or UI has been built. This document records the intent behind the project so that later, concrete decisions can be checked against it.

## Future Expansion

As the project matures, this document may be revisited to confirm that implementation decisions remain aligned with the original vision. Any material change to the vision itself should be recorded here and reflected in the [CHANGELOG](CHANGELOG.md).

## TODO

- TODO: Confirm long-term success criteria for the project (what does "working well" look like a year in?).
- TODO: Confirm whether Cynth is intended for use beyond EveryFiveDays (single-site tool vs. multi-site platform).
- TODO: Confirm ownership and decision-making authority for editorial standards referenced here.
