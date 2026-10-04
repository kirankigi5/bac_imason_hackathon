"use client";

import { useEffect, useState } from "react";
import { loadCandidates, type CandidatesData, type CandidatesRequest } from "@/app/actions/candidates";

export function useCandidates(request: CandidatesRequest) {
  const key = JSON.stringify(request);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: CandidatesData; error?: string; loading: boolean }>({ key: "", loading: true });
  useEffect(() => {
    let current = true;
    setState({ key, loading: true });
    // Server actions cannot be aborted; invalidate late responses on every context change.
    loadCandidates(JSON.parse(key) as CandidatesRequest).then((response) => {
      if (current) setState(response.ok ? { key, data: response.data, loading: false } : { key, error: response.error, loading: false });
    }).catch(() => { if (current) setState({ key, error: "Candidate request failed. Please retry.", loading: false }); });
    return () => { current = false; };
  }, [key, attempt]);
  return { data: state.key === key ? state.data : undefined, error: state.key === key ? state.error : undefined,
    loading: state.key !== key || state.loading, retry: () => setAttempt((value) => value + 1) };
}
