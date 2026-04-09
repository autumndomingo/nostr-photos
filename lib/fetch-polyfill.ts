/**
 * Patch fetch so @hashtree/core's BlossomStore can upload binary data in React Native.
 *
 * Problem: RN fetch doesn't support Blob created from ArrayBuffer/Uint8Array.
 * Solution: Intercept fetch calls with Blob bodies, extract the raw bytes,
 * and use XMLHttpRequest which DOES support ArrayBuffer bodies in RN.
 */

const blobDataMap = new WeakMap<Blob, Uint8Array>();
const OriginalBlob = globalThis.Blob;

class TrackedBlob extends OriginalBlob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    super([], options);
    if (parts && parts.length > 0) {
      const first = parts[0];
      if (first instanceof ArrayBuffer) {
        blobDataMap.set(this, new Uint8Array(first));
      } else if (first instanceof Uint8Array) {
        blobDataMap.set(this, new Uint8Array(first));
      } else if (ArrayBuffer.isView(first)) {
        blobDataMap.set(this, new Uint8Array((first as any).buffer));
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

(globalThis as any).fetch = function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (init?.body instanceof Blob) {
    const rawBytes = blobDataMap.get(init.body);
    if (rawBytes) {
      // Use XMLHttpRequest for binary uploads
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const url = typeof input === "string" ? input : (input as Request).url;
        xhr.open(init.method || "PUT", url);

        // Copy headers
        if (init.headers) {
          const headers = init.headers as Record<string, string>;
          Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key]);
          });
        }

        xhr.responseType = "text";

        xhr.onload = () => {
          const response = new Response(xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: parseXHRHeaders(xhr.getAllResponseHeaders()),
          });
          resolve(response);
        };

        xhr.onerror = () => reject(new Error("Network request failed"));
        xhr.ontimeout = () => reject(new Error("Request timed out"));

        // Send raw ArrayBuffer — XHR supports this in RN
        xhr.send(rawBytes.buffer);
      });
    }
  }
  return originalFetch(input, init);
};

function parseXHRHeaders(headerStr: string): Headers {
  const headers = new Headers();
  if (!headerStr) return headers;
  headerStr.split("\r\n").forEach((line) => {
    const idx = line.indexOf(": ");
    if (idx > 0) {
      headers.append(line.substring(0, idx), line.substring(idx + 2));
    }
  });
  return headers;
}
