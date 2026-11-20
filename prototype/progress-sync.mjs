import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
const app = initializeApp(window.tutorSettings.firebase);
const auth = getAuth(app);

export function watchAccount(callback) {
  return onAuthStateChanged(auth, (user) => callback(user?.uid || ""));
}

export function connectAccount() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function disconnectAccount() {
  return signOut(auth);
}

function encodeFields(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => {
    if (value == null) return [key, { nullValue: null }];
    if (typeof value === "boolean") return [key, { booleanValue: value }];
    if (typeof value === "number") return [key, { integerValue: String(value) }];
    if (typeof value === "string") return [key, { stringValue: value }];
    return [key, { mapValue: { fields: encodeFields(value) } }];
  }));
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => {
    if ("integerValue" in value) return [key, Number(value.integerValue)];
    if ("mapValue" in value) return [key, decodeFields(value.mapValue.fields)];
    return [key, value.stringValue ?? value.booleanValue ?? null];
  }));
}

function firestoreError(data, response) {
  const code = data.error?.status?.toLowerCase().replaceAll("_", "-") || "unknown";
  return Object.assign(new Error("Firestore request failed: " + response.status), { code });
}

export async function syncProgress(uid, local, merge, signal) {
  const user = auth.currentUser;
  if (user?.uid !== uid) throw Object.assign(new Error("Account changed"), { code: "unauthenticated" });
  const path = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(app.options.projectId)
    + "/databases/(default)/documents/progress/" + encodeURIComponent(uid);
  let token = await user.getIdToken();
  async function request(url, options) {
    const send = () => fetch(url, {
      ...options, signal,
      headers: { Authorization: "Bearer " + token, ...options?.headers },
    });
    let response = await send();
    if (response.status === 401 && !signal.aborted) {
      token = await user.getIdToken(true);
      response = await send();
    }
    return response;
  }
  const response = await request(path);
  const stored = await response.json();
  if (!response.ok && response.status !== 404) throw firestoreError(stored, response);
  const remote = response.ok ? decodeFields(stored.fields) : {};
  const result = merge(local, remote);
  const unchanged = remote.sessionUpdatedAt === result.sessionUpdatedAt
    && Object.keys(result.learning).every((key) => {
      const left = remote.learning?.[key];
      const right = result.learning[key];
      return key === "attempt" ? left?.confidence === right?.confidence && left?.correct === right?.correct
        : left === right;
    });
  if (unchanged) return result;
  const guard = new URLSearchParams(stored.updateTime
    ? { "currentDocument.updateTime": stored.updateTime }
    : { "currentDocument.exists": "false" });
  const write = await request(path + "?" + guard, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(result) }),
  });
  if (!write.ok) {
    const error = firestoreError(await write.json(), write);
    if (error.code === "failed-precondition" || error.code === "already-exists") error.code = "aborted";
    throw error;
  }
  return result;
}
