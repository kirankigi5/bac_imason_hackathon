"use client";

import { useEffect, useState } from "react";
import { requestJSON } from "./api";

export function useAPIResource<T>(path: string, body?: unknown, enabled = true) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const key = JSON.stringify([path, serialized]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string; loading: boolean }>({ key: "", loading: false });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ key, loading: true });
    requestJSON<T>(path, serialized === undefined ? undefined : JSON.parse(serialized), undefined, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ key, data, loading: false }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "Request unavailable", loading: false }); });
    return () => controller.abort();
  }, [path, serialized, key, enabled, attempt]);
  return { data: enabled && state.key === key ? state.data : undefined,
    error: enabled && state.key === key ? state.error : undefined,
    loading: enabled && (state.key !== key || state.loading), retry: () => setAttempt((value) => value + 1) };
}
