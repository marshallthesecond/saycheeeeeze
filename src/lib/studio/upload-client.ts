// Uploading, the browser's half: one controller per gallery.
//
// It asks the Studio for tickets (/api/studio/uploads), sends each file to
// the door the tickets name (today the worker on the laptop) in pieces, a few
// files at a time, and then watches the drop until every file has an answer.
// See scripts/studio-worker.mjs for the door's side.
//
// A plain object outside React, kept per gallery for the life of the tab, so
// moving between the Studio's pages does not stop an upload; the Photos tab
// subscribes to it with useSyncExternalStore when it is on screen.

import {
  UPLOAD_MAX_FILES,
  UPLOAD_PARALLEL,
  UPLOAD_PIECE_BYTES,
  naturalCompare,
  uploadProblem,
  type UploadProblem,
} from "./upload-rules";

export type ItemState =
  /** Refused before sending (wrong type, too big, empty). */
  | "refused"
  | "waiting"
  | "uploading"
  /** All sent; the worker has it in its queue or is building it. */
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  /** The gallery already has this photograph. */
  | "skipped"
  | "cancelled"
  /** Sending stopped (page reloaded): the file has to be chosen again. */
  | "needs_file"
  /** The worker could not be reached; Try again continues. */
  | "paused";

export interface UploadItem {
  key: string;
  id: string | null;
  batchId: string | null;
  name: string;
  size: number;
  state: ItemState;
  /** Bytes the door has, as far as this page knows. */
  sent: number;
  problem: UploadProblem | null;
  /** The reason a file failed (uploads.error), or null. */
  error: string | null;
}

export interface WorkerState {
  online: boolean;
  name: string | null;
}

export interface UploaderSnapshot {
  items: UploadItem[];
  worker: WorkerState | null;
  /** A reason for the message line: worker_offline, door_unreachable, ... */
  notice: string | null;
  /** A drop is being registered. */
  starting: boolean;
}

/** What the server says about one file (GET /api/studio/uploads/<batch>). */
export interface ServerFile {
  id: string;
  name: string;
  size: number;
  bytesReceived: number;
  status: string;
  error: string | null;
}

export interface ServerBatch {
  batch: { id: string; status: string };
  files: ServerFile[];
}

const SENDING: ItemState[] = ["waiting", "uploading"];
const AT_WORKER: ItemState[] = ["queued", "processing"];
const FINISHED: ItemState[] = ["ready", "skipped", "cancelled", "refused"];
const POLL_MS = 2500;
const EMIT_MS = 120;
/** Network failures in a row on one file before the door counts as unreachable. */
const MAX_FAILURES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let counter = 0;
const newKey = () => `u${++counter}`;

class Aborted extends Error {}
class Unreachable extends Error {}

interface PieceAnswer {
  status: number;
  body: Record<string, unknown> | null;
}

export class GalleryUploads {
  private items: UploadItem[] = [];
  private files = new Map<string, File>();
  private tokens = new Map<string, string>();
  private requests = new Map<string, XMLHttpRequest>();
  private queue: string[] = [];
  private active = 0;
  private door: string | null = null;
  private worker: WorkerState | null = null;
  private notice: string | null = null;
  private starting = false;
  private listeners = new Set<() => void>();
  private snapshot: UploaderSnapshot = { items: [], worker: null, notice: null, starting: false };
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated = false;
  private onReady: (() => void) | null = null;

  constructor(readonly galleryId: string) {}

  // ------------------------------------------------------------ React side

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Called when photos have become ready, so the page can show them. */
  setOnReady(fn: (() => void) | null) {
    this.onReady = fn;
  }

