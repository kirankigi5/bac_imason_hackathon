import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CandidatesView } from "./CandidatesView";
import { loadCandidates, type CandidatesResponse, type CandidatesRequest } from "@/app/actions/candidates";
import { cloneProject } from "@/lib/project/defaults";
import { getRanking } from "@/lib/backend/decisions";

vi.mock("@/app/actions/candidates", () => ({ loadCandidates: vi.fn() }));
const project = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2030, activePrioritySignals: ["water"] });
const ranking = getRanking(project);
const response: CandidatesResponse = { ok: true, data: { ...ranking, results: ranking.results } };
const request: CandidatesRequest = { project, mode: "ranked" };
beforeEach(() => { vi.mocked(loadCandidates).mockReset().mockResolvedValue(response); });
afterEach(cleanup);
async function loaded() { await waitFor(() => expect(screen.queryByText("Loading current candidates...")).toBeNull()); }

describe("complete candidates view", () => {
  it("loads real processed results and displays their backend ranks and scores in order", async () => {
    vi.mocked(loadCandidates).mockResolvedValue({ ok: true, data: { ...ranking, results: [...ranking.results].reverse() } });
    render(<CandidatesView request={request} pending={false} onSelect={() => {}} />); expect(screen.getByRole("status")).toBeTruthy(); await loaded();
    const visible = [...document.querySelectorAll("[data-candidate-id]")];
    expect(visible).toHaveLength(50); expect(visible.map((node) => Number(node.getAttribute("data-candidate-rank")))).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    for (const [index, row] of visible.entries()) expect(row.textContent).toContain(`${ranking.results[index].overall_score}/100`);
    expect(screen.getByText(`${ranking.results.length} ranked candidates`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next candidates" }));
    expect(document.querySelector("[data-candidate-rank]")!.getAttribute("data-candidate-rank")).toBe("51");
  });
  it.each(["Washtenaw", "Michigan", "Washtenaw Michigan", "Washtenaw, MI"])("searches all results by %s", async (query) => {
    render(<CandidatesView request={request} pending={false} onSelect={() => {}} />); await loaded();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search candidates" }), { target: { value: query } });
    const rows = [...document.querySelectorAll("[data-candidate-id]")]; expect(rows.length).toBeGreaterThan(0);
    if (query === "Michigan") for (const row of rows) expect(row.textContent).toContain(", MI");
    else for (const row of rows) expect(row.textContent).toContain("Washtenaw County, MI");
  });
  it("selects the exact returned county outside the visible top 20", async () => {
    const select = vi.fn(), county = ranking.results.find((row) => row.location_id === "county-26161")!;
    expect(county.rank).toBeGreaterThan(20);
    render(<CandidatesView request={request} pending={false} onSelect={select} />); await loaded();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search candidates" }), { target: { value: "Washtenaw Michigan" } });
    fireEvent.click(screen.getByRole("button", { name: "View Washtenaw County, MI" })); expect(select).toHaveBeenCalledWith(county);
  });
  it("rejects late responses for earlier project criteria and earlier revisions", async () => {
    const pending: Array<{ request: CandidatesRequest; resolve: (value: CandidatesResponse) => void }> = [];
    vi.mocked(loadCandidates).mockImplementation((request) => new Promise((resolve) => pending.push({ request, resolve })));
    const first = { ...request, projectId: "4ea187eb-4201-43ee-8f19-5361b87d061b", revision: 1 };
    const view = render(<CandidatesView request={first} pending={false} onSelect={() => {}} />);
    const current = { ...first, project: cloneProject({ ...project, geography: { country: "US", states: ["MI"] }, targetGoLiveYear: 2050 }), revision: 2 };
    view.rerender(<CandidatesView request={current} pending={false} onSelect={() => {}} />);
    expect(screen.queryByText(/ranked candidates/)).toBeNull(); expect(pending[1].request).toEqual(current);
    const scoped = getRanking(current.project);
    await act(async () => pending[1].resolve({ ok: true, data: scoped }));
    expect(document.querySelectorAll("[data-candidate-id]").length).toBeGreaterThan(0);
    await act(async () => pending[0].resolve(response));
    for (const row of document.querySelectorAll("[data-candidate-id]")) expect(row.textContent).toContain(", MI");
    view.rerender(<CandidatesView request={{ ...current, revision: 3 }} pending={false} onSelect={() => {}} />);
    expect(screen.getByText("Loading current candidates...")).toBeTruthy(); expect(document.querySelector("[data-candidate-id]")).toBeNull();
    await act(async () => pending[2].resolve({ ok: true, data: scoped }));
    expect(pending[2].request.revision).toBe(3);
  });
  it("shows failure and Retry, then recovers without seeded data", async () => {
    vi.mocked(loadCandidates).mockRejectedValueOnce(new Error("transport unavailable"));
    render(<CandidatesView request={request} pending={false} onSelect={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Candidate request failed");
    expect(document.querySelector("[data-candidate-id]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await loaded();
    expect(screen.queryByRole("alert")).toBeNull(); expect(document.querySelector("[data-candidate-id]")).toBeTruthy();
    expect(loadCandidates).toHaveBeenCalledTimes(2);
  });
  it("does not mix excluded counties into eligible results and distinguishes empty search", async () => {
    vi.mocked(loadCandidates).mockResolvedValue({ ok: true, data: { ...ranking, results: [...ranking.results.slice(0, 3), ...ranking.excluded.slice(0, 3)] } });
    render(<CandidatesView request={request} pending={false} onSelect={() => {}} />); await loaded();
    for (const row of document.querySelectorAll("[data-candidate-id]")) expect(row.querySelector("[data-candidate-status]")!.textContent).not.toMatch(/Insufficient Data|Infeasible/);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search candidates" }), { target: { value: "no county with this name" } });
    expect(screen.getByText("No counties match this search.")).toBeTruthy();
  });
});
