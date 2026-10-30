// Native controls replaced by DOM elements, with real React hooks/reconciliation.
// This tests lifecycle, requests and focus logic, not native layout or OS linking.
import React from "react";
import { vi } from "vitest";
const backListeners = new Set();
const keyListeners = new Set();
const stateListeners = new Set();
export const AppState = { currentState: "active", addEventListener: (_, fn) => { stateListeners.add(fn); return { remove: () => stateListeners.delete(fn) }; } };
export function appState(state) { AppState.currentState = state; for (const fn of stateListeners) fn(state); }
export const BackHandler = { addEventListener: (_, fn) => { backListeners.add(fn); return { remove: () => backListeners.delete(fn) }; } };
export function hardwareBack() {
  for (const fn of [...backListeners].reverse()) if (fn()) return true;
  return false;
}
export const DeviceEventEmitter = { addListener: (_, fn) => { keyListeners.add(fn); return { remove: () => keyListeners.delete(fn) }; } };
export function remoteKey(eventType) { for (const eventKeyAction of [0, 1]) for (const fn of keyListeners) fn({ eventType, eventKeyAction }); }
export const Platform = { OS: "android", isTV: true };
export const Dimensions = { get: () => ({ width: 1920, height: 1080 }) };
export const StyleSheet = { create: (s) => s, absoluteFill: {} };
export const Linking = { openURL: vi.fn().mockResolvedValue(undefined) };
export const View = ({ children }) => <div>{children}</div>;
export const ScrollView = React.forwardRef(({ children }, ref) => <div ref={ref}>{children}</div>);
export const Text = ({ children, accessibilityRole }) => <span role={accessibilityRole}>{children}</span>;
export const Image = ({ source }) => <img src={source?.uri} alt="" />;
export const ActivityIndicator = () => <span>Loading</span>;
export const Pressable = ({ children, onPress, disabled, accessibilityLabel, testID }) => <button data-testid={testID} disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
export const TextInput = React.forwardRef(({ value, onChangeText, accessibilityLabel, onFocus, onBlur }, ref) => <input ref={ref} aria-label={accessibilityLabel} value={value ?? ""} onChange={(e) => onChangeText?.(e.target.value)} onFocus={onFocus} onBlur={onBlur} />);
export const FlatList = ({ data, renderItem }) => data.map((item, index) => <React.Fragment key={item.id ?? index}>{renderItem({ item, index })}</React.Fragment>);

export const useWindowDimensions = () => Dimensions.get("window");
