# 08 — OPERATOR PROMPTS

Copy-paste texts for the Claude Code prompt bar. One session = one prompt.
(The operator may write in Italian; these work verbatim either way.)

## A. Start-of-project session (first session after merging the workflow)

```
Read CLAUDE.md and docs/workflow/STATE.md, then execute the current phase of
docs/workflow/05-ROADMAP.md following docs/workflow/07-SESSION-PROTOCOL.md.
Verify per docs/workflow/06-VERIFICATION.md, update STATE.md, commit and push.
```

## B. Every subsequent work session (the default prompt)

```
Continue the VFX SYNTECH workflow: read CLAUDE.md and docs/workflow/STATE.md,
execute the next step / current phase per the session protocol, verify,
update STATE.md, commit and push.
```

## C. Bug report / change request (fill the placeholder)

```
Before anything, read CLAUDE.md and docs/workflow/STATE.md. Then, without
starting a new roadmap phase, handle this: <describe the problem or change>.
Follow the session protocol: verify, log it in STATE.md, commit and push.
```

## D. Delivering the 6 images (logo + 5 effect covers)

Upload the images with this prompt:

```
Read CLAUDE.md and docs/workflow/STATE.md. I am uploading the final visual
assets: the app logo and one cover image per effect (file names tell you
which is which). Execute the assets part of Phase 10: put the logo in the
top-left of the sidebar and the covers on the right-sidebar effect cards,
per docs/workflow/03-SPEC-SHELL.md §7. Verify, update STATE.md, commit, push.
```

## E. Status check (no code changes)

```
Read docs/workflow/STATE.md and give me a plain-language status report:
what works today, what phase we are in, what is next, and any open risks.
Do not change any code.
```

## Notes for the operator

- One phase per session is the intended pace. If a session ends with the
  phase incomplete, just run prompt **B** again in a new session.
- Always merge the previous session's branch into `main` before starting a
  new session (or start the new session from that branch), so the next
  session sees the latest STATE.md.
- Nothing else needs to be uploaded: the five effect HTMLs already live in
  the repo at `public/effects/`. Only the 6 images (prompt D) remain.
