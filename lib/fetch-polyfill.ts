/**
 * Patch global fetch for React Native binary uploads.
 *
 * RN's native fetch can't handle Blob(ArrayBuffer) bodies.
 * Strategy: write binary data to a temp file, then use
 * expo-file-system's uploadAsync which handles binary correctly.
 */
import { uploadAsync, FileSystemUploadType } from "expo-file-system/src/legacy";
import { File, Paths } from "expo-file-system/next";

const blobDataMap = new WeakMap<Blob, Uint8Array>();
const OriginalBlob = globalThis.Blob;
const AbortSignalCtor = globalThis.AbortSignal as
  | (typeof AbortSignal & { timeout?: (ms: number) => AbortSignal })
  | undefined;

let uploadCounter = 0;

if (
  AbortSignalCtor &&
  typeof globalThis.AbortController !== "undefined" &&
  typeof AbortSignalCtor.timeout !== "function"
) {
  AbortSignalCtor.timeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, ms);

    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
      },
      { once: true }
    );

    return controller.signal;
  };
}

class TrackedBlob extends OriginalBlob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    super([], options);
    if (parts && parts.length > 0) {
      const first = parts[0];
      let bytes: Uint8Array | null = null;
      if (first instanceof ArrayBuffer) {
        bytes = new Uint8Array(first);
      } else if (first instanceof Uint8Array) {
        bytes = new Uint8Array(first);
      } else if (ArrayBuffer.isView(first)) {
        const view = first as ArrayBufferView;
        bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      }
      if (bytes) {
        const clean = new Uint8Array(bytes.length);
        clean.set(bytes);
        blobDataMap.set(this, clean);
      }
    }
  }

  get size(): number {
    const data = blobDataMap.get(this);
    return data ? data.length : 0;
  }
}

(globalThis as any).Blob = TrackedBlob;

const originalFetch = globalThis.fetch;

(globalThis as any).fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (init?.body instanceof Blob) {
    const rawBytes = blobDataMap.get(init.body);
    if (rawBytes && init.method?.toUpperCase() === "PUT") {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      // Write bytes to a temp file
      const tempName = `upload_${Date.now()}_${uploadCounter++}.bin`;
      const tempFile = new File(Paths.cache, tempName);
      tempFile.write(rawBytes);

      // Build headers object
      const headers: Record<string, string> = {};
      if (init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value: string, key: string) => {
            headers[key] = value;
          });
        } else if (typeof init.headers === "object") {
          Object.assign(headers, init.headers);
        }
      }

      try {
        const result = await uploadAsync(url, tempFile.uri, {
          httpMethod: "PUT",
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers,
        });

        // Clean up temp file
        try { tempFile.delete(); } catch {}

        // Parse response headers
        const respHeaders = new Headers();
        if (result.headers) {
          for (const [key, value] of Object.entries(result.headers)) {
            respHeaders.append(key, value as string);
          }
        }

        return new Response(result.body, {
          status: result.status,
          headers: respHeaders,
        });
      } catch (e: any) {
        try { tempFile.delete(); } catch {}
        throw e;
      }
    }
  }
  return originalFetch(input, init);
};
