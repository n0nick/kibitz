// LocalStorage-backed credential & preference hooks.
//
// Each hook returns [value, setter]; the setter handles persistence
// (clearing the key when the new value is empty/falsy).

import { useState } from "react";

const API_KEY_STORAGE = "kibitz-anthropic-key";

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? "");
  const setApiKey = (val) => {
    const trimmed = val.trim();
    if (trimmed) localStorage.setItem(API_KEY_STORAGE, trimmed);
    else localStorage.removeItem(API_KEY_STORAGE);
    setApiKeyState(trimmed);
  };
  return [apiKey, setApiKey];
}

export function useTone() {
  const [tone, setToneState] = useState(() => localStorage.getItem("kibitz-tone") ?? "beginner");
  const setTone = (v) => { localStorage.setItem("kibitz-tone", v); setToneState(v); };
  return [tone, setTone];
}

export function useLichess() {
  const [token, setTokenState] = useState(() => localStorage.getItem("kibitz-lichess-token") ?? "");
  const [username, setUsernameState] = useState(() => localStorage.getItem("kibitz-lichess-username") ?? "");
  const setLichess = (tok, uname) => {
    const t = (tok ?? "").trim();
    if (t) localStorage.setItem("kibitz-lichess-token", t);
    else { localStorage.removeItem("kibitz-lichess-token"); localStorage.removeItem("kibitz-lichess-username"); }
    setTokenState(t);
    if (!t) { setUsernameState(""); return; }
    if (uname !== undefined) {
      if (uname) localStorage.setItem("kibitz-lichess-username", uname);
      else localStorage.removeItem("kibitz-lichess-username");
      setUsernameState(uname ?? "");
    }
  };
  return [token, username, setLichess];
}
