"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/components/chat/ChatPanel";
import { cloneProject } from "@/lib/project/defaults";
import { setCategoryWeight } from "@/lib/project/state";
import { getMissingRequiredFields } from "@/lib/project/validation";
import type { Audience, CategoryKey, ConversationResponse, Geography, ProjectState, ProviderStatus, SearchResponse } from "@/lib/types/domain";
import { requestJSON } from "./api";
import type { SavedProject } from "./contracts";

const newUSProject = () => cloneProject();
const welcome: ChatMessage = { id: "welcome", role: "assistant", content: "What are you planning to build?" };
function projectURL(id?: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("project", id); else url.searchParams.delete("project");
  window.history.replaceState(null, "", url);
}

export function useWorkspace() {
  const [project, setProject] = useState<ProjectState>(newUSProject);
  const projectRef = useRef(project);
  const [search, setSearch] = useState<SearchResponse>();
  const [saved, setSaved] = useState<SavedProject>();
  const savedRef = useRef(saved);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [name, setName] = useState("Untitled project");
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [audience, setAudience] = useState<Audience>("developer");
  const [provider, setProvider] = useState<ProviderStatus>();
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [diffContext, setDiffContext] = useState<{ before: ProjectState; after: ProjectState; ids: string[] }>();
  const beforeRef = useRef<ProjectState | undefined>(undefined);
  const [lastChange, setLastChange] = useState<Pick<ConversationResponse, "changes" | "rankingChange">>();
  const [explanationRequest, setExplanationRequest] = useState<ConversationResponse>();
  const selectedId = project.selectedLocationId ?? search?.results[0]?.location_id;

  const acceptProject = useCallback((next: ProjectState) => {
    projectRef.current = cloneProject(next); setProject(projectRef.current);
  }, []);
  const acceptSaved = useCallback((record: SavedProject) => {
    savedRef.current = record; setSaved(record);
    setProjects((list) => [record, ...list.filter((item) => item.id !== record.id)]);
  }, []);
  const refreshProjects = useCallback(async () => {
    try { const response = await requestJSON<{ projects: SavedProject[] }>("/api/projects"); setProjects(response.projects); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Projects unavailable"); }
  }, []);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (locked.current) return false;
    locked.current = true; setPending(true); setError("");
    try { await work(); return true; } catch (failure) { setError(failure instanceof Error ? failure.message : "Request unavailable"); return false; }
    finally { locked.current = false; setPending(false); }
  }, []);

  const openProject = useCallback((id: string) => run(async () => {
    let record = await requestJSON<SavedProject>(`/api/projects/${encodeURIComponent(id)}`);
    if (!record.project.geography) {
      // Older intake drafts need the fixed U.S. scope persisted before saved chat.
      record = await requestJSON<SavedProject>(`/api/projects/${encodeURIComponent(id)}`, { expected_revision: record.revision,
        project: { geography: { country: "US", states: [] } }, source: "api" }, "PATCH");
    }
    acceptSaved(record); acceptProject(record.project); setName(record.name); projectURL(id);
    setSearch(undefined); setDiffContext(undefined); beforeRef.current = undefined; setLastChange(undefined); setExplanationRequest(undefined);
    setMessages([{ id: "opened-" + record.revision, role: "assistant", content: `Opened ${record.name}, revision ${record.revision}.` }]);
    if (!getMissingRequiredFields(record.project).length) setSearch(await requestJSON<SearchResponse>("/api/locations/search", { project: record.project }));
  }), [run, acceptSaved, acceptProject]);

  useEffect(() => {
    const controller = new AbortController();
    requestJSON<ProviderStatus>("/api/project/status", undefined, "GET", controller.signal).then(setProvider).catch(() => undefined);
    requestJSON<{ projects: SavedProject[] }>("/api/projects", undefined, "GET", controller.signal)
      .then((payload) => { if (!controller.signal.aborted) setProjects(payload.projects); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Projects unavailable"); });
    const id = new URL(window.location.href).searchParams.get("project");
    if (id) void openProject(id);
    return () => controller.abort();
  }, [openProject]);

  const evaluate = (message: string, current: ProjectState, source: "chat" | "filters") => run(async () => {
    const prior = cloneProject(projectRef.current), record = savedRef.current;
    if (source === "chat") setMessages((list) => [...list, { id: crypto.randomUUID(), role: "user", content: message }]);
    const response = await requestJSON<ConversationResponse>("/api/project/converse", { message, currentProject: current, source, audience,
      selectedLocationId: current.selectedLocationId ?? search?.results[0]?.location_id,
      previousProject: source === "filters" ? prior : /why|explain|trade.off|risks|outrank|what changed/i.test(message) ? beforeRef.current : undefined,
      ...(record ? { projectId: record.id, expectedRevision: record.revision } : {}) });
    acceptProject(response.project); setSearch(response.search ?? search); setAudience(response.audience);
    if (response.provider?.provider !== "engine") setProvider(response.provider);
    setMessages((list) => [...list, { id: crypto.randomUUID(), role: "assistant", changes: response.changes,
      content: response.assistantMessage + (response.followupQuestion ? "\n\n" + response.followupQuestion : "") }]);
    if (response.changes.length && !getMissingRequiredFields(prior).length && !getMissingRequiredFields(response.project).length) {
      beforeRef.current = prior;
      setLastChange({ changes: response.changes, rankingChange: response.rankingChange });
      setDiffContext({ before: prior, after: cloneProject(response.project), ids: [...new Set([
        prior.selectedLocationId, search?.results[0]?.location_id, response.search?.results[0]?.location_id,
        ...response.project.compareLocationIds].filter((id): id is string => !!id))] });
    } else if (response.changes.length) { beforeRef.current = undefined; setDiffContext(undefined); setLastChange(undefined); }
    if (response.explanationPayload) setExplanationRequest(response);
    else if (response.changes.length) setExplanationRequest(undefined);
    if (record && response.project_record) {
      // Keep the accepted revision even if the subsequent metadata read fails.
      acceptSaved({ ...record, ...response.project_record, project: response.project });
      acceptSaved(await requestJSON<SavedProject>(`/api/projects/${record.id}`));
    }
  });
  const updateWeight = (factor: CategoryKey, value: number) => {
    const current = cloneProject(projectRef.current);
    current.weights = setCategoryWeight(current.weights, factor, value);
    current.activePrioritySignals = [...new Set([...current.activePrioritySignals, factor])];
    return evaluate("Evaluate the current project.", current, "filters");
  };
  const updateCriteria = (next: ProjectState) => evaluate("Evaluate the current project.", cloneProject({ ...next,
    geography: { ...next.geography, country: "US" } }), "filters");
  const updateGeography = (geography: Geography) => {
    const next = cloneProject({ ...projectRef.current, geography: { ...geography, country: "US" } });
    if (!getMissingRequiredFields(next).length) return updateCriteria(next);
    return updateSelection({ geography: next.geography });
  };
  const updateSelection = (patch: Partial<ProjectState>) => run(async () => {
    const next = cloneProject({ ...projectRef.current, ...patch }), record = savedRef.current;
    if (record) {
      const accepted = await requestJSON<SavedProject>(`/api/projects/${record.id}`, { expected_revision: record.revision,
        project: next, source: "api" }, "PATCH");
      acceptSaved(accepted); acceptProject(accepted.project);
    } else acceptProject(next);
  });
  const toggleCompare = (id: string) => {
    const ids = projectRef.current.compareLocationIds;
    if (!ids.includes(id) && ids.length >= 4) { setError("Comparison is limited to four counties. Remove one before adding another."); return Promise.resolve(); }
    return updateSelection({ compareLocationIds: ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id] });
  };
  const saveProject = () => run(async () => {
    if (!name.trim()) throw new Error("Project name is required");
    const current = cloneProject({ ...projectRef.current, selectedLocationId: selectedId }), record = savedRef.current;
    const accepted = record ? await requestJSON<SavedProject>(`/api/projects/${record.id}`, {
      expected_revision: record.revision, project: current, name: name.trim(), source: "api" }, "PATCH")
      : await requestJSON<SavedProject>("/api/projects", { name: name.trim(), project: current, source: "api" });
    acceptSaved(accepted); acceptProject(accepted.project); setName(accepted.name); projectURL(accepted.id);
  });
  const newProject = () => {
    if (locked.current) return;
    acceptProject(newUSProject()); savedRef.current = undefined; setSaved(undefined); setSearch(undefined);
    setName("Untitled project"); setMessages([welcome]); setDiffContext(undefined); beforeRef.current = undefined;
    setLastChange(undefined); setExplanationRequest(undefined); setError(""); projectURL();
  };

  return { project, search, saved, projects, name, setName, messages, audience, setAudience, provider, pending, error,
    selectedId, diffContext, lastChange, explanationRequest, openProject, saveProject, newProject, refreshProjects,
    updateCriteria, updateGeography,
    sendMessage: (message: string) => evaluate(message, projectRef.current, "chat"), updateWeight,
    selectLocation: (id: string) => updateSelection({ selectedLocationId: id }), toggleCompare,
    clearCompare: () => updateSelection({ compareLocationIds: [] }), removeConstraint: (id: string) =>
      evaluate("Evaluate the current project.", cloneProject({ ...projectRef.current, constraints: projectRef.current.constraints.filter((row) => row.id !== id) }), "filters") };
}
