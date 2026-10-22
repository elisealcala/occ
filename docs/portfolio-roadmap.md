# Full-stack portfolio roadmap

[Back to the README](../README.md)

## Goal

Make OCC Sandbox a publicly accessible full-stack showcase: a visitor can open one link, understand a lost update, reproduce a conflict, see their draft survive, and find the code and evidence behind the behavior.

The implementation already demonstrates the core engineering. The remaining work focuses on the first-time experience, public hosting, and explaining the design decisions. Unchecked items below are planned work.

## Current baseline

Reviewed on **October 22, 2026**, against the local working tree.

| Area | Existing capability | Evidence |
| --- | --- | --- |
| Editing experience | Two independent rich-text clients, autosave, polling, configurable delays, and conflict recovery | [Client panel](../src/components/client-panel.tsx), [client controller](../src/lib/client-controller.ts) |
| Persistence | Conditional SQLite writes, transactionally stored checkpoints, and mutation receipts for safe retries | [Database repository](../src/server/database.ts) |
| Guided learning | Five scenarios covering collisions, lost updates, slow responses, external writers, and restoration | [Scenarios](../src/lib/scenarios.ts) |
| Local verification | Formatting, lint, typechecking, 45 unit tests, 8 Chromium browser tests, and the production build passed | [Unit tests](../tests/unit), [browser tests](../tests/e2e/sandbox.spec.ts), [commands](../README.md#verification) |
| Continuous integration | Workflow configured for quality checks, unit tests, and production builds | [Code quality workflow](../.github/workflows/quality.yml) |

The verification results are a dated local baseline. Browser tests currently use a development server and desktop Chromium; hosted behavior, mobile layouts, and accessibility still need dedicated verification. A public demo is not configured in this repository yet.

## Milestone 1 — Make the first minute clear

**Priority: first implementation milestone, together with public deployment.**

The guided scenarios currently appear below the editors, server state, and checkpoint history. Bring the easiest introduction into the opening view.

- [ ] Add a prominent **Run a 60-second demo** action near the headline.
- [ ] Guide the visitor through a lost update with protection off, then a rejected stale save with protection on, then recovery of the preserved draft.
- [ ] Keep the relevant client, server result, and explanation visible at each step, including on narrow screens.
- [ ] Explain revisions and conflicts in plain language before exposing advanced timing controls.
- [ ] Derive scenario completion messages from actual outcomes; show failures accurately and allow retry. Current scenario copy assumes specific successful outcomes and revision numbers.
- [ ] Prevent manual actions from silently invalidating a running guided sequence, or explicitly stop the sequence when the visitor takes control.

**Complete when:** a first-time visitor can explain what was overwritten, why the protected save was rejected, and where the losing draft remains after one short walkthrough.

Starting points: [page shell](../src/components/sandbox/sandbox-shell.tsx), [experiment session](../src/components/sandbox/experiment-session.tsx), [scenario panel](../src/components/sandbox/scenario-panel.tsx), [scenario runner](../src/lib/scenarios.ts).

## Milestone 2 — Publish a dependable demo

**Priority: required before linking a live demo from the portfolio.**

The current application deliberately binds to loopback and accepts browser writes only from localhost origins. Public deployment requires explicit configuration changes.

- [ ] Configure the public application origin while retaining checks against unintended cross-origin browser writes.
- [ ] Make the production hostname and port compatible with the selected host while keeping local development convenient.
- [ ] Deploy one Node.js instance with persistent storage for SQLite, and configure `OCC_DB_PATH` to use that storage.
- [ ] Preserve independent visitor experiments and document that demo content is disposable.
- [ ] Add request throttling and limits on experiment creation and retained data.
- [ ] Expire experiments and their checkpoints, events, and receipts together; preserve retry receipts for the lifetime of an active experiment.
- [ ] Make an expired experiment recover cleanly into a fresh session, with an understandable message.
- [ ] Verify the public HTTPS URL, browser writes, reset behavior, and database persistence across an application restart.
- [ ] Update local-only UI labels and metadata for the hosted environment.

**Complete when:** a new visitor can run every scenario from the public URL, separate visitors do not interfere with each other's experiments, and the storage lifecycle is bounded and documented.

Recommended initial deployment: one long-running Node.js instance with a persistent SQLite disk. This preserves the current implementation and keeps the hosting model easy to explain. Multiple application instances would require revisiting the database arrangement. See the official [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting).

Starting points: [origin guard](../src/server/http.ts), [server scripts](../package.json), [database repository](../src/server/database.ts), [experiment persistence](../src/lib/experiment-session.ts).

## Milestone 3 — Explain the engineering in the repository

**Priority: required for the portfolio release.**

- [ ] Add the deployed demo link, a representative screenshot, and a short walkthrough recording near the top of the README.
- [ ] Write a concise case study covering the problem, implementation scope, personal contribution, difficult edge cases, and lessons learned.
- [ ] Add an architecture diagram connecting the React draft, client controller, HTTP request, SQLite transaction, and acknowledgment.
- [ ] Explain the tradeoffs: serialized saves, polling, SQLite, mutation receipts, and explicit conflict resolution. Describe how OCC differs from automatic text merging.
- [ ] Describe the original inspiration in terms an external reviewer can understand without internal repository names or project history.
- [ ] Link the source repository, case study, and author's portfolio from the app.
- [ ] Add a social preview image and hosted-page metadata for shared links.
- [ ] State verified outcomes and limitations accurately, including the single-instance deployment model and the absence of automatic merging.

**Complete when:** a reviewer can understand the project from the README, trace a save through the architecture, and discuss the implementation's tradeoffs without needing this chat.

Starting points: [README](../README.md), [architecture notes](../src/components/sandbox/architecture-notes.tsx), [page shell](../src/components/sandbox/sandbox-shell.tsx), [metadata](../src/app/layout.tsx).

## Milestone 4 — Verify the showcase experience

**Priority: required for the portfolio release.**

- [ ] Include the existing browser suite in CI with its browser installation step.
- [ ] Add a production-server smoke check and verify the deployed domain's origin configuration.
- [ ] Check the guided experience at phone, tablet, and desktop widths, including long content and conflict states.
- [ ] Cover the main workflow in Firefox and WebKit as well as Chromium.
- [ ] Check keyboard navigation, focus visibility, control names, status announcements, reduced motion, and text contrast; add automated accessibility checks where useful.
- [ ] Cover guided-scenario failures so the explanation cannot announce a successful save after an unsuccessful request.
- [ ] Record the release verification results and keep the README aligned with what CI actually runs.

**Complete when:** the deployed walkthrough succeeds, meaningful failure states are understandable, the core experience works across the target browsers and screen sizes, and CI checks the browser workflow.

Starting points: [CI workflow](../.github/workflows/quality.yml), [Playwright configuration](../playwright.config.ts), [browser suite](../tests/e2e/sandbox.spec.ts).

## Optional distinction — Show exactly what was protected

**Priority: after the release requirements above.**

- [ ] Add a draft-versus-server comparison that highlights the content a stale save would overwrite or a conflict preserved.
- [ ] Connect the comparison to the relevant revision and timeline event.
- [ ] Keep recovery actions explicit and preserve the local draft until the visitor chooses what to do.

**Complete when:** a visitor can identify the difference between their draft and the server version, understand why the stale revision was rejected, and understand the consequence of adopting the server version.

## Release checklist

- [ ] Public demo URL is linked from the README and portfolio.
- [ ] The first-minute walkthrough is discoverable and accurate.
- [ ] Hosting, experiment isolation, and data cleanup are verified.
- [ ] Case study, architecture diagram, screenshot, and recording are available.
- [ ] Release checks pass and their scope is documented.

Update this roadmap as work lands. Mark items complete only when their implementation and relevant verification are available in the repository.
