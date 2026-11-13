import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

type Route = { status?: number; body: unknown };

/** Answers the API calls the app makes on start; anything else is a 404. */
const stubApi = (routes: Record<string, Route>) => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      calls.push(path);
      const key = Object.keys(routes).find((candidate) => path.endsWith(candidate));
      const route = key ? routes[key] : { status: 404, body: { error: { code: "not_found", message: "Not found" } } };
      return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
};

const health = {
  "/health/live": { body: { status: "ok", service: "alertafiscal" } },
  "/health/ready": { body: { status: "ready", database: "postgresql" } },
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("App", () => {
  it("shows the public site when nobody is signed in", async () => {
    stubApi({ ...health, "/auth/me": { status: 401, body: { error: { code: "unauthorized", message: "Sign in" } } } });
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /sign in/i }).length).toBeGreaterThan(0));
    expect(screen.queryByText("My account")).toBeNull();
  });

  it("opens the workspace with the menu when there is a session", async () => {
    const calls = stubApi({
      ...health,
      "/auth/me": { body: { user: { id: 7, full_name: "Ana Torres", email: "ana@example.com", companies: [] } } },
      "/companies": { body: { items: [] } },
    });
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("My account").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Ana Torres").length).toBeGreaterThan(0);
    expect(calls).toContain("/api/v1/auth/me");
  });
});
