/** AES-GCM helpers shared by dashboard & keyword packs */
export function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function deriveKey(secret) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("dash-access:" + String(secret).trim())
  );
  return new Uint8Array(digest);
}

export async function decryptPack(pack, secret) {
  const keyBytes = await deriveKey(secret);
  const iv = b64ToBytes(pack.iv);
  const raw = b64ToBytes(pack.ct);
  const ct = raw.slice(0, raw.length - 16);
  const tag = raw.slice(raw.length - 16);
  const data = new Uint8Array(ct.length + tag.length);
  data.set(ct, 0);
  data.set(tag, ct.length);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function encryptPack(obj, secret) {
  const keyBytes = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return {
    v: 1,
    alg: "AES-GCM",
    iv: bytesToB64(iv),
    ct: bytesToB64(ct),
  };
}
