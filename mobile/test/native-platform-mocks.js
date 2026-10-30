import { vi } from "vitest";
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { eas: { projectId: "b14ed30d-3ecc-4465-ac79-7988b90ab0d8" } } } } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
