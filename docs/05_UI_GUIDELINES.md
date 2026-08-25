# UI Guidelines

## Purpose

This document is intended to define the visual and interaction design guidelines for any user interface Cynth eventually presents to its human editors.

## Scope

This document covers UI/UX principles only, once they exist: layout, interaction patterns, and design language. It does not cover the underlying application architecture (see [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md)).

## Responsibilities

Once defined, UI guidelines should ensure that any interface:

- Makes the human editor's review and approval role visible and central, not incidental.
- Clearly distinguishes AI-generated content from human-edited content.
- Surfaces quality gate and SEO engine results in a way an editor can act on quickly.
- Maintains a consistent design language across all editorial screens.

## Current Status

**Decision Lock (2026-08-06) — approved by the Product Owner:**

- **Application type:** Local web application.
- **Primary layout:** Permanent left navigation, a main content area, fully responsive.
- **Primary workflow:** Dashboard → New Article → Editorial Review → Manual Publish.
- **Design goals:** Fast, simple, minimal, readable, human-first. A professional editorial interface.

Milestone 1 built the first implementation of this layout: a permanent left sidebar (icons + active-page highlight) that collapses to a toggleable drawer below 880px, a shared page-header pattern, and shared placeholder/empty-state and card components so future real content slots into an already-consistent layout. See [13_MILESTONES.md](13_MILESTONES.md) for milestone status.

## Future Expansion

Visual identity (palette, typography, branding) and deeper interaction patterns should be refined once implementation begins and can be validated with the actual editor-user.

## TODO

- TODO: Gather UI/UX preferences or constraints from the intended editor-user(s) beyond the Decision Lock baseline.
- TODO: Define a formal accessibility target (e.g. WCAG level).
- TODO: Define visual identity (color palette, typography, branding).
