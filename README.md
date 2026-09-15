# OCC Sandbox

A local laboratory for **optimistic concurrency control**: two independent React rich-text editors, a Next.js server, and a real SQLite database. Toggle protection, pause polling, delay requests, and watch saves compete.

## Quick start

Requirements: **Node.js 22.22 or later** and **pnpm 10.9 or later**. If pnpm is not installed, install the version pinned by this project:

```sh
npm install --global pnpm@10.9.0
```

Clone the repository and start the app:

```sh
git clone https://github.com/elisealcala/occ.git
cd occ
pnpm install --frozen-lockfile
pnpm dev
```

If you already have the project open, run the last two commands from its directory.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The database initializes automatically at `.data/occ.sqlite`; no account, Docker, API key, or environment file is needed. Installation downloads the dependencies, including the native SQLite driver. After installation, the app runs locally without an external service.

To use the same port as the development preview:

```sh
pnpm dev --port 3100
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100). Stop the server with **Ctrl+C**. The app binds to loopback and is intended for local use.

## Your first concurrency experiment

The quickest introduction is **Try breaking things → Catch a collision**. It creates a fresh experiment, submits two writes from the same revision, and explains the outcome.

To reproduce the race manually:

1. Keep **OCC protection** enabled and choose **Reset experiment**.
2. Turn **Autosave** and **Polling** off in both Client A and Client B. Both clients now keep the revision they originally read.
3. Write different text in each editor. Click **Save** in Client A and wait for **Saved**. Then click **Save** in Client B.
4. Compare the results: A's content is in **Server truth**, B retains its draft, and the **Server** timeline records a `409` rejection.
5. In B, choose **Copy draft** if you want to keep the text, then **Go to latest** to replace it with the persisted document.
6. Turn **OCC protection** off and repeat steps 2–4. Changing the mode starts a new experiment. Both writes now succeed, and B overwrites A's content.

The **Clients** timeline shows dispatches, acknowledgments, reads, and adoption; the **Server** timeline shows actual database outcomes. A successful database write can appear in Server truth before a delayed acknowledgment reaches its editor.

## Controls

| Control | Default | What it changes |
| --- | --- | --- |
| OCC protection | On | Rejects a write when its expected revision is stale; off allows last-write-wins. Changing it starts a new experiment. |
| Checkpoints | On | Preserves outgoing content at burst boundaries and before restores. Changing it starts a new experiment. |
| Autosave, per client | On | Saves after typing pauses; off requires the client's Save button. |
| Polling, per client | On | Reads server changes every second; off keeps the client stale until Refresh or a write acknowledgment. |
| Autosave delay | 750 ms | Time after the last edit before an automatic save; adjustable from 250–5,000 ms. |
| Burst gap | 10 seconds | Idle gap that makes the next edit begin a new checkpointed burst; adjustable from 1–60 seconds. |
| Request delay | 0 ms | Wait before the database write, adjustable to 5 seconds. |
| Response delay | 0 ms | Wait after the write commits before returning its result, adjustable to 5 seconds. |

Expand **Client timing** beneath either editor to adjust its delays. Use **Simulate external writer** to save preset content through the same API. Open **Checkpoint history**, select a checkpoint, and choose **Restore through A** or **Restore through B** to submit a restore using that client's revision. Copy any unsaved draft before restoring over it.

## Local data and resets

The current experiment ID is remembered in local storage. Reloading reopens its persisted document. Unsaved drafts live in React memory, so copy them before reloading. **Reset experiment** creates a fresh ID; requests still finishing from an earlier experiment can only modify that earlier experiment. Old experiments remain in the local database. With the server stopped, deleting `.data/` clears all local experiments.

Optional: set `OCC_DB_PATH` to a different SQLite file. For example, on macOS or Linux:

```sh
OCC_DB_PATH=.data/my-experiment.sqlite pnpm dev --port 3100
```

The database, dependency directory, build output, and test artifacts are excluded from Git. Unit tests use temporary databases; browser tests use `.data/e2e.sqlite` and a separate server on port **3101**.

## Experiments

| Scenario | What to watch |
| --- | --- |
| Catch a collision | A and B submit revision 1. A commits; B receives 409 and retains its draft. |
| Lose an update | With OCC off, B's stale save overwrites A. Both return 200. |
| Type through a slow save | A response arrives late, while newer typing remains buffered. Saves serialize and the newest intent wins. |
| Meet another writer | A keeps its unsaved draft; a clean B adopts the external update. |
| Travel through history | A restores a checkpoint; B's stale restore is rejected without adding history. |

Scenario buttons create fresh experiments and configure manual saves / paused client polling for reproducible races. After a scenario, switch autosave and polling back on to experiment freely. The server observer always polls independently; disabling an editor's polling does not hide database changes from the observer.

Client timing settings are captured when a request dispatches. **Request delay** runs before the SQLite transaction; **response delay** runs after commit. Delays never hold a database lock. Manual Save can queue the latest draft while a request is outstanding. Turning autosave off cancels scheduled automatic saves, but does not undo requests already sent.

OCC and checkpoint mode are immutable within an experiment. Changing either creates a new experiment. The burst gap defaults to 10 seconds to make history observable quickly; set it to 60 seconds to approximate the source editor's timing.

## How writes work

1. React holds a local draft separately from a confirmed document and revision.
2. A save sends its expected revision and unique mutation ID to a Next.js Route Handler.
3. An immediate SQLite transaction checks for a prior mutation receipt, optionally checkpoints outgoing content, and conditionally updates the live document.
4. A matching revision commits and increments the counter. A mismatch returns HTTP 409 and the current document, with no content or checkpoint change.
5. The transaction records the event and mutation receipt. Retrying the same ID returns the original outcome; reusing it with different intent is rejected.

```sql
UPDATE experiments
SET content = ?, revision = revision + 1
WHERE id = ? AND (occ = 0 OR revision = ?)
RETURNING *;
```

The conditional UPDATE and transaction are the safety boundary, including across separate database connections. A read followed by an unconditional write would not provide OCC. In the deliberately unsafe mode, the revision still increments but its precondition is ignored; the event log identifies stale overwrites.

Each client has at most one mutation outstanding. Pending edits coalesce to the latest document, and acknowledgments never replace later typing. A conflict pauses saves and preserves the draft. **Go to latest replaces that draft**: copy it first. Adoption cancels queued work, invalidates old callbacks, settles outstanding work, then reads server truth. The client never bypasses a conflict by silently retrying with a newer revision.

Checkpoints are immutable copies of the outgoing document at the start of a burst and before a restore. Live revisions count accepted writes; checkpoint numbers count stored snapshots. The client marks the first edit after the configured idle gap as a new burst. A restore is a normal conditional mutation through the chosen client's last-seen revision. No text merging or CRDT is involved.

## API

- `POST /api/experiments`: create with `occEnabled` and `checkpointsEnabled`.
- `GET /api/experiments/:id`: current document, config, checkpoints, and newest 150 server events; never cached.
- `POST /api/experiments/:id/mutations`: `clientId`, `mutationId`, `expectedRevision`, either rich-text `content` or `restoreCheckpointId`, `checkpoint`, and optional request/response delays (0–5,000 ms).
- Success: `{ ok: true, document }`. Conflict: HTTP 409 with `{ ok: false, reason: "conflict", document }`. Invalid input: 400; missing experiment/checkpoint: 404.

Rich text is validated, bounded JSON and rendered through Tiptap rather than injected HTML. Cross-origin browser writes are rejected. This is a local teaching tool without authentication, not a public deployment template.

## Relationship to the original work

Inspired by the September 2–3 document autosave work in `ai-apps-services`, including conditional patches, holding local typing after conflicts, and preventing stale writes after “Go to latest.” This is an independent implementation with no internal SchoolAI dependencies.

Two simplifications are intentional: **serialize each client's writes**, and **condition checkpoints/restores as well as ordinary saves**. These prevent much of the original overlapping-patch classification and stale-checkpoint healing complexity. Own writes are identified by mutation IDs rather than comparing HTML strings. The simulated external writer uses preset text, not a paid AI service.

## Verification

Install Chromium once for the browser suite, then run the checks:

```sh
pnpm exec playwright install chromium
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

