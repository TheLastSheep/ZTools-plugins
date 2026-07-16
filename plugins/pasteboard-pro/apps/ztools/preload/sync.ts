export type WebDavCredentials = Readonly<{
  username: string;
  password: string;
}>;

export type WebDavRequest = Readonly<{
  method: "GET" | "PUT";
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: Uint8Array;
}>;

export type WebDavResponse = Readonly<{
  status: number;
  headers: Headers;
  body: Uint8Array;
}>;

export type WebDavTransport = (
  request: WebDavRequest,
) => Promise<WebDavResponse>;

export type EncryptedSyncObject = Readonly<{
  id: string;
  path: string;
  body: Uint8Array;
}>;

export type PendingEncryptedSyncObject = Readonly<{
  id: string;
  path: string;
  bodyBase64: string;
  queuedAt: string;
}>;

export interface SyncQueue {
  enqueueObjects(objects: readonly EncryptedSyncObject[]): Promise<void>;
  listObjects(): Promise<PendingEncryptedSyncObject[]>;
  removeObjects(paths: readonly string[]): Promise<void>;
  setRetryRequired(required: boolean): Promise<void>;
  isRetryRequired(): Promise<boolean>;
}

export class MemorySyncQueue implements SyncQueue {
  private readonly objects = new Map<string, PendingEncryptedSyncObject>();
  private retryRequired = false;

  async enqueueObjects(objects: readonly EncryptedSyncObject[]): Promise<void> {
    for (const object of objects) {
      this.objects.set(object.path, {
        id: object.id,
        path: object.path,
        bodyBase64: Buffer.from(object.body).toString("base64"),
        queuedAt: new Date().toISOString(),
      });
    }
  }

  async listObjects(): Promise<PendingEncryptedSyncObject[]> {
    return [...this.objects.values()].map((object) => ({ ...object }));
  }

  async removeObjects(paths: readonly string[]): Promise<void> {
    for (const path of paths) this.objects.delete(path);
  }

  async setRetryRequired(required: boolean): Promise<void> {
    this.retryRequired = required;
  }

  async isRetryRequired(): Promise<boolean> {
    return this.retryRequired;
  }
}

export type WebDavSyncResult = Readonly<{
  state: "success" | "offline" | "auth_required" | "partial" | "conflict";
  uploadedObjects: number;
  pendingObjects: number;
  retries: number;
  failedObjectIds: string[];
}>;

export type SyncEncryptedVaultInput = Readonly<{
  objects: readonly EncryptedSyncObject[];
  buildIndex(remote: Uint8Array | undefined): Promise<Uint8Array> | Uint8Array;
}>;

export interface WebDavVaultClient {
  syncEncryptedVault(input: SyncEncryptedVaultInput): Promise<WebDavSyncResult>;
}

export type WebDavVaultClientOptions = Readonly<{
  baseUrl: string;
  credentials(): Promise<WebDavCredentials | undefined>;
  transport?: WebDavTransport;
  queue: SyncQueue;
}>;

class WebDavStatusError extends Error {
  constructor(readonly status: number, operation: string) {
    super(`WebDAV ${operation} failed with status ${status}`);
  }
}

function defaultTransport(request: WebDavRequest): Promise<WebDavResponse> {
  return fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: Buffer.from(request.body) }),
    redirect: "manual",
  }).then(async (response) => ({
    status: response.status,
    headers: response.headers,
    body: new Uint8Array(await response.arrayBuffer()),
  }));
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new TypeError("PasteboardPro WebDAV sync requires HTTPS");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("WebDAV URL cannot contain embedded credentials");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new TypeError("WebDAV base URL cannot contain a query or fragment");
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url;
}

function validateRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError("WebDAV object path must stay inside the configured vault");
  }
}

function queuedObject(object: PendingEncryptedSyncObject): EncryptedSyncObject {
  return {
    id: object.id,
    path: object.path,
    body: new Uint8Array(Buffer.from(object.bodyBase64, "base64")),
  };
}

function uniqueObjects(
  queued: readonly PendingEncryptedSyncObject[],
  current: readonly EncryptedSyncObject[],
): EncryptedSyncObject[] {
  const values = new Map<string, EncryptedSyncObject>();
  for (const object of queued) values.set(object.path, queuedObject(object));
  for (const object of current) values.set(object.path, object);
  return [...values.values()];
}

