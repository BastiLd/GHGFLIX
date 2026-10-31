import { AsyncLocalStorage } from 'node:async_hooks';

// Request-local ownership also follows asynchronous feed refreshes. Never use a
// process-global "current user": two concurrent clients must remain isolated.
export const accountContext = new AsyncLocalStorage();
export const currentAccountId = () => accountContext.getStore()?.accountId ?? 0;
export const personalSetting = key => /^(feeds$|feed_|pref_|ui_|accent_color$)/.test(key);
export const settingKey = key => currentAccountId() && personalSetting(key) ? `account:${currentAccountId()}:${key}` : key;
