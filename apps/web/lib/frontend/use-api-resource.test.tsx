import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useAPIResource } from "./use-api-resource";

function Resource({ path }: { path: string }) {
  const response = useAPIResource<{ value: string }>(path);
  return <p>{response.data?.value ?? (response.loading ? "Loading" : response.error)}</p>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("aborts the previous selection and cannot replace the new trace with a late response", async () => {
  const requests: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve) => requests.push({ signal: options.signal as AbortSignal, resolve }))));
  const view = render(<Resource path="/county-one" />); view.rerender(<Resource path="/county-two" />);
  expect(requests[0].signal.aborted).toBe(true);
  await act(async () => { requests[1].resolve(new Response(JSON.stringify({ value: "New county" }))); });
  expect(screen.getByText("New county")).toBeTruthy();
  await act(async () => { requests[0].resolve(new Response(JSON.stringify({ value: "Old county" }))); });
  expect(screen.queryByText("Old county")).toBeNull(); expect(screen.getByText("New county")).toBeTruthy();
});