Database tests exercise actual SQLite connections and transaction behavior. Controller tests use deterministic transports and timers to test races. Browser tests exercise rich text and real HTTP requests using an isolated local database. Unit and browser runs do not need external services.

Production builds explicitly use Next.js's Webpack builder for compatibility with restricted local execution environments. Development uses the default Next.js builder.

## Run the production build locally

```sh
pnpm build
pnpm start --port 3100
```

Stop any existing server on port 3100 before starting this command. The production server uses the same local SQLite file unless you set `OCC_DB_PATH`.

## Troubleshooting

- **Port already in use:** stop the existing process or choose another port with `pnpm dev --port 3200`. Browser tests need port 3101 available and start their own server.
- **Browser tests cannot find Chromium:** run `pnpm exec playwright install chromium`. On Linux, Playwright may also require its documented system dependencies (`pnpm exec playwright install --with-deps chromium`).
- **SQLite native module fails to load after changing Node versions:** run `pnpm rebuild better-sqlite3` with the current Node version. If a native build is required on macOS, install the Xcode Command Line Tools. Do not disable dependency build scripts during installation.
- **Old content reappears after reload:** the browser remembers the current experiment. Use Reset experiment for a fresh document; restarting the server intentionally preserves saved data.
- **A client does not receive another writer's update:** turn Polling on or click Refresh. The server observer remains live even when a client's polling is paused.
- **A draft is held after a conflict:** copy it, then choose Go to latest. Autosave stays paused until the conflict is resolved.