  private changed(now = false) {
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.emit();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit();
    }, EMIT_MS);
  }

  private emit() {
    this.snapshot = {
      items: this.items.map((i) => ({ ...i })),
      worker: this.worker ? { ...this.worker } : null,
      notice: this.notice,
      starting: this.starting,
    };
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ state

  private find(key: string) {
    return this.items.find((i) => i.key === key) ?? null;
  }

  private byId(id: string) {
    return this.items.find((i) => i.id === id) ?? null;
  }

  private set(item: UploadItem, patch: Partial<UploadItem>, now = true) {
    Object.assign(item, patch);
    this.changed(now);
  }

  /** Is anything still being sent from this page? */
  sending(): boolean {
    return this.items.some((i) => SENDING.includes(i.state) && this.files.has(i.key));
  }

  setWorker(worker: WorkerState | null) {
    this.worker = worker;
    if (worker?.online && this.notice === "worker_offline") this.notice = null;
    this.changed(true);
  }

  /**
   * Drops this page did not start (an earlier visit, another device): shown
   * as the server sees them. Files that had not finished sending need to be
   * chosen again. Only once per controller.
   */
  hydrate(batches: ServerBatch[]) {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const b of batches) {
      for (const f of b.files) {
        if (this.byId(f.id)) continue;
        const state = toState(f.status);
        this.items.push({
          key: newKey(),
          id: f.id,
          batchId: b.batch.id,
          name: f.name,
          size: f.size,
          state: SENDING.includes(state) ? "needs_file" : state,
          sent: f.bytesReceived,
          problem: null,
          error: f.error,
        });
      }
    }
    this.changed(true);
    this.watch();
  }

  // ------------------------------------------------------------ a new drop

  async add(list: File[]) {
    if (list.length === 0) return;
    this.notice = null;

    const fresh: UploadItem[] = [];
    const wanted: { item: UploadItem; file: File }[] = [];
    for (const file of [...list].sort((a, b) => naturalCompare(a.name, b.name))) {
      const problem = uploadProblem({ name: file.name, size: file.size, type: file.type });
      const item: UploadItem = {
        key: newKey(),
        id: null,
        batchId: null,
        name: file.name,
        size: file.size,
        state: problem ? "refused" : "waiting",
        sent: 0,
        problem,
        error: null,
      };
      fresh.push(item);
      if (!problem) wanted.push({ item, file });
    }

    if (wanted.length > UPLOAD_MAX_FILES) {
      this.notice = "too_many_files";
      this.changed(true);
      return;
    }
    this.items.push(...fresh.filter((i) => i.state === "refused"));
    if (wanted.length === 0) {
      this.changed(true);
      return;
    }

    this.starting = true;
    this.changed(true);
    let answer: Response;
    let body: Record<string, unknown> | null = null;
    try {
      answer = await fetch("/api/studio/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          galleryId: this.galleryId,
          files: wanted.map(({ file }) => ({ name: file.name, size: file.size, type: file.type })),
        }),
      });
      body = await answer.json().catch(() => null);
    } catch {
      this.starting = false;
      this.notice = "network";
      this.changed(true);
      return;
    }
    this.starting = false;

    if (!answer.ok || !body) {
      this.notice = typeof body?.error === "string" ? body.error : "failed";
      if (body?.error === "worker_offline") this.worker = { online: false, name: this.worker?.name ?? null };
      this.changed(true);
      return;
    }

    const door = (body.door as { url?: string } | undefined)?.url ?? null;
    const batchId = String(body.batchId);
    this.door = door;
    const tickets = (body.uploads as { id: string; name: string; size: number; token: string }[]) ?? [];

    // Tickets come back in the order the files will show in; match them to
    // the files by name and size, the first free one each time.
    const free = [...wanted];
    for (const t of tickets) {
      const at = free.findIndex(({ file }) => file.name.slice(0, 255) === t.name && file.size === t.size);
      if (at === -1) continue;
      const [{ item, file }] = free.splice(at, 1);
      item.id = t.id;
      item.batchId = batchId;
      this.files.set(item.key, file);
      this.tokens.set(item.key, t.token);
      this.items.push(item);
      this.queue.push(item.key);
    }
    this.worker = { online: true, name: (body.door as { worker?: string } | undefined)?.worker ?? null };
    this.changed(true);
    this.pump();
  }

  // ------------------------------------------------------------ sending

  private pump() {
    while (this.active < UPLOAD_PARALLEL && this.queue.length) {
      const key = this.queue.shift()!;
      const item = this.find(key);
      if (!item || !SENDING.includes(item.state)) continue;
      this.active++;
      this.send(item)
        .catch(() => {})
        .finally(() => {
          this.active--;
          this.pump();
          this.watch();
        });
    }
  }

  private put(item: UploadItem, offset: number, piece: Blob): Promise<PieceAnswer> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.requests.set(item.key, xhr);
      xhr.open("PUT", `${this.door}/uploads/${item.id}?offset=${offset}`);
      xhr.setRequestHeader("Authorization", `Bearer ${this.tokens.get(item.key) ?? ""}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        // The bar moves with the bytes, not a piece at a time.
        item.sent = Math.min(offset + e.loaded, item.size);
        this.changed();
      };
      xhr.onload = () => {
        this.requests.delete(item.key);
        let body: Record<string, unknown> | null = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => {
        this.requests.delete(item.key);
        reject(new Unreachable());
      };
      xhr.onabort = () => {
        this.requests.delete(item.key);
        reject(new Aborted());
      };
      xhr.send(piece);
    });
  }

  /** Where the door says this file stopped, or null when it cannot be asked. */
  private async whereIs(item: UploadItem): Promise<number | null> {
    try {
      const res = await fetch(`${this.door}/uploads/${item.id}`, {
        headers: { Authorization: `Bearer ${this.tokens.get(item.key) ?? ""}` },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.offset === "number" ? body.offset : null;
    } catch {
      return null;
    }
  }

  private async send(item: UploadItem) {
    const file = this.files.get(item.key);
    if (!file || !item.id || !this.door) {
      this.set(item, { state: "needs_file" });
      return;
    }

    let offset = item.sent;
    // After a reload or a pause the door may have more (or less) than we think.
    if (offset > 0) offset = (await this.whereIs(item)) ?? offset;
    let failures = 0;
    let renewed = false;
    this.set(item, { state: "uploading", sent: offset });

    for (;;) {
      if (item.state !== "uploading") return; // cancelled meanwhile
      const end = Math.min(offset + UPLOAD_PIECE_BYTES, file.size);
      let answer: PieceAnswer;
      try {
        answer = await this.put(item, offset, file.slice(offset, end));
      } catch (err) {
        if (err instanceof Aborted) return;
        failures++;
        if (failures >= MAX_FAILURES) {
          this.notice = "door_unreachable";
          this.set(item, { state: "paused" });
          return;
        }
        await sleep(1000 * 2 ** (failures - 1));
        offset = (await this.whereIs(item)) ?? offset;
        continue;
      }

      const body = answer.body ?? {};
      const error = typeof body.error === "string" ? body.error : null;

      if (answer.status === 200) {
        failures = 0;
        offset = typeof body.offset === "number" ? body.offset : end;
        if (body.done) {
          const state = toState(String(body.status ?? "queued"));
          this.set(item, { state, sent: item.size, error: state === "skipped" ? "duplicate" : null });
          this.files.delete(item.key);
          return;
        }
        this.set(item, { sent: offset }, false);
        continue;
      }
      if (answer.status === 409 && error === "gap" && typeof body.offset === "number") {
        offset = body.offset;
        continue;
      }
      if (answer.status === 409 && error === "busy") {
        await sleep(2000);
        continue;
      }
      if (answer.status === 409 && error === "status") {
        this.set(item, { state: toState(String(body.status)) });
        return;
      }
      // An old ticket, or one for a worker that is no longer the door.
      if ((answer.status === 401 || (answer.status === 409 && error === "other_worker")) && !renewed && item.batchId) {
        renewed = true;
        const ok = await this.renew(item.batchId);
        if (!ok) {
          this.set(item, { state: "paused" });
          return;
        }
        offset = (await this.whereIs(item)) ?? 0;
        continue;
      }
      if (answer.status === 503) {
        failures++;
        if (failures >= MAX_FAILURES) {
          this.notice = error === "stopping" ? "worker_offline" : "door_unreachable";
          this.set(item, { state: "paused" });
          return;
        }
        await sleep(1000 * 2 ** (failures - 1));
        continue;
      }
      this.set(item, { state: "failed", error: error ?? "internal" });
      return;
    }
  }

  /** New tickets for the files of a drop still on their way. */
  private async renew(batchId: string): Promise<boolean> {
    const answer = await this.action(batchId, { action: "renew" });
    if (!answer) return false;
    this.door = (answer.door as { url?: string } | undefined)?.url ?? this.door;
    for (const t of (answer.uploads as { id: string; token: string; bytesReceived?: number }[]) ?? []) {
      const item = this.byId(t.id);
      if (!item) continue;
      this.tokens.set(item.key, t.token);
      if (typeof t.bytesReceived === "number" && !this.requests.has(item.key)) item.sent = t.bytesReceived;
    }
    return true;
  }

  /** POST to a drop. Sets the notice and answers null when refused. */
  private async action(batchId: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`/api/studio/uploads/${batchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        this.notice = typeof body?.error === "string" ? body.error : "failed";
        this.changed(true);
        return null;
      }
      return body;
    } catch {
      this.notice = "network";
      this.changed(true);
      return null;
    }
  }

  // ------------------------------------------------------------ watching the worker

  /** Polls the drops that have files at the worker, until none has. */
  private watch() {
    if (this.pollTimer) return;
    const pending = new Set(
      this.items.filter((i) => i.batchId && AT_WORKER.includes(i.state)).map((i) => i.batchId as string),
    );
    if (pending.size === 0) return;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      let newlyReady = 0;
      for (const batchId of pending) {
        try {
          const res = await fetch(`/api/studio/uploads/${batchId}`, { cache: "no-store" });
          if (!res.ok) continue;
          const body = await res.json();
          if (body.worker) this.worker = { online: Boolean(body.worker.online), name: body.worker.name ?? null };
          for (const f of (body.files as ServerFile[]) ?? []) {
            const item = this.byId(f.id);
            // A file this page is still sending knows better than the server.
            if (!item || this.requests.has(item.key) || SENDING.includes(item.state)) continue;
            const state = toState(f.status);
            if (state === item.state && f.error === item.error) continue;
            if (state === "ready" && item.state !== "ready") newlyReady++;
            Object.assign(item, { state: SENDING.includes(state) ? "needs_file" : state, error: f.error });
          }
        } catch {
          // Try again next round.
        }
      }
      this.changed(true);
      if (newlyReady) this.onReady?.();
      this.watch();
    }, POLL_MS);
  }

  // ------------------------------------------------------------ the photographer's buttons

  async retry(key: string) {
    const item = this.find(key);
    if (!item?.id || !item.batchId || item.state !== "failed") return;
    this.notice = null;
    const answer = await this.action(item.batchId, { action: "retry", uploadId: item.id });
    if (!answer) return;
    if (answer.status === "waiting") {
      const ticket = answer.ticket as { token: string };
      this.door = (answer.door as { url?: string }).url ?? this.door;
      this.tokens.set(item.key, ticket.token);
      if (this.files.has(item.key)) {
        this.set(item, { state: "waiting", sent: 0, error: null });
        this.queue.push(item.key);
        this.pump();
      } else {
        this.set(item, { state: "needs_file", sent: 0, error: null });
      }
      return;
    }
    this.set(item, { state: "queued", error: null });
    this.watch();
  }

  async retryFailed() {
    for (const item of this.items.filter((i) => i.state === "failed")) await this.retry(item.key);
  }

  /** Takes files out: one, or every file not yet at the worker. */
  async cancel(key?: string) {
    const targets = this.items.filter(
      (i) => (key ? i.key === key : true) && i.id && i.batchId && [...SENDING, "needs_file", "paused", "queued", "failed"].includes(i.state),
    );
    const byBatch = new Map<string, string[]>();
    for (const t of targets) byBatch.set(t.batchId!, [...(byBatch.get(t.batchId!) ?? []), t.id!]);
    for (const [batchId, ids] of byBatch) {
      // Stop sending first, so no piece arrives after the answer.
      for (const id of ids) {
        const item = this.byId(id)!;
        this.queue = this.queue.filter((k) => k !== item.key);
        this.requests.get(item.key)?.abort();
        item.state = "cancelled";
        this.files.delete(item.key);
      }
      this.changed(true);
      await this.action(batchId, { action: "cancel", uploadIds: ids });
    }
    this.watch();
  }

  /** Picks the sending back up after the door was unreachable. */
  tryAgain() {
    this.notice = null;
    for (const item of this.items.filter((i) => i.state === "paused")) {
      item.state = "waiting";
      this.queue.push(item.key);
    }
    this.changed(true);
    this.pump();
  }

  /** Files chosen again after a reload: matched by name and size, then resumed. */
  async resume(list: File[]) {
    const waiting = this.items.filter((i) => i.state === "needs_file");
    const matched: UploadItem[] = [];
    for (const file of list) {
      const item = waiting.find((i) => !matched.includes(i) && i.name === file.name.slice(0, 255) && i.size === file.size);
      if (!item) continue;
      this.files.set(item.key, file);
      matched.push(item);
    }
    if (matched.length === 0) {
      this.notice = "no_match";
      this.changed(true);
      return;
    }
    this.notice = null;
    for (const batchId of new Set(matched.map((i) => i.batchId!))) {
      if (!(await this.renew(batchId))) return;
    }
    for (const item of matched) {
      item.state = "waiting";
      this.queue.push(item.key);
    }
    this.changed(true);
    this.pump();
  }

  /** Takes finished files off the list on this page (nothing is deleted). */
  clearFinished() {
    this.items = this.items.filter((i) => !FINISHED.includes(i.state));
    if (this.notice && !this.items.length) this.notice = null;
    this.changed(true);
  }

  dismissNotice() {
    this.notice = null;
    this.changed(true);
  }
}

function toState(status: string): ItemState {
  switch (status) {
    case "waiting":
    case "uploading":
    case "queued":
    case "processing":
    case "ready":
    case "failed":
    case "skipped":
    case "cancelled":
      return status;
    case "missing":
      return "cancelled";
    default:
      return "failed";
  }
}

// One controller per gallery for the life of the tab.
const controllers = new Map<string, GalleryUploads>();

export function uploadsFor(galleryId: string): GalleryUploads {
  let c = controllers.get(galleryId);
  if (!c) {
    c = new GalleryUploads(galleryId);
    controllers.set(galleryId, c);
  }
  return c;
}

/** Is any gallery still sending from this tab? (For the "leave page?" prompt.) */
export function anySending(): boolean {
  for (const c of controllers.values()) if (c.sending()) return true;
  return false;
}

export const EMPTY_SNAPSHOT: UploaderSnapshot = { items: [], worker: null, notice: null, starting: false };
