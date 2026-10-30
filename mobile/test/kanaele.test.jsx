import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KanaeleSeite } from "../src/kanaele.js";
import { FokusProvider, useFokusSystem } from "../src/fokus.js";
import { hardwareBack, remoteKey, Linking } from "./native-dom.jsx";
import { kanalAufruf, webAdresse } from "../src/kanaele-api.js";

let api, groups, feeds, items, kern;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function Capture() { kern = useFokusSystem().kern; return null; }
const draw = () => render(<FokusProvider><Capture /><KanaeleSeite api={api} /></FokusProvider>);
const click = async (name) => fireEvent.click(await screen.findByRole("button", { name }));
const groupPosts = () => click(/Science ·/);
beforeEach(() => {
  groups = [{ id: "g1", name: "Science", abos: 1, ungelesen: 1 }, { id: "g2", name: "Space", abos: 1, ungelesen: 1 }];
  feeds = [{ id: "f1", titel: "Lab", gruppeIds: ["g1", "g2"], benachrichtigen: true }];
  items = [{ id: "i1", titel: "Neuer Beitrag", feedId: "f1", feedTitel: "Lab", gelesen: false, istShort: null, url: "https://www.youtube.com/watch?v=abcdefghijk" }];
  Linking.openURL.mockClear();
  api = vi.fn(async (url, { body }) => {
    const command = url.split("/").pop();
    if (command === "feed_groups") return { result: groups };
    if (command === "feeds_list") return { result: feeds };
    if (command === "feed_unread") return { result: 1 };
    if (command === "get_setting") return { result: "data:image/png;base64,aGVsbG8=" };
    if (command === "feed_items") return { result: body.format === "shorts" ? [] : items };
    if (command === "feed_update") { Object.assign(feeds[0], body); return { result: feeds[0] }; }
    if (command === "feed_refresh") return { result: { neu: 1 } };
    return { result: true };
  });
});
afterEach(cleanup);

it("reads existing group images and counts a shared channel's unread post only once", async () => {
  draw(); await screen.findByText("1 ungelesene Beiträge");
  expect(screen.getAllByRole("presentation").map((img) => img.getAttribute("src"))).toEqual(["data:image/png;base64,aGVsbG8=", "data:image/png;base64,aGVsbG8="]);
  await groupPosts();
  await click("Kanäle dieser Gruppe"); await click("Lab");
  await click("Kanal bearbeiten");
  await click("✓ Science");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Labor" } });
  await click("Speichern");
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/invoke/feed_update", {
    method: "POST", body: { id: "f1", titel: "Labor", gruppeIds: ["g2"], benachrichtigen: true },
  }));
  await screen.findByRole("button", { name: "Kanal bearbeiten" });
});

it("ignores a delayed feed response after changing the format and keeps unknown items out of Shorts", async () => {
  const slow = deferred();
  const original = api.getMockImplementation();
  let first = true;
  api.mockImplementation((url, opt) => {
    if (url.endsWith("feed_items") && first) { first = false; return slow.promise; }
    return original(url, opt);
  });
  draw(); await groupPosts();
  await click("Format: Alle Formate"); await click("Shorts");
  await screen.findByText("Keine passenden Beiträge.");
  await act(async () => slow.resolve({ result: items }));
  expect(screen.queryByRole("button", { name: /Neuer Beitrag/ })).toBeNull();
  await click("Format: Shorts"); await click("Unbekannt");
  await click(/Neuer Beitrag/);
  expect(screen.getByText("Format nicht eindeutig erkannt")).toBeDefined();
});

it("keeps an edit open after a server error and does not claim it saved", async () => {
  const original = api.getMockImplementation();
  api.mockImplementation((url, opt) => url.endsWith("feed_group_update") ? { error: "Speicherung fehlgeschlagen" } : original(url, opt));
  draw(); await groupPosts(); await click("Gruppe bearbeiten");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Geändert" } });
  await click("Speichern");
  expect((await screen.findByRole("alert")).textContent).toBe("Speicherung fehlgeschlagen");
  expect(screen.getByLabelText("Name").value).toBe("Geändert");
});

it("uses remote OK and Back through filter, posts and groups, then passes Back to the app", async () => {
  draw(); await screen.findByText("1 ungelesene Beiträge");
  kern.setzen(kern._alle().find((e) => e.zeile === 0).schluessel);
  act(() => remoteKey("select"));
  await screen.findByRole("button", { name: "Format: Alle Formate" });
  await click("Format: Alle Formate");
  act(() => { expect(hardwareBack()).toBe(true); });
  await screen.findByRole("button", { name: "Format: Alle Formate" });
  act(() => { expect(hardwareBack()).toBe(true); });
  await screen.findByRole("button", { name: "Alle Beiträge" });
  expect(hardwareBack()).toBe(false);
});

it("marks only the opened post read, and leaves it unread if opening fails", async () => {
  draw(); await groupPosts(); await click(/Neuer Beitrag/);
  Linking.openURL.mockRejectedValueOnce(new Error("Keine App verfügbar"));
  await click("Beitrag öffnen"); await screen.findByText("Keine App verfügbar");
  expect(api.mock.calls.some(([url]) => url.endsWith("feed_mark_read"))).toBe(false);
  await click("Beitrag öffnen");
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/invoke/feed_mark_read", { method: "POST", body: { ids: ["i1"] } }));
});

it("searches server-side without treating an empty successful result as an error", async () => {
  draw(); await groupPosts();
  fireEvent.change(screen.getByLabelText("Beiträge suchen"), { target: { value: "Mars" } });
  await waitFor(() => expect(api.mock.calls.some(([url, opt]) => url.endsWith("feed_items") && opt.body.search === "Mars")).toBe(true));
  expect(await kanalAufruf(async () => ({ result: [] }), "feed_items")).toEqual([]);
  await expect(kanalAufruf(async () => ({}), "feed_items")).rejects.toThrow("gültige Antwort");
  expect(webAdresse("javascript:alert(1)")).toBeNull();
});

it("requires explicit group removal confirmation and leaves channels intact", async () => {
  draw(); await groupPosts(); await click("Gruppe bearbeiten");
  await click("Gruppe entfernen"); await click("Abbrechen");
  expect(api.mock.calls.some(([url]) => url.endsWith("feed_group_remove"))).toBe(false);
  await click("Gruppe entfernen"); await click("Entfernen bestätigen");
  await screen.findByRole("button", { name: "Alle Beiträge" });
  expect(api).toHaveBeenCalledWith("/api/invoke/feed_group_remove", { method: "POST", body: { id: "g1" } });
  expect(api.mock.calls.some(([url]) => url.endsWith("feed_remove"))).toBe(false);
});

it("does not navigate again when a pending save finishes after Back", async () => {
  const pending = deferred(); const original = api.getMockImplementation();
  api.mockImplementation((url, opt) => url.endsWith("feed_group_update") ? pending.promise : original(url, opt));
  draw(); await groupPosts(); await click("Gruppe bearbeiten"); await click("Speichern");
  act(() => { expect(hardwareBack()).toBe(true); });
  await screen.findByRole("button", { name: "Format: Alle Formate" });
  await act(async () => pending.resolve({ result: true }));
  expect(screen.getByRole("button", { name: "Format: Alle Formate" })).toBeDefined();
});