function stateForError(error: unknown): WebDavSyncResult["state"] {
  if (error instanceof WebDavStatusError) {
    if (error.status === 401 || error.status === 403) return "auth_required";
    return "partial";
  }
  return "offline";
}

export function createWebDavVaultClient(
  options: WebDavVaultClientOptions,
): WebDavVaultClient {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const transport = options.transport ?? defaultTransport;

  const request = async (
    method: WebDavRequest["method"],
    path: string,
    credentials: WebDavCredentials,
    extraHeaders: Readonly<Record<string, string>> = {},
    body?: Uint8Array,
  ): Promise<WebDavResponse> => {
    validateRelativePath(path);
    const url = new URL(path, baseUrl);
    if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) {
      throw new TypeError("WebDAV request escaped the configured origin or vault path");
    }
    return await transport({
      method,
      url: url.toString(),
      headers: {
        authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString("base64")}`,
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body }),
    });
  };

  const uploadImmutable = async (
    object: EncryptedSyncObject,
    credentials: WebDavCredentials,
  ): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(
        "PUT",
        object.path,
        credentials,
        {
          "content-type": "application/octet-stream",
          "if-none-match": "*",
        },
        object.body,
      );
      if ([200, 201, 204, 412].includes(response.status)) return;
      if (response.status < 500 || attempt === 2) {
        throw new WebDavStatusError(response.status, "immutable object upload");
      }
    }
  };

  return {
    async syncEncryptedVault(input) {
      const credentials = await options.credentials();
      if (
        credentials === undefined ||
        credentials.username.length === 0 ||
        credentials.password.length === 0
      ) {
        return {
          state: "auth_required",
          uploadedObjects: 0,
          pendingObjects: (await options.queue.listObjects()).length,
          retries: 0,
          failedObjectIds: [],
        };
      }

      const objects = uniqueObjects(await options.queue.listObjects(), input.objects);
      let uploadedObjects = 0;
      for (let index = 0; index < objects.length; index += 1) {
        const object = objects[index]!;
        try {
          await uploadImmutable(object, credentials);
          uploadedObjects += 1;
          await options.queue.removeObjects([object.path]);
        } catch (error) {
          const remaining = objects.slice(index);
          await options.queue.enqueueObjects(remaining);
          await options.queue.setRetryRequired(true);
          return {
            state: stateForError(error),
            uploadedObjects,
            pendingObjects: (await options.queue.listObjects()).length,
            retries: 0,
            failedObjectIds: remaining.map((value) => value.id),
          };
        }
      }

      let retries = 0;
      for (let attempt = 0; attempt <= 3; attempt += 1) {
        try {
          const remote = await request("GET", "index.enc", credentials);
          let remoteBody: Uint8Array | undefined;
          let etag: string | undefined;
          if (remote.status === 200) {
            remoteBody = remote.body;
            etag = remote.headers.get("etag") ?? undefined;
            if (etag === undefined) {
              throw new WebDavStatusError(502, "index read without ETag");
            }
          } else if (remote.status !== 404) {
            throw new WebDavStatusError(remote.status, "index read");
          }

          const index = await input.buildIndex(remoteBody);
          const updated = await request(
            "PUT",
            "index.enc",
            credentials,
            {
              "content-type": "application/octet-stream",
              ...(etag === undefined
                ? { "if-none-match": "*" }
                : { "if-match": etag }),
            },
            index,
          );
          if ([200, 201, 204].includes(updated.status)) {
            await options.queue.setRetryRequired(false);
            return {
              state: "success",
              uploadedObjects,
              pendingObjects: (await options.queue.listObjects()).length,
              retries,
              failedObjectIds: [],
            };
          }
          if (updated.status === 412) {
            if (attempt === 3) {
              await options.queue.setRetryRequired(true);
              return {
                state: "conflict",
                uploadedObjects,
                pendingObjects: (await options.queue.listObjects()).length,
                retries: 3,
                failedObjectIds: [],
              };
            }
            retries += 1;
            continue;
          }
          throw new WebDavStatusError(updated.status, "conditional index update");
        } catch (error) {
          await options.queue.setRetryRequired(true);
          return {
            state: stateForError(error),
            uploadedObjects,
            pendingObjects: (await options.queue.listObjects()).length,
            retries,
            failedObjectIds: [],
          };
        }
      }

      throw new Error("Unreachable WebDAV sync state");
    },
  };
}
