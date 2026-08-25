# WordPress Integration

## Purpose

This document defines the intent behind Cynth's integration with WordPress, the platform on which EveryFiveDays is presumed to be published, so that approved articles can reach the live site.

## Scope

This document covers the conceptual publishing hand-off from Cynth to WordPress. It does not define specific API calls, authentication mechanisms, or plugin choices.

## Responsibilities

The WordPress integration, once implemented, is expected to:

- Receive an article only after it has passed the Quality Gate ([11_QUALITY_GATE.md](11_QUALITY_GATE.md)) and been approved by a human editor.
- Preserve author attribution as managed by the Author System ([07_AUTHOR_SYSTEM.md](07_AUTHOR_SYSTEM.md)).
- Never auto-publish without explicit human confirmation, consistent with [00_PROJECT_VISION.md](00_PROJECT_VISION.md).

## Current Status

**Not yet defined or confirmed.** It has not been confirmed how EveryFiveDays' WordPress instance is hosted, authenticated against, or otherwise accessed. No integration code exists.

## Future Expansion

Once WordPress access details are confirmed by the site owner, this document should describe the publishing hand-off flow (still without embedding credentials or implementation code).

## TODO

- TODO: Confirm EveryFiveDays' WordPress hosting setup (self-hosted vs. WordPress.com, REST API availability).
- TODO: Confirm authentication method to be used (application passwords, OAuth, etc.) — no credentials are to be stored in this binder.
- TODO: Define what publish states exist (draft, pending review, scheduled, published) and how Cynth maps to them.
- TODO: Define rollback/undo expectations if a publish needs to be reversed.
