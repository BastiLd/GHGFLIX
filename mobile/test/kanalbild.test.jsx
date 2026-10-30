import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ picker: vi.fn(), manipulate: vi.fn() }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: native.picker }));
vi.mock("expo-image-manipulator", () => ({ manipulateAsync: native.manipulate, SaveFormat: { JPEG: "jpeg" } }));
import { kanalbildWaehlen } from "../src/kanalbild.js";
beforeEach(() => {
  native.picker.mockReset(); native.manipulate.mockReset();
  native.picker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///selected.jpg", width: 1600, height: 900, fileSize: 100000 }] });
  native.manipulate.mockResolvedValue({ base64: "cGl4ZWw=" });
});
it("converts a chosen landscape picture to a bounded JPEG without modifying the source", async () => {
  expect(await kanalbildWaehlen()).toBe("data:image/jpeg;base64,cGl4ZWw=");
  expect(native.picker).toHaveBeenCalledWith({ mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false });
  expect(native.manipulate).toHaveBeenCalledWith("file:///selected.jpg", [{ resize: { width: 960, height: 540 } }], { format: "jpeg", compress: 0.85, base64: true });
});
it("keeps cancellation harmless and rejects excessively large source images", async () => {
  native.picker.mockResolvedValueOnce({ canceled: true });
  expect(await kanalbildWaehlen()).toBeNull(); expect(native.manipulate).not.toHaveBeenCalled();
  native.picker.mockResolvedValueOnce({ assets: [{ uri: "file:///huge.jpg", width: 10000, height: 10000 }] });
  await expect(kanalbildWaehlen()).rejects.toThrow("kleineres Bild");
  expect(native.manipulate).not.toHaveBeenCalled();
});
