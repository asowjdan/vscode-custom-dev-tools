const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { execFile, spawn } = require("child_process");

const VIEW_KINDS = {
  javaSpring: "javaSpring",
  springControllers: "springControllers",
  python: "python",
  docker: "docker",
  database: "database"
};

let controllerTestPanel = null;
let controllerMsgDisposable = null;

const DIAGNOSTIC_NOTIFICATION_PREFIX = "diagnostic:";
const EXTENSION_DISPLAY_NAME = "Custom Dev Tools & Theme Kit";
const THEME_STATE_KEY = "customDevToolsThemeKit.themeSettings";
const CONFIG_SECTION = "customDevToolsThemeKit";

const EXCLUDED_DIRS = new Set([
  ".git",
  ".codex",
  ".logs",
  ".tools",
  ".vscode",
  "__pycache__",
  "node_modules",
  "out",
  "target"
]);

class RuntimeNode {
  constructor(options) {
    Object.assign(this, options);
  }
}

// ── 알림 센터 ──────────────────────────────────────────────

function translateToKorean(text) {
  return new Promise((resolve) => {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=${encodeURIComponent(text)}`;
    const req = https.get(url, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const translated = parsed[0]?.map((s) => s[0]).filter(Boolean).join("") || text;
          resolve(translated);
        } catch {
          resolve(text);
        }
      });
    });
    req.on("error", () => resolve(text));
    req.on("timeout", () => { req.destroy(); resolve(text); });
  });
}

class NotificationItem {
  constructor(type, message, original, source, actions = [], notificationKey = "") {
    this.id = `notif:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.type = type;       // 'info' | 'warn' | 'error' | 'run' | 'stop'
    this.message = compactNotificationText(message); // 목록 표시용 원문 요약
    this.original = normalizeNotificationText(original) || normalizeNotificationText(message);
    this.source = normalizeNotificationText(source);
    this.notificationKey = notificationKey || `${type}:${this.source}:${this.original}`;
    this.actions = normalizeNotificationActions(actions);
    this.timestamp = new Date();
    this.expanded = false;
    this.viewMode = "translated";
    this.translatedText = "";
    this.translating = false;
    this.translated = false;
    this.translationError = "";
  }
}

class NotificationDetailItem {
  constructor(parent, label, options = {}) {
    this.id = `${parent.id}:detail:${options.id || Math.random().toString(36).slice(2)}`;
    this.parent = parent;
    this.label = label;
    this.description = options.description || "";
    this.tooltip = options.tooltip || label;
    this.iconPath = options.iconPath || new vscode.ThemeIcon("blank");
    this.contextValue = "customDevToolsNotificationDetail";
  }
}

class NotificationProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._onDidChangeSelection = new vscode.EventEmitter();
    this.onDidChangeSelection = this._onDidChangeSelection.event;
    this.items = [];
    this.seen = new Map();
    this.selectedItem = null;
  }

  refresh(item) { this._onDidChangeTreeData.fire(item); }

  push(type, message, original, source, actions = [], notificationKey = "") {
    const key = notificationKey || `${type}:${normalizeNotificationText(source)}:${normalizeNotificationText(original) || normalizeNotificationText(message)}`;
    const now = Date.now();
    if (now - (this.seen.get(key) || 0) < 2000) {
      const existing = this.items.find((item) => item.notificationKey === key);
      if (existing) {
        this.updateActions(existing, actions);
        return existing;
      }
      return null;
    }
    this.seen.set(key, now);
    for (const [seenKey, timestamp] of this.seen) {
      if (now - timestamp > 60000) {
        this.seen.delete(seenKey);
      }
    }

    const item = new NotificationItem(type, message, original, source, actions, key);
    this.items.unshift(item);
    if (this.items.length > 200) this.items.length = 200;
    if (!this.selectedItem) {
      this.selectedItem = item;
      this._onDidChangeSelection.fire(item);
    }
    this.refresh();
    this.translate(item);

    return item;
  }

  clear() {
    this.items = [];
    this.selectedItem = null;
    this._onDidChangeSelection.fire(null);
    this.refresh();
  }

  updateActions(item, actions) {
    if (!this.isNotification(item) || !Array.isArray(actions) || actions.length === 0) {
      return;
    }
    const merged = normalizeNotificationActions([...item.actions, ...actions]);
    if (JSON.stringify(merged) === JSON.stringify(item.actions)) {
      return;
    }
    item.actions = merged;
    this.refresh();
    if (this.selectedItem && this.selectedItem.id === item.id) {
      this._onDidChangeSelection.fire(item);
    }
  }

  select(item) {
    if (!this.isNotification(item)) return;
    this.selectedItem = item;
    this._onDidChangeSelection.fire(item);
  }

  remove(item) {
    if (!this.isNotification(item)) return;

    const index = this.items.findIndex((candidate) => candidate.id === item.id);
    if (index === -1) return;

    this.items.splice(index, 1);
    if (this.selectedItem && this.selectedItem.id === item.id) {
      this.selectedItem = this.items[index] || this.items[index - 1] || this.items[0] || null;
      this._onDidChangeSelection.fire(this.selectedItem);
    }
    this.refresh();
  }

  removeByKey(key) {
    const normalizedKey = normalizeNotificationText(key);
    if (!normalizedKey) return;

    const index = this.items.findIndex((candidate) => candidate.notificationKey === normalizedKey);
    if (index === -1) return;

    const [removed] = this.items.splice(index, 1);
    this.seen.delete(normalizedKey);
    if (this.selectedItem && removed && this.selectedItem.id === removed.id) {
      this.selectedItem = this.items[index] || this.items[index - 1] || this.items[0] || null;
      this._onDidChangeSelection.fire(this.selectedItem);
    }
    this.refresh();
  }

  syncToKeys(keys) {
    const activeKeys = new Set(
      (Array.isArray(keys) ? keys : [])
        .map((key) => normalizeNotificationText(key))
        .filter(Boolean)
    );
    const previousSelectedId = this.selectedItem ? this.selectedItem.id : "";
    const previousLength = this.items.length;

    this.items = this.items.filter((item) => activeKeys.has(item.notificationKey));
    for (const seenKey of Array.from(this.seen.keys())) {
      if (!activeKeys.has(seenKey)) {
        this.seen.delete(seenKey);
      }
    }

    if (this.selectedItem && !this.items.some((item) => item.id === previousSelectedId)) {
      this.selectedItem = this.items[0] || null;
      this._onDidChangeSelection.fire(this.selectedItem);
    } else if (!this.selectedItem && this.items.length > 0) {
      this.selectedItem = this.items[0];
      this._onDidChangeSelection.fire(this.selectedItem);
    }

    if (this.items.length !== previousLength) {
      this.refresh();
    }
  }

  syncFromNotifications(notifications) {
    const normalizedNotifications = (Array.isArray(notifications) ? notifications : [])
      .map((notification) => {
        const message = normalizeNotificationText(notification && notification.message);
        const original = normalizeNotificationText(notification && notification.original) || message;
        const source = normalizeNotificationText(notification && notification.source);
        const type = normalizeNotificationType(notification && notification.type);
        const notificationKey =
          normalizeNotificationText(notification && notification.key) || `${type}:${source}:${message}`;

        if (!message || !notificationKey) {
          return null;
        }

        return {
          key: notificationKey,
          type,
          message,
          original,
          source,
          actions: normalizeNotificationActions(notification && notification.actions)
        };
      })
      .filter(Boolean);

    // Merge: add new, update existing — never remove (removal only via /notification-removed)
    let changed = false;
    const newItems = [];

    for (const notification of normalizedNotifications) {
      const existing = this.items.find((item) => item.notificationKey === notification.key);
      if (existing) {
        const originalChanged = existing.original !== notification.original;
        existing.type = notification.type;
        existing.message = compactNotificationText(notification.message);
        existing.original = notification.original;
        existing.source = notification.source;
        existing.actions = notification.actions;
        if (originalChanged) {
          existing.viewMode = "translated";
          existing.translatedText = "";
          existing.translating = false;
          existing.translated = false;
          existing.translationError = "";
        }
        changed = true;
      } else {
        const item = new NotificationItem(
          notification.type,
          notification.message,
          notification.original,
          notification.source,
          notification.actions,
          notification.key
        );
        newItems.push(item);
        changed = true;
      }
    }

    if (newItems.length > 0) {
      this.items.unshift(...newItems);
      if (this.items.length > 200) this.items.length = 200;
      const now = Date.now();
      for (const item of newItems) {
        this.seen.set(item.notificationKey, now);
      }
      if (!this.selectedItem) {
        this.selectedItem = this.items[0];
        this._onDidChangeSelection.fire(this.selectedItem);
      }
    }

    if (changed) {
      this.refresh();
      newItems.forEach((item) => this.translate(item));
    }
  }

  syncDiagnostics(diagnostics) {
    const normalizedDiagnostics = (Array.isArray(diagnostics) ? diagnostics : [])
      .map((diagnostic) => {
        const message = normalizeNotificationText(diagnostic && diagnostic.message);
        const key = normalizeNotificationText(diagnostic && diagnostic.key);
        if (!message || !key) {
          return null;
        }
        return {
          key,
          type: normalizeNotificationType(diagnostic && diagnostic.type),
          message,
          original: normalizeNotificationText(diagnostic && diagnostic.original) || message,
          source: normalizeNotificationText(diagnostic && diagnostic.source),
          actions: []
        };
      })
      .filter(Boolean);

    const previousSelectedKey = this.selectedItem ? this.selectedItem.notificationKey : "";
    const previousByKey = new Map(this.items.map((item) => [item.notificationKey, item]));
    const notificationItems = this.items.filter(
      (item) => !item.notificationKey.startsWith(DIAGNOSTIC_NOTIFICATION_PREFIX)
    );
    const nextDiagnostics = [];
    const newItems = [];

    for (const diagnostic of normalizedDiagnostics) {
      let item = previousByKey.get(diagnostic.key);
      if (item) {
        const originalChanged = item.original !== diagnostic.original;
        item.type = diagnostic.type;
        item.message = compactNotificationText(diagnostic.message);
        item.original = diagnostic.original;
        item.source = diagnostic.source;
        item.actions = diagnostic.actions;
        if (originalChanged) {
          item.viewMode = "translated";
          item.translatedText = "";
          item.translating = false;
          item.translated = false;
          item.translationError = "";
        }
      } else {
        item = new NotificationItem(
          diagnostic.type,
          diagnostic.message,
          diagnostic.original,
          diagnostic.source,
          diagnostic.actions,
          diagnostic.key
        );
        newItems.push(item);
      }
      nextDiagnostics.push(item);
    }

    this.items = [...notificationItems, ...nextDiagnostics];
    const selected = this.items.find((item) => item.notificationKey === previousSelectedKey) || this.items[0] || null;
    const selectionChanged = (this.selectedItem && this.selectedItem.notificationKey) !== (selected && selected.notificationKey);
    this.selectedItem = selected;
    if (selectionChanged) {
      this._onDidChangeSelection.fire(this.selectedItem);
    }
    this.refresh();
    newItems.forEach((item) => this.translate(item));
  }

  expand(item) {
    if (!this.isNotification(item)) return;
    item.expanded = true;
    this.refresh();
  }

  collapse(item) {
    if (!this.isNotification(item)) return;
    item.expanded = false;
    this.refresh();
  }

  toggleExpand(item) {
    if (!this.isNotification(item)) return;
    item.expanded = !item.expanded;
    this.refresh();
  }

  async translate(item) {
    if (!this.isNotification(item) || item.translating) return;
    item.viewMode = "translated";

    if (item.translatedText) {
      this.refresh();
      this._onDidChangeSelection.fire(item);
      return;
    }

    item.translating = true;
    item.translationError = "";
    this.refresh();
    this._onDidChangeSelection.fire(item);

    try {
      const translated = await translateToKorean(item.original);
      if (this.hasNotification(item)) {
        item.translatedText = translated || item.original;
        item.translated = item.translatedText !== item.original;
        item.message = compactNotificationText(item.translatedText);
      }
    } catch (error) {
      if (this.hasNotification(item)) {
        item.translationError = error && error.message ? error.message : String(error);
        item.viewMode = "original";
      }
    } finally {
      if (this.hasNotification(item)) {
        item.translating = false;
        this.refresh();
        this._onDidChangeSelection.fire(this.selectedItem);
      }
    }
  }

  showOriginal(item) {
    if (!this.isNotification(item)) return;
    item.viewMode = "original";
    this.refresh();
    this._onDidChangeSelection.fire(item);
  }

  showTranslation(item) {
    if (!this.isNotification(item)) return;
    if (item.translatedText) {
      item.viewMode = "translated";
      this.refresh();
      this._onDidChangeSelection.fire(item);
      return;
    }
    this.translate(item);
  }

  isNotification(item) {
    return item instanceof NotificationItem && item.id !== "notif-empty";
  }

  hasNotification(item) {
    return this.isNotification(item) && this.items.some((candidate) => candidate.id === item.id);
  }

  getTreeItem(item) {
    if (item instanceof NotificationDetailItem) {
      const detailItem = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
      detailItem.id = item.id;
      detailItem.description = item.description;
      detailItem.tooltip = item.tooltip;
      detailItem.iconPath = item.iconPath;
      detailItem.contextValue = item.contextValue;
      return detailItem;
    }

    const treeItem = new vscode.TreeItem(getNotificationListLabel(item), vscode.TreeItemCollapsibleState.None);
    treeItem.id = item.id;

    const t = item.timestamp;
    const time = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}:${String(t.getSeconds()).padStart(2,"0")}`;
    treeItem.description = [time, item.source, item.translating ? "번역 중" : item.translated ? "번역됨" : ""].filter(Boolean).join(" · ");

    const lines = [];
    lines.push(`[원문] ${item.original}`);
    if (item.source) {
      lines.push(`[소스] ${item.source}`);
    }
    if (item.translatedText) {
      lines.push(`[번역] ${item.translatedText}`);
    }
    if (item.translationError) {
      lines.push(`[번역 오류] ${item.translationError}`);
    }
    treeItem.tooltip = new vscode.MarkdownString(lines.join("\n\n"));

    treeItem.iconPath = getNotificationIcon(item);
    treeItem.contextValue = this.isNotification(item) ? "customDevToolsNotificationListItem" : "customDevToolsNotificationEmpty";
    if (this.isNotification(item)) {
      treeItem.command = {
        command: "customDevTools.runtime.selectNotification",
        title: "알림 전문 보기",
        arguments: [item]
      };
    }
    return treeItem;
  }

  getChildren(element) {
    if (element instanceof NotificationDetailItem) return [];
    if (this.isNotification(element)) return [];
    if (this.items.length === 0) {
      return [Object.assign(new NotificationItem("info", "알림이 없습니다"), { id: "notif-empty", contextValue: "customDevToolsNotificationEmpty" })];
    }
    return this.items;
  }

  getNotificationContext(item) {
    if (!this.isNotification(item)) return "customDevToolsNotificationEmpty";
    if (!item.expanded) return "customDevToolsNotificationCollapsed";
    if (item.translating) return "customDevToolsNotificationExpandedTranslating";
    if (item.viewMode === "translated") return "customDevToolsNotificationExpandedTranslated";
    if (item.translatedText) return "customDevToolsNotificationExpandedOriginalWithTranslation";
    return "customDevToolsNotificationExpandedOriginal";
  }

  getNotificationDetailChildren(item) {
    const children = [];
    const activeText = item.viewMode === "translated" ? item.translatedText : item.original;
    const modeLabel = item.viewMode === "translated" ? "번역" : "원문";

    children.push(new NotificationDetailItem(item, `보기: ${modeLabel}`, {
      id: "mode",
      iconPath: new vscode.ThemeIcon(item.viewMode === "translated" ? "globe" : "symbol-string")
    }));

    if (item.source) {
      children.push(new NotificationDetailItem(item, `소스: ${item.source}`, {
        id: "source",
        iconPath: new vscode.ThemeIcon("extensions")
      }));
    }

    if (item.translating) {
      children.push(new NotificationDetailItem(item, "번역 중...", {
        id: "translating",
        iconPath: new vscode.ThemeIcon("sync~spin")
      }));
      return children;
    }

    if (item.viewMode === "translated" && !item.translatedText) {
      children.push(new NotificationDetailItem(item, "번역 버튼을 누르면 이곳에 번역문이 표시됩니다.", {
        id: "translate-hint",
        iconPath: new vscode.ThemeIcon("info")
      }));
      return children;
    }

    if (item.translationError) {
      children.push(new NotificationDetailItem(item, `번역 실패: ${item.translationError}`, {
        id: "translation-error",
        iconPath: new vscode.ThemeIcon("warning")
      }));
    }

    for (const [index, line] of wrapNotificationText(activeText).entries()) {
      children.push(new NotificationDetailItem(item, line, {
        id: `line:${index}`,
        iconPath: new vscode.ThemeIcon(index === 0 ? "quote" : "blank")
      }));
    }

    return children;
  }
}

function compactNotificationText(text) {
  return normalizeNotificationText(text)
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function getNotificationListLabel(item) {
  if (!(item instanceof NotificationItem) || item.id === "notif-empty") {
    return item.message || "알림";
  }
  if (item.translatedText) {
    return compactNotificationText(item.translatedText);
  }
  if (item.translating) {
    return `번역 중... ${compactNotificationText(item.original)}`;
  }
  return compactNotificationText(item.original);
}

function getNotificationIcon(item) {
  const iconByType = {
    info: ["info", "notificationsInfoIcon.foreground"],
    warn: ["warning", "notificationsWarningIcon.foreground"],
    error: ["error", "notificationsErrorIcon.foreground"],
    run: ["play-circle", "debugIcon.startForeground"],
    stop: ["debug-stop", "debugIcon.stopForeground"]
  };
  const [icon, color] = iconByType[item.type] || ["bell", "notificationsInfoIcon.foreground"];
  return new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
}

function normalizeNotificationActions(actions) {
  if (!Array.isArray(actions)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const action of actions) {
    const id = normalizeNotificationText(action && action.id);
    const label = normalizeNotificationText(action && action.label);
    if (!id || !label || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({ id, label: compactNotificationText(label) });
  }
  return normalized.slice(0, 8);
}

function wrapNotificationText(text, width = 72) {
  const normalized = normalizeNotificationText(text);
  if (!normalized) return ["(내용 없음)"];

  const result = [];
  for (const rawLine of normalized.split(/\n+/)) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      if (word.length > width) {
        if (line) {
          result.push(line);
          line = "";
        }
        for (let index = 0; index < word.length; index += width) {
          result.push(word.slice(index, index + width));
        }
        continue;
      }

      if (!line) {
        line = word;
      } else if (line.length + word.length + 1 > width) {
        result.push(line);
        line = word;
      } else {
        line += ` ${word}`;
      }
    }
    if (line) result.push(line);
  }

  return result.length ? result : ["(내용 없음)"];
}

class NotificationDetailWebviewProvider {
  constructor(notifProvider, actionBridge) {
    this.notifProvider = notifProvider;
    this.actionBridge = actionBridge;
    this.view = null;
    this.notifProvider.onDidChangeSelection(() => this.render());
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.render();
  }

  handleMessage(message) {
    const item = this.notifProvider.selectedItem;
    if (!this.notifProvider.isNotification(item)) {
      return;
    }

    if (message && message.command === "showOriginal") {
      this.notifProvider.showOriginal(item);
      return;
    }

    if (message && message.command === "showTranslation") {
      this.notifProvider.showTranslation(item);
      return;
    }

    if (message && message.command === "runNotificationAction") {
      const actionId = normalizeNotificationText(message.actionId);
      const action = item.actions.find((candidate) => candidate.id === actionId);
      if (action) {
        this.actionBridge.enqueueAction({
          id: action.id,
          label: action.label,
          key: item.notificationKey
        });
      }
    }
  }

  render() {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.getHtml(this.notifProvider.selectedItem);
  }

  getHtml(item) {
    if (!this.notifProvider.isNotification(item)) {
      return this.wrapHtml(`
        <section class="empty">
          <div class="empty-icon">i</div>
          <p>알림 목록에서 항목을 선택하면 전문이 여기에 표시됩니다.</p>
        </section>
      `);
    }

    const isTranslated = item.viewMode === "translated";
    const activeText = isTranslated ? (item.translatedText || "") : item.original;
    const title = escapeHtml(item.message);
    const source = escapeHtml(item.source || "소스 없음");
    const time = escapeHtml(formatNotificationTime(item.timestamp));
    const originalActive = isTranslated ? "" : " active";
    const translatedActive = isTranslated ? " active" : "";
    const translationStatus = item.translating
      ? "번역 중..."
      : item.translationError
        ? `번역 실패: ${escapeHtml(item.translationError)}`
        : item.translatedText
          ? "번역 준비됨"
          : "번역 버튼을 누르면 번역문을 불러옵니다.";
    const translatedDisabled = item.translating ? " disabled" : "";
    const content = item.translating && isTranslated ? "번역 중입니다..." : activeText;
    const actionButtons = item.actions.length
      ? item.actions.map((action) => (
        `<button class="action" data-action-id="${escapeHtml(action.id)}" type="button">${escapeHtml(action.label)}</button>`
      )).join("")
      : `<div class="no-actions">이 알림에는 실행 버튼이 없습니다.</div>`;

    return this.wrapHtml(`
      <section class="detail">
        <header>
          <div class="summary">${title}</div>
          <div class="meta">
            <span>${time}</span>
            <span>${source}</span>
          </div>
        </header>

        <div class="toolbar" role="group" aria-label="알림 전문 보기 모드">
          <button class="toggle${originalActive}" data-command="showOriginal" type="button">원문</button>
          <button class="toggle${translatedActive}" data-command="showTranslation" type="button"${translatedDisabled}>번역</button>
        </div>

        <div class="status">${translationStatus}</div>
        <pre class="content">${escapeHtml(content || "(내용 없음)")}</pre>
        <footer class="actions" aria-label="알림 상호작용 버튼">
          ${actionButtons}
        </footer>
      </section>
    `);
  }

  wrapHtml(body) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      color-scheme: dark;
      --bg: rgba(12, 8, 22, 0.76);
      --surface: rgba(18, 13, 30, 0.88);
      --surface-strong: rgba(24, 17, 40, 0.96);
      --border: rgba(180, 157, 224, 0.26);
      --accent: #b49de0;
      --text: #f0edf8;
      --muted: rgba(226, 223, 240, 0.72);
    }

    html,
    body {
      margin: 0;
      min-height: 100%;
      color: var(--text);
      background: transparent;
      font: 12px/1.55 var(--vscode-font-family);
    }

    body {
      padding: 8px;
      box-sizing: border-box;
    }

    .detail,
    .empty {
      min-height: calc(100vh - 16px);
      box-sizing: border-box;
      border: 1px solid var(--border);
      background: var(--bg);
      display: flex;
      flex-direction: column;
    }

    .empty {
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--muted);
      text-align: center;
      padding: 16px;
    }

    .empty-icon {
      width: 22px;
      height: 22px;
      border: 1px solid var(--border);
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: var(--accent);
      font-weight: 700;
    }

    header {
      padding: 9px 10px 7px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    .summary {
      font-weight: 600;
      color: var(--text);
      word-break: break-word;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      margin-top: 4px;
      color: var(--muted);
      font-size: 11px;
    }

    .toolbar {
      display: flex;
      gap: 6px;
      padding: 8px 10px 0;
    }

    button.toggle {
      border: 1px solid var(--border);
      background: rgba(180, 157, 224, 0.08);
      color: var(--text);
      min-width: 52px;
      height: 26px;
      padding: 0 10px;
      font: inherit;
      cursor: pointer;
    }

    button.toggle:hover {
      background: rgba(180, 157, 224, 0.18);
    }

    button.toggle.active {
      border-color: rgba(180, 157, 224, 0.72);
      background: rgba(124, 77, 170, 0.66);
    }

    button.toggle:disabled {
      opacity: 0.58;
      cursor: wait;
    }

    .status {
      min-height: 18px;
      padding: 5px 10px 0;
      color: var(--muted);
      font-size: 11px;
    }

    .content {
      flex: 1;
      margin: 8px 10px 10px;
      padding: 10px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      color: var(--text);
      background: var(--surface-strong);
      border: 1px solid rgba(180, 157, 224, 0.18);
      font-family: var(--vscode-editor-font-family), Consolas, monospace;
      font-size: 12px;
      line-height: 1.6;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 10px 10px;
      justify-content: flex-end;
    }

    button.action {
      border: 1px solid rgba(180, 157, 224, 0.32);
      background: rgba(124, 77, 170, 0.78);
      color: #ffffff;
      min-height: 28px;
      padding: 0 10px;
      font: inherit;
      cursor: pointer;
    }

    button.action:hover {
      background: rgba(155, 107, 191, 0.92);
    }

    .no-actions {
      color: var(--muted);
      font-size: 11px;
      padding: 4px 0;
    }
  </style>
</head>
<body>
  ${body}
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("[data-command]").forEach((button) => {
      button.addEventListener("click", () => {
        vscode.postMessage({ command: button.dataset.command });
      });
    });
    document.querySelectorAll("[data-action-id]").forEach((button) => {
      button.addEventListener("click", () => {
        vscode.postMessage({
          command: "runNotificationAction",
          actionId: button.dataset.actionId
        });
      });
    });
  </script>
</body>
</html>`;
  }
}

function formatNotificationTime(date) {
  const t = date instanceof Date ? date : new Date();
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NOTIFICATION_BRIDGE_KEY = Symbol.for("customDevTools.runtime.notificationBridge");
const NOTIFICATION_DOM_BRIDGE_PORTS = [17891, 17892, 17893, 17894, 17895];

function installNotificationBridge(notifProvider, context, actionBridge) {
  const existing = globalThis[NOTIFICATION_BRIDGE_KEY];
  if (existing) {
    existing.providers.add(notifProvider);
    context.subscriptions.push({
      dispose() {
        existing.providers.delete(notifProvider);
      }
    });
    return;
  }

  const providers = new Set([notifProvider]);
  const originals = {};
  const seen = new Map();

  const record = (type, message, original, actions = [], notificationKey = "") => {
    const text = normalizeNotificationText(message);
    if (!text) {
      return null;
    }

    const now = Date.now();
    const key = notificationKey || `${type}:${text}`;
    if (now - (seen.get(key) || 0) < 1500) {
      const existing = Array.from(providers)
        .flatMap((provider) => provider.items || [])
        .find((item) => item.notificationKey === key);
      if (existing && actions.length > 0) {
        for (const provider of providers) {
          provider.updateActions(existing, actions);
        }
      }
      return existing || null;
    }
    seen.set(key, now);

    let recordedItem = null;
    for (const provider of providers) {
      recordedItem = provider.push(type, text, original, "", actions, key) || recordedItem;
    }
    return recordedItem;
  };

  const patchMessageMethod = (method, type) => {
    const original = vscode.window[method];
    if (typeof original !== "function") {
      return;
    }

    originals[method] = original;
    vscode.window[method] = function patchedShowMessage(message, ...items) {
      const extracted = extractMessageActions(items);
      const notificationKey = `api:${type}:${hashNotificationText(message)}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const actions = extracted.actions.map((action, index) => ({
        id: `${notificationKey}:action:${index}:${hashNotificationText(action.label)}`,
        label: action.label
      }));
      const nativeThenable = original.call(vscode.window, message, ...items);
      if (!actions.length || !actionBridge || typeof actionBridge.registerApiAction !== "function") {
        return nativeThenable;
      }

      let settled = false;
      let resolveBridge;
      let rejectBridge;
      const bridgedThenable = new Promise((resolve, reject) => {
        resolveBridge = resolve;
        rejectBridge = reject;
      });

      extracted.actions.forEach((action, index) => {
        actionBridge.registerApiAction({
          id: actions[index].id,
          key: notificationKey,
          label: action.label,
          value: action.value,
          resolve(value) {
            if (settled) {
              return;
            }
            settled = true;
            actionBridge.clearApiActions(notificationKey);
            resolveBridge(value);
          }
        });
      });

      Promise.resolve(nativeThenable).then(
        (value) => {
          if (!settled) {
            settled = true;
            actionBridge.clearApiActions(notificationKey);
            resolveBridge(value);
          }
        },
        (error) => {
          if (!settled) {
            settled = true;
            actionBridge.clearApiActions(notificationKey);
            rejectBridge(error);
          }
        }
      );

      return bridgedThenable;
    };
  };

  try {
    patchMessageMethod("showInformationMessage", "info");
    patchMessageMethod("showWarningMessage", "warn");
    patchMessageMethod("showErrorMessage", "error");

    const originalWithProgress = vscode.window.withProgress;
    if (typeof originalWithProgress === "function") {
      originals.withProgress = originalWithProgress;
      vscode.window.withProgress = function patchedWithProgress(options, task) {
        if (!options || options.location !== vscode.ProgressLocation.Notification) {
          return originalWithProgress.call(vscode.window, options, task);
        }

        const title = normalizeNotificationText(options.title || "진행 알림");
        record("info", title);

        return originalWithProgress.call(vscode.window, options, (progress, token) => {
          const bridgedProgress = {
            report(value) {
              const message = normalizeNotificationText(value && value.message);
              if (message) {
                record("info", title ? `${title}: ${message}` : message);
              }
              return progress.report(value);
            }
          };

          return task(bridgedProgress, token);
        });
      };
    }

    const bridge = { providers, originals };
    globalThis[NOTIFICATION_BRIDGE_KEY] = bridge;
    context.subscriptions.push({
      dispose() {
        bridge.providers.delete(notifProvider);
        if (bridge.providers.size > 0) {
          return;
        }

        for (const [method, original] of Object.entries(bridge.originals)) {
          vscode.window[method] = original;
        }
        if (globalThis[NOTIFICATION_BRIDGE_KEY] === bridge) {
          delete globalThis[NOTIFICATION_BRIDGE_KEY];
        }
      }
    });
  } catch (error) {
    notifProvider.push("warn", "VS Code 기본 알림 동기화를 설치하지 못했습니다", error && error.message ? error.message : String(error));
  }
}

function normalizeNotificationText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "object" && typeof value.message === "string") {
    return value.message.trim();
  }
  return String(value).trim();
}

function extractMessageActions(items) {
  const args = Array.isArray(items) ? items.slice() : [];
  if (args.length > 0 && isMessageOptions(args[0])) {
    args.shift();
  }

  const actions = [];
  for (const value of args) {
    const label = notificationActionLabel(value);
    if (!label) {
      continue;
    }
    actions.push({ label, value });
  }

  return { actions };
}

function isMessageOptions(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.title !== "string" &&
      ("modal" in value || "detail" in value)
  );
}

function notificationActionLabel(value) {
  if (typeof value === "string") {
    return normalizeNotificationText(value);
  }
  if (value && typeof value === "object" && typeof value.title === "string") {
    return normalizeNotificationText(value.title);
  }
  return "";
}

function hashNotificationText(value) {
  const text = normalizeNotificationText(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function collectDiagnosticNotifications() {
  const result = [];
  const allDiagnostics = vscode.languages.getDiagnostics();

  for (const [uri, diagnostics] of allDiagnostics) {
    const fileName = path.basename(uri.fsPath || uri.path || uri.toString());
    for (const diagnostic of diagnostics) {
      if (
        diagnostic.severity !== vscode.DiagnosticSeverity.Error &&
        diagnostic.severity !== vscode.DiagnosticSeverity.Warning
      ) {
        continue;
      }

      const message = normalizeNotificationText(diagnostic.message);
      if (!message) {
        continue;
      }

      const start = diagnostic.range && diagnostic.range.start ? diagnostic.range.start : { line: 0, character: 0 };
      const line = typeof start.line === "number" ? start.line + 1 : 1;
      const character = typeof start.character === "number" ? start.character + 1 : 1;
      const source = normalizeNotificationText(diagnostic.source);
      const sourceLabel = source ? `${fileName} · ${source}` : fileName;
      const type = diagnostic.severity === vscode.DiagnosticSeverity.Error ? "error" : "warn";
      const key = [
        DIAGNOSTIC_NOTIFICATION_PREFIX,
        hashNotificationText(uri.toString()),
        line,
        character,
        hashNotificationText(message)
      ].join(":");

      result.push({
        key,
        type,
        message,
        original: `${message} [${fileName}:${line}:${character}]`,
        source: sourceLabel
      });
    }
  }

  return result.slice(0, 100);
}

class NotificationDomBridgeServer {
  constructor(notifProvider) {
    this.notifProvider = notifProvider;
    this.server = null;
    this.port = null;
    this.seen = new Map();
    this.actionQueue = [];
    this.apiActions = new Map();
  }

  async start() {
    for (const port of NOTIFICATION_DOM_BRIDGE_PORTS) {
      try {
        await this.listen(port);
        this.port = port;
        return;
      } catch {
        // Try the next known bridge port.
      }
    }

    this.notifProvider.push(
      "warn",
      "기본 알림 센터 동기화 서버를 시작하지 못했습니다",
      `사용 가능한 포트: ${NOTIFICATION_DOM_BRIDGE_PORTS.join(", ")}`
    );
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => this.handleRequest(request, response));
      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server;
        resolve();
      });
    });
  }

  handleRequest(request, response) {
    this.writeCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/actions") {
      const actions = this.actionQueue.splice(0);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ actions }));
      return;
    }

    const requestPath = String(request.url || "").split("?")[0];
    if (
      request.method !== "POST" ||
      !["/notification", "/notification-removed", "/notifications-sync"].includes(requestPath)
    ) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false }));
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        if (requestPath === "/notification-removed") {
          this.removeRecord(payload);
        } else if (requestPath === "/notifications-sync") {
          this.syncRecords(payload);
        } else {
          this.record(payload);
        }
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }));
      }
    });
  }

  writeCorsHeaders(response) {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
  }

  record(payload) {
    const message = normalizeNotificationText(payload && payload.message);
    if (!message) {
      return;
    }

    const source = normalizeNotificationText(payload && payload.source);
    const type = normalizeNotificationType(payload && payload.type);
    const actions = normalizeNotificationActions(payload && payload.actions);
    const notificationKey = normalizeNotificationText(payload && payload.key);
    const key = notificationKey || `${type}:${source}:${message}`;

    // Only update actions on existing items — new notifications come from syncFromNotifications
    const existing = this.notifProvider.items.find((item) => item.notificationKey === key);
    if (existing && actions.length > 0) {
      this.notifProvider.updateActions(existing, actions);
    }
  }

  syncRecords(payload) {
    const notifications = Array.isArray(payload && payload.notifications) ? payload.notifications : [];
    this.notifProvider.syncFromNotifications(notifications);
  }

  removeRecord(payload) {
    const key = normalizeNotificationText(payload && payload.key);
    if (!key) {
      return;
    }
    this.notifProvider.removeByKey(key);
    this.clearApiActions(key);
  }

  async enqueueDismiss(item) {
    if (!item || !item.notificationKey || item.notificationKey.startsWith(DIAGNOSTIC_NOTIFICATION_PREFIX)) {
      return;
    }
    await this.revealNotificationCenter();
    this.actionQueue.push({
      type: "dismissNotification",
      key: item.notificationKey,
      createdAt: Date.now()
    });
    if (this.actionQueue.length > 50) {
      this.actionQueue.splice(0, this.actionQueue.length - 50);
    }
  }

  async enqueueAction(action) {
    const id = normalizeNotificationText(action && action.id ? action.id : action);
    if (!id) {
      return;
    }
    if (this.resolveApiAction(action)) {
      return;
    }
    await this.revealNotificationCenter();
    this.actionQueue.push({
      id,
      label: normalizeNotificationText(action && action.label),
      key: normalizeNotificationText(action && action.key),
      createdAt: Date.now()
    });
    if (this.actionQueue.length > 50) {
      this.actionQueue.splice(0, this.actionQueue.length - 50);
    }
  }

  async revealNotificationCenter() {
    const commands = [
      "notifications.showList",
      "workbench.action.showNotifications",
      "notifications.toggleList",
      "workbench.action.toggleNotifications"
    ];

    for (const command of commands) {
      try {
        await vscode.commands.executeCommand(command);
        return true;
      } catch {
        // Try the next known notification command.
      }
    }
    return false;
  }

  registerApiAction(action) {
    if (!action || !action.id || typeof action.resolve !== "function") {
      return;
    }
    this.apiActions.set(action.id, {
      ...action,
      createdAt: Date.now()
    });
  }

  resolveApiAction(action) {
    const id = normalizeNotificationText(action && action.id ? action.id : action);
    const key = normalizeNotificationText(action && action.key);
    const label = normalizeNotificationText(action && action.label);
    let entry = this.apiActions.get(id);

    if (!entry && key && label) {
      entry = Array.from(this.apiActions.values()).find(
        (candidate) => candidate.key === key && candidate.label === label
      );
    }

    if (!entry) {
      return false;
    }

    entry.resolve(entry.value);
    this.clearApiActions(entry.key);
    return true;
  }

  clearApiActions(key) {
    const normalizedKey = normalizeNotificationText(key);
    if (!normalizedKey) {
      return;
    }
    for (const [id, action] of this.apiActions) {
      if (action.key === normalizedKey) {
        this.apiActions.delete(id);
      }
    }
  }

  dispose() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

function normalizeNotificationType(type) {
  if (type === "error" || type === "warn" || type === "info") {
    return type;
  }
  if (type === "warning") {
    return "warn";
  }
  return "info";
}

class RuntimeProvider {
  constructor(controller, kind) {
    this.controller = controller;
    this.kind = kind;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  async getChildren(element) {
    if (element && element.children) {
      return element.children;
    }
    return this.controller.getNodes(this.kind);
  }

  getTreeItem(node) {
    const collapsibleState = node.children
      ? (node.collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed)
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsibleState);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip || node.description || node.label;
    item.contextValue = node.contextValue || "customDevToolsOpenable";

    // resourceUri를 설정하면 material-icon-theme이 파일/폴더 아이콘을 자동 적용
    if (node.filePath) {
      item.resourceUri = vscode.Uri.file(node.filePath);
      if (node.running) {
        item.iconPath = new vscode.ThemeIcon("debug-stop");
      }
      // 실행 중이 아니면 iconPath 미설정 → 아이콘 테마가 .java/.py 등 파일 아이콘 적용
    } else if (node.dirPath) {
      item.resourceUri = vscode.Uri.file(node.dirPath);
      // iconPath 미설정 → 아이콘 테마가 폴더 아이콘 적용
    } else {
      item.iconPath = node.iconPath || getIcon(node);
    }

    if (node.filePath) {
      item.command = { command: "customDevTools.runtime.openFile", title: "파일 열기", arguments: [node] };
    } else if (node.contextValue === 'customDevToolsDbTable') {
      item.command = { command: "customDevTools.runtime.openTableData", title: "테이블 데이터", arguments: [node] };
    } else if (node.contextValue === 'customDevToolsRedisKey') {
      item.command = { command: "customDevTools.runtime.openRedisKeyData", title: "Redis 키 데이터", arguments: [node] };
    } else if (node.contextValue === 'customDevToolsDbConn') {
      item.command = { command: "customDevTools.runtime.editDbConnection", title: "연결 편집", arguments: [node] };
    } else if (node.contextValue === 'customDevToolsDbAddConn') {
      item.command = { command: "customDevTools.runtime.addDbConnection", title: "DB 연결 추가", arguments: [node] };
    } else if (node.contextValue === 'customDevToolsDbConnTest') {
      item.command = { command: "customDevTools.runtime.testDbConnection", title: "연결 테스트", arguments: [node] };
    } else if (node.contextValue === 'customDevToolsDbConnDelete') {
      item.command = { command: "customDevTools.runtime.removeDbConnection", title: "연결 삭제", arguments: [node] };
    } else if (node.contextValue === 'customDevToolsSpringEndpoint') {
      item.command = { command: "customDevTools.runtime.testEndpoint", title: "HTTP 테스트", arguments: [node] };
    } else if (node.contextValue === 'customDevToolsSpringController') {
      item.command = { command: "customDevTools.runtime.openFile", title: "파일 열기", arguments: [node] };
    }

    return item;
  }
}

// ── 사이드바 연결 편집 폼 WebviewView ──────────────────────────────────────

class DatabaseConnectionFormProvider {
  constructor(dbConnMgr, controller) {
    this.dbConnMgr = dbConnMgr;
    this.controller = controller;
    this._view = null;
    this._pendingConn = null;
    this._statusMessage = "";
    this._statusType = "info";
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'save') {
        await this.dbConnMgr.update(msg.id, msg.changes);
        this.controller.refreshAll();
        this._statusType = "ok";
        this._statusMessage = `'${msg.changes.name || ''}' 연결이 수정되었습니다.`;
        await this._showIdle();
      } else if (msg.type === 'cancel') {
        await this._showIdle();
      } else if (msg.type === 'delete') {
        await this.dbConnMgr.remove(msg.id);
        this.controller.refreshAll();
        this._statusType = "warn";
        this._statusMessage = "연결을 목록에서 제거했습니다.";
        await this._showIdle();
      } else if (msg.type === 'select') {
        await this.dbConnMgr.select(msg.id);
        this.controller.refreshAll();
        this._statusType = "ok";
        this._statusMessage = "선택한 데이터베이스만 위쪽 트리에 표시됩니다.";
        await this._showIdle();
      } else if (msg.type === 'disconnect') {
        await this.dbConnMgr.disconnect();
        this.controller.refreshAll();
        this._statusType = "warn";
        this._statusMessage = "데이터베이스 연결 표시를 해제했습니다. 연결 정보는 목록에 남아 있습니다.";
        await this._showIdle();
      } else if (msg.type === 'add') {
        await addDbConnection(this.dbConnMgr, this.controller.dbInspector, this.controller);
        this._statusType = "ok";
        this._statusMessage = "새 연결 오브젝트를 만들었습니다. 정보를 입력한 뒤 저장하거나 테스트하세요.";
        await this._showIdle();
      } else if (msg.type === 'test') {
        const baseConn = this.dbConnMgr.get(msg.id);
        const conn = baseConn && msg.changes ? { ...baseConn, ...msg.changes } : baseConn;
        if (!conn) {
          this._statusType = "error";
          this._statusMessage = "연결을 찾을 수 없습니다.";
        } else {
          const result = await this.controller.testDbConnection(conn);
          this._statusType = result.ok ? "ok" : "error";
          this._statusMessage = result.message;
        }
        this.controller.refreshAll();
        await this._showIdle();
      }
    });
    if (this._pendingConn) {
      this.dbConnMgr.select(this._pendingConn.id).then(() => {
        this.controller.refreshAll();
        this._showIdle();
      });
      this._pendingConn = null;
    } else {
      this._showIdle();
    }
  }

  showEdit(conn) {
    if (!conn) return;
    this.dbConnMgr.select(conn.id).then(() => {
      this.controller.refreshAll();
      if (this._view) {
        this._view.show(true);
        this._showIdle();
      } else {
        this._pendingConn = conn;
        vscode.commands.executeCommand('customDevTools.runtime.dbConnectionForm.focus');
      }
    });
  }

  _showLegacyForm(conn) {
    if (this._view) {
      this._view.show(true);
      this._renderForm(conn);
    } else {
      this._pendingConn = conn;
      vscode.commands.executeCommand('customDevTools.runtime.dbConnectionForm.focus');
    }
  }

  async _showIdle() {
    if (!this._view) return;
    if (this.controller && typeof this.controller.syncDetectedDatabaseConnections === "function") {
      await this.controller.syncDetectedDatabaseConnections();
    }
    const conns = this.dbConnMgr.getAll();
    const selected = this.dbConnMgr.getSelected();
    const selectedId = selected && selected.id;
    const items = conns.map(c => {
      const detail = formatDbConnectionDetail(c);
      const active = c.id === selectedId;
      const sourceLabel = connectionSourceLabel(c);
      return `<div class="conn-item ${active ? 'active' : ''}" data-id="${escHtml(c.id)}">
        <button class="conn-main" data-action="select" data-id="${escHtml(c.id)}">
          <span class="conn-name">${escHtml(c.name)}</span>
          <span class="conn-detail">${escHtml(sourceLabel)} · ${escHtml(formatDbConnectionType(c))} · ${escHtml(detail)}</span>
        </button>
        <div class="conn-actions">
          <button data-action="select" data-id="${escHtml(c.id)}">${active ? '선택됨' : '선택'}</button>
          <button data-action="test" data-id="${escHtml(c.id)}">테스트</button>
          <button class="danger" data-action="delete" data-id="${escHtml(c.id)}">목록 제거</button>
        </div>
      </div>`;
    }).join('');
    const passwordHint = selected && selected.hasPassword ? '저장된 비밀번호 유지' : '비밀번호 입력';
    const form = selected ? `
<section class="editor-box">
  <h4>선택된 연결</h4>
  <label>연결 이름</label><input id="name" value="${escHtml(selected.name)}" />
  <label>유형</label>
  <select id="type">
    ${dbConnectionTypeOptions(selected.type)}
  </select>
  <div id="sqlite-fields">
    <label>파일 경로</label><input id="path" value="${escHtml(selected.path || '')}" />
  </div>
  <div id="network-fields">
    <div id="container-field"><label>컨테이너</label><input id="containerName" value="${escHtml(selected.containerName || '')}" placeholder="Docker 컨테이너 이름" /></div>
    <div class="row"><div><label>주소</label><input id="host" value="${escHtml(selected.host || 'localhost')}" /></div>
    <div><label>포트</label><input id="port" value="${escHtml(String(selected.port || ''))}" /></div></div>
    <div id="database-fields">
      <label>데이터베이스</label><input id="database" value="${escHtml(selected.database || '')}" />
      <label>아이디</label><input id="user" value="${escHtml(selected.user || '')}" />
    </div>
    <label>비밀번호</label><input id="password" type="password" value="" placeholder="${escHtml(passwordHint)}" autocomplete="off" />
  </div>
  <div class="actions">
    <button class="btn btn-save" id="save">저장</button>
    <button class="btn btn-test" id="test">테스트</button>
  </div>
  <div class="actions">
    <button class="btn btn-cancel" id="disconnect">연결해제</button>
    <button class="btn btn-delete" id="del">목록에서 제거</button>
  </div>
</section>` : `
<section class="empty">목록에서 데이터베이스를 선택하면 위쪽 트리에 해당 데이터베이스만 표시됩니다.</section>`;
    const status = this._statusMessage
      ? `<div class="status ${escHtml(this._statusType)}">${escHtml(this._statusMessage)}</div>`
      : "";
    this._view.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{background:var(--vscode-sideBar-background,#1e1e1e);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:12px;margin:0;padding:8px}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
h4{margin:0;font-size:11px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.05em}
label{display:block;margin:8px 0 3px;font-size:10px;color:var(--vscode-descriptionForeground)}
input,select{width:100%;padding:4px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:3px;font-size:12px}
input:focus,select:focus{outline:1px solid var(--vscode-focusBorder);border-color:var(--vscode-focusBorder)}
input[readonly]{opacity:.6;cursor:not-allowed}
.hidden{display:none}
button{font-family:inherit}
.add-btn{width:22px;height:22px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}
.conn-item{padding:7px;border-radius:5px;border:1px solid var(--vscode-panel-border,transparent);margin-bottom:6px;background:color-mix(in srgb,var(--vscode-sideBar-background,#1e1e1e) 88%,var(--vscode-list-hoverBackground,#333))}
.conn-item.active{border-color:var(--vscode-focusBorder,#6c6);background:color-mix(in srgb,var(--vscode-list-activeSelectionBackground,#264f78) 30%,var(--vscode-sideBar-background,#1e1e1e))}
.conn-main{display:block;width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.conn-item:hover{border-color:var(--vscode-focusBorder,#555)}
.conn-name{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conn-detail{display:block;font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conn-actions{display:flex;gap:4px;margin-top:7px}
.conn-actions button{flex:1;min-width:0;padding:3px 4px;border-radius:3px;border:1px solid var(--vscode-button-secondaryBorder,var(--vscode-panel-border,#555));background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));font-size:10px;cursor:pointer}
.conn-actions button:hover{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground))}
.conn-actions .danger{color:#f28b82;border-color:#f28b8255}
.editor-box{margin-top:10px;padding-top:10px;border-top:1px solid var(--vscode-panel-border,#444)}
.row{display:flex;gap:6px}.row>div{flex:1;min-width:0}
.actions{display:flex;gap:6px;margin-top:8px}
.btn{flex:1;padding:5px 0;border:none;border-radius:3px;cursor:pointer;font-size:11px}
.btn-save{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-save:hover{background:var(--vscode-button-hoverBackground)}
.btn-test{background:transparent;color:#89d185;border:1px solid #89d18555}
.btn-test:hover{background:#89d18522}
.btn-cancel{background:transparent;color:var(--vscode-foreground);border:1px solid #555}
.btn-delete{background:transparent;color:#f28b82;border:1px solid #f28b8255}
.btn-delete:hover{background:#f28b8220}
.empty{color:var(--vscode-descriptionForeground);font-size:11px;padding:8px;border:1px dashed var(--vscode-panel-border,#444);border-radius:5px}
.status{margin-bottom:8px;padding:6px 7px;border-radius:4px;font-size:11px;line-height:1.35;border:1px solid var(--vscode-panel-border,#444)}
.status.ok{color:#89d185;border-color:#89d18555;background:#89d18514}
.status.error{color:#f28b82;border-color:#f28b8255;background:#f28b8214}
.status.warn{color:#cca700;border-color:#cca70055;background:#cca70014}
</style></head><body>
<header><h4>연결 설정 관리</h4><button class="add-btn" id="add" title="DB 연결 추가">+</button></header>
${status}
${conns.length ? items : '<div class="empty">등록된 연결이 없습니다.</div>'}
${form}
<script>
const vscode = acquireVsCodeApi();
const selectedId = ${JSON.stringify(selectedId || '')};
document.getElementById('add').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const type = button.dataset.action;
    const id = button.dataset.id;
    if (type === 'delete' && !confirm('이 연결을 삭제할까요?')) return;
    vscode.postMessage({ type, id });
  });
});
const save = document.getElementById('save');
const typeSelect = document.getElementById('type');
function currentType() {
  return typeSelect ? typeSelect.value : '';
}
function isDockerType(type) {
  return /-docker$/.test(type);
}
function isRedisType(type) {
  return /redis/.test(type);
}
function updateFieldVisibility() {
  const type = currentType();
  const sqliteFields = document.getElementById('sqlite-fields');
  const networkFields = document.getElementById('network-fields');
  const databaseFields = document.getElementById('database-fields');
  const containerField = document.getElementById('container-field');
  if (sqliteFields) sqliteFields.classList.toggle('hidden', type !== 'sqlite');
  if (networkFields) networkFields.classList.toggle('hidden', type === 'sqlite');
  if (databaseFields) databaseFields.classList.toggle('hidden', isRedisType(type));
  if (containerField) containerField.classList.toggle('hidden', !isDockerType(type));
}
if (typeSelect) {
  typeSelect.addEventListener('change', updateFieldVisibility);
  updateFieldVisibility();
}
function collectChanges() {
  const changes = { name: document.getElementById('name').value };
  const type = currentType();
  changes.type = type;
  if (type === 'sqlite') {
    changes.path = document.getElementById('path').value;
  } else {
    changes.host = document.getElementById('host').value;
    changes.port = document.getElementById('port').value;
    changes.containerName = document.getElementById('containerName').value;
    if (!isRedisType(type)) {
      changes.database = document.getElementById('database').value;
      changes.user = document.getElementById('user').value;
    }
    const password = document.getElementById('password').value;
    if (password) changes.password = password;
  }
  return changes;
}
if (save) {
  save.addEventListener('click', () => {
    vscode.postMessage({ type: 'save', id: selectedId, changes: collectChanges() });
  });
}
const test = document.getElementById('test');
if (test) test.addEventListener('click', () => vscode.postMessage({ type: 'test', id: selectedId, changes: collectChanges() }));
const disconnect = document.getElementById('disconnect');
if (disconnect) disconnect.addEventListener('click', () => vscode.postMessage({ type: 'disconnect' }));
const del = document.getElementById('del');
if (del) del.addEventListener('click', () => {
  if (confirm('이 연결 정보를 목록에서 제거할까요?')) vscode.postMessage({ type: 'delete', id: selectedId });
});
</script></body></html>`;
  }

  _renderForm(conn) {
    if (!this._view) return;
    const isSqlite = conn.type === 'sqlite';
    const passwordHint = conn.hasPassword ? '저장된 비밀번호 유지' : '비밀번호 입력';
    this._view.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{background:var(--vscode-sideBar-background,#1e1e1e);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:12px;margin:0;padding:8px}
h4{margin:0 0 10px;font-size:11px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.05em}
label{display:block;margin-bottom:3px;font-size:10px;color:var(--vscode-descriptionForeground)}
input{width:100%;padding:4px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:3px;font-size:12px;margin-bottom:8px;box-sizing:border-box}
input:focus{outline:1px solid var(--vscode-focusBorder);border-color:var(--vscode-focusBorder)}
input[readonly]{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:6px}.row>div{flex:1}
.actions{display:flex;gap:6px;margin-top:4px}
.btn{flex:1;padding:5px 0;border:none;border-radius:3px;cursor:pointer;font-size:11px}
.btn-save{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-save:hover{background:var(--vscode-button-hoverBackground)}
.btn-cancel{background:transparent;color:var(--vscode-foreground);border:1px solid #555}
.btn-test{background:transparent;color:#89d185;border:1px solid #89d18555}
.btn-test:hover{background:#89d18522}
.btn-delete{background:transparent;color:#e57373;border:1px solid #e5737355}
.btn-delete:hover{background:#e5737320}
</style></head><body>
<h4>연결 편집</h4>
<label>연결 이름</label><input id="name" value="${escHtml(conn.name)}" />
<label>유형</label><input id="type" value="${escHtml(conn.type)}" readonly />
${isSqlite ? `<label>파일 경로</label><input id="path" value="${escHtml(conn.path || '')}" />` : `
<div class="row"><div><label>호스트</label><input id="host" value="${escHtml(conn.host || 'localhost')}" /></div>
<div><label>포트</label><input id="port" value="${escHtml(String(conn.port || ''))}" /></div></div>
<label>데이터베이스</label><input id="database" value="${escHtml(conn.database || '')}" />
<label>사용자</label><input id="user" value="${escHtml(conn.user || '')}" />
<label>비밀번호</label><input id="password" type="password" value="" placeholder="${escHtml(passwordHint)}" autocomplete="off" />`}
<div class="actions">
  <button class="btn btn-save" id="save">저장</button>
  <button class="btn btn-test" id="test">테스트</button>
  <button class="btn btn-cancel" id="cancel">취소</button>
  <button class="btn btn-delete" id="del">삭제</button>
</div>
<script>
const vscode = acquireVsCodeApi();
const id = ${JSON.stringify(conn.id)};
const isSqlite = ${JSON.stringify(isSqlite)};
document.getElementById('save').onclick = () => {
  const changes = { name: document.getElementById('name').value };
  if (isSqlite) { changes.path = document.getElementById('path').value; }
  else {
    changes.host = document.getElementById('host').value;
    changes.port = document.getElementById('port').value;
    changes.database = document.getElementById('database').value;
    changes.user = document.getElementById('user').value;
    const password = document.getElementById('password').value;
    if (password) changes.password = password;
  }
  vscode.postMessage({ type: 'save', id, changes });
};
document.getElementById('test').onclick = () => vscode.postMessage({ type: 'test', id });
document.getElementById('cancel').onclick = () => vscode.postMessage({ type: 'cancel' });
document.getElementById('del').onclick = () => {
  if (confirm('이 연결을 삭제하시겠습니까?')) vscode.postMessage({ type: 'delete', id });
};
</script></body></html>`;
  }
}

class DatabaseConnectionSettingsProvider {
  constructor(dbConnMgr, controller, mode) {
    this.dbConnMgr = dbConnMgr;
    this.controller = controller;
    this.mode = mode === "detail" ? "detail" : "list";
    this.viewId = this.mode === "detail" ? "customDevTools.runtime.dbConnectionDetail" : "customDevTools.runtime.dbConnectionForm";
    this._view = null;
    this._pendingConn = null;
    this._statusMessage = "";
    this._statusType = "info";
    this.peers = new Set();
  }

  addPeer(provider) {
    if (provider && provider !== this) this.peers.add(provider);
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      await this._handleMessage(msg || {});
    });
    if (this._pendingConn) {
      const conn = this._pendingConn;
      this._pendingConn = null;
      this.showEdit(conn);
    } else {
      this.refresh();
    }
  }

  async _handleMessage(msg) {
    if (msg.type === "select") {
      await this.dbConnMgr.select(msg.id);
      this.controller.refreshAll();
      const conn = this.dbConnMgr.get(msg.id);
      this._setStatusForAll("info", conn
        ? `${conn.name} · ${formatDbConnectionType(conn)} · ${formatDbConnectionDetail(conn)}`
        : "선택한 연결만 데이터베이스 관리 그룹에 표시합니다.");
      await this._refreshLinked(false);
      return;
    }

    if (msg.type === "add") {
      await addDbConnection(this.dbConnMgr, this.controller.dbInspector, this.controller);
      this._setStatusForAll("ok", "새 연결 오브젝트를 만들었습니다.");
      this._focusDetail();
      await this._refreshLinked(false);
      return;
    }

    if (msg.type === "delete") {
      await this.dbConnMgr.remove(msg.id);
      this.controller.refreshAll();
      this._setStatusForAll("warn", "연결 정보를 목록에서 제거했습니다.");
      await this._refreshLinked(false);
      return;
    }

    if (msg.type === "disconnect") {
      await this.dbConnMgr.disconnect();
      this.controller.refreshAll();
      this._setStatusForAll("warn", "현재 선택된 데이터베이스 연결을 해제했습니다.");
      await this._refreshLinked(false);
      return;
    }

    if (msg.type === "save") {
      await this.dbConnMgr.update(msg.id, msg.changes || {});
      this.controller.refreshAll();
      this._setStatusForAll("ok", "연결 정보를 저장했습니다.");
      await this._refreshLinked(false);
      return;
    }

    if (msg.type === "test") {
      const baseConn = this.dbConnMgr.get(msg.id);
      const conn = baseConn && msg.changes ? { ...baseConn, ...msg.changes } : baseConn;
      if (!conn) {
        this._setStatusForAll("error", "연결 정보를 찾을 수 없습니다.");
      } else {
        const result = await this.controller.testDbConnection(conn);
        this._setStatusForAll(result.ok ? "ok" : "error", result.message);
      }
      this.controller.refreshAll();
      await this._refreshLinked(false);
    }
  }

  _setStatus(type, message) {
    this._statusType = type || "info";
    this._statusMessage = message || "";
  }

  _setStatusForAll(type, message) {
    this._setStatus(type, message);
    for (const peer of this.peers) {
      peer._setStatus(type, message);
    }
  }

  async _refreshLinked(sync = true) {
    await this.refresh(sync);
    for (const peer of this.peers) {
      await peer.refresh(false);
    }
  }

  async refresh(sync = true) {
    if (sync && this.controller && typeof this.controller.syncDetectedDatabaseConnections === "function") {
      await this.controller.syncDetectedDatabaseConnections();
    }
    if (!this._view) return;
    this._view.webview.html = this.mode === "detail" ? this._detailHtml() : this._listHtml();
  }

  showEdit(conn) {
    if (!conn) return;
    this.dbConnMgr.select(conn.id).then(async () => {
      this.controller.refreshAll();
      this._setStatusForAll("info", `${conn.name} · ${formatDbConnectionType(conn)} · ${formatDbConnectionDetail(conn)}`);
      if (this._view) {
        this._view.show(true);
      } else {
        this._pendingConn = conn;
      }
      this._focusSelf();
      await this._refreshLinked(false);
    });
  }

  _focusSelf() {
    vscode.commands.executeCommand(`${this.viewId}.focus`);
  }

  _focusDetail() {
    const detail = this.mode === "detail"
      ? this
      : Array.from(this.peers).find((peer) => peer.mode === "detail");
    if (detail) detail._focusSelf();
  }

  _statusHtml() {
    return this._statusMessage
      ? `<div class="status ${escHtml(this._statusType)}">${escHtml(this._statusMessage)}</div>`
      : "";
  }

  _connectionGroups(conns) {
    const groups = [
      { key: "docker", label: "Docker", match: (conn) => conn.source === "docker-auto" || /-docker$/.test(String(conn.type || "")) },
      { key: "local", label: "로컬 실행", match: (conn) => conn.source === "local-auto" },
      { key: "code", label: "코드/프로젝트", match: (conn) => conn.source === "code-auto" },
      { key: "manual", label: "외부/수동", match: () => true }
    ];
    const result = groups.map((group) => ({ ...group, items: [] }));
    for (const conn of conns) {
      const group = result.find((entry) => entry.match(conn));
      group.items.push(conn);
    }
    return result.filter((group) => group.items.length);
  }

  _listHtml() {
    const conns = this.dbConnMgr.getAll();
    const selected = this.dbConnMgr.getSelected();
    const selectedId = selected && selected.id;
    const groups = this._connectionGroups(conns);
    const groupsHtml = groups.length
      ? groups.map((group) => `<details class="conn-group" open>
          <summary><span>${escHtml(group.label)}</span><span class="count">${group.items.length}</span></summary>
          <div class="group-body">${group.items.map((conn) => this._connectionItem(conn, selectedId)).join("")}</div>
        </details>`).join("")
      : `<div class="empty">등록된 연결이 없습니다.</div>`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{background:var(--vscode-sideBar-background,#1e1e1e);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:12px;margin:0;padding:8px}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
h4{margin:0;font-size:11px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.05em}
button{font-family:inherit}
.add-btn{width:22px;height:22px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;font-size:16px;line-height:18px}
.add-btn:hover{background:var(--vscode-button-hoverBackground)}
.conn-group{margin:0 0 6px}
.conn-group>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;list-style:none;padding:5px 2px;color:var(--vscode-descriptionForeground);font-size:11px;font-weight:600}
.conn-group>summary::-webkit-details-marker{display:none}
.conn-group>summary:before{content:"›";display:inline-block;margin-right:4px;transform:rotate(90deg);transition:transform .12s ease;color:var(--vscode-icon-foreground)}
.conn-group:not([open])>summary:before{transform:rotate(0deg)}
.count{font-size:10px;color:var(--vscode-descriptionForeground)}
.conn-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;min-height:38px;padding:5px 6px;border-radius:5px;border:1px solid var(--vscode-panel-border,transparent);margin-bottom:4px;background:color-mix(in srgb,var(--vscode-sideBar-background,#1e1e1e) 88%,var(--vscode-list-hoverBackground,#333))}
.conn-item.active{border-color:var(--vscode-focusBorder,#6c6);background:color-mix(in srgb,var(--vscode-list-activeSelectionBackground,#264f78) 30%,var(--vscode-sideBar-background,#1e1e1e))}
.conn-item:hover{border-color:var(--vscode-focusBorder,#555)}
.icon-actions{display:flex;flex-direction:row;gap:2px;opacity:0;transition:opacity .12s ease}
.conn-item:hover .icon-actions,.conn-item:focus-within .icon-actions,.conn-item.active .icon-actions{opacity:1}
.icon-btn{width:20px;height:20px;display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:3px;background:transparent;color:var(--vscode-icon-foreground);cursor:pointer}
.icon-btn:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));border-color:var(--vscode-panel-border,#555)}
.icon-btn.danger{color:#f28b82}
.icon-btn svg{width:13px;height:13px;display:block}
.conn-main{display:block;width:100%;min-width:0;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.conn-name{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conn-detail{display:block;font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{color:var(--vscode-descriptionForeground);font-size:11px;padding:8px;border:1px dashed var(--vscode-panel-border,#444);border-radius:5px}
.status{margin-bottom:8px;padding:6px 7px;border-radius:4px;font-size:11px;line-height:1.35;border:1px solid var(--vscode-panel-border,#444)}
.status.ok{color:#89d185;border-color:#89d18555;background:#89d18514}
.status.error{color:#f28b82;border-color:#f28b8255;background:#f28b8214}
.status.warn{color:#cca700;border-color:#cca70055;background:#cca70014}
</style></head><body>
<header><h4>연결 설정 목록</h4><button class="add-btn" id="add" title="새 연결 추가" aria-label="새 연결 추가">+</button></header>
${this._statusHtml()}
${groupsHtml}
<script>
const vscode = acquireVsCodeApi();
document.getElementById('add').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const type = button.dataset.action;
    const id = button.dataset.id;
    if (type === 'delete' && !confirm('이 연결을 목록에서 제거할까요?')) return;
    vscode.postMessage({ type, id });
  });
});
</script></body></html>`;
  }

  _connectionItem(conn, selectedId) {
    const detail = formatDbConnectionDetail(conn);
    const active = conn.id === selectedId;
    const sourceLabel = connectionSourceLabel(conn);
    return `<div class="conn-item ${active ? "active" : ""}" data-id="${escHtml(conn.id)}">
      <button class="conn-main" data-action="select" data-id="${escHtml(conn.id)}" title="${escHtml(detail)}">
        <span class="conn-name">${escHtml(conn.name)}</span>
        <span class="conn-detail">${escHtml(sourceLabel)} · ${escHtml(formatDbConnectionType(conn))} · ${escHtml(detail)}</span>
      </button>
      <div class="icon-actions">
        <button class="icon-btn" data-action="test" data-id="${escHtml(conn.id)}" title="연결 테스트" aria-label="연결 테스트">${this._icon("test")}</button>
        <button class="icon-btn danger" data-action="delete" data-id="${escHtml(conn.id)}" title="목록 제거" aria-label="목록 제거">${this._icon("trash")}</button>
      </div>
    </div>`;
  }

  _detailFieldsHtml(conn, passwordHint) {
    const type = String(conn && conn.type ? conn.type : "mysql").toLowerCase();
    const common = {
      path: escHtml(conn.path || ""),
      containerName: escHtml(conn.containerName || ""),
      host: escHtml(conn.host || "localhost"),
      port: escHtml(String(conn.port || "")),
      database: escHtml(conn.database || ""),
      user: escHtml(conn.user || ""),
      passwordHint: escHtml(passwordHint)
    };
    return [
      this._fieldGroup(["sqlite"], type, `
        <label>SQLite 파일</label><input data-field="path" value="${common.path}" placeholder="C:\\path\\database.db" />
      `),
      this._fieldGroup(["mysql"], type, this._networkSqlFields(common, "3306", "root", "데이터베이스")),
      this._fieldGroup(["postgres"], type, this._networkSqlFields(common, "5432", "postgres", "데이터베이스")),
      this._fieldGroup(["redis"], type, `
        <div class="row"><div><label>주소</label><input data-field="host" value="${common.host}" placeholder="localhost" /></div>
        <div><label>포트</label><input data-field="port" value="${common.port}" placeholder="6379" inputmode="numeric" /></div></div>
        ${this._passwordField(common.passwordHint)}
      `),
      this._fieldGroup(["mysql-docker"], type, `
        <label>컨테이너</label><input data-field="containerName" value="${common.containerName}" placeholder="mysql-container" />
        ${this._networkSqlFields(common, "3306", "root", "데이터베이스")}
      `),
      this._fieldGroup(["postgres-docker"], type, `
        <label>컨테이너</label><input data-field="containerName" value="${common.containerName}" placeholder="postgres-container" />
        ${this._networkSqlFields(common, "5432", "postgres", "데이터베이스")}
      `),
      this._fieldGroup(["redis-docker"], type, `
        <label>컨테이너</label><input data-field="containerName" value="${common.containerName}" placeholder="redis-container" />
        <div class="row"><div><label>주소</label><input data-field="host" value="${common.host}" placeholder="localhost" /></div>
        <div><label>포트</label><input data-field="port" value="${common.port}" placeholder="6379" inputmode="numeric" /></div></div>
        ${this._passwordField(common.passwordHint)}
      `)
    ].join("");
  }

  _fieldGroup(types, selectedType, body) {
    const typeList = types.join(" ");
    const hidden = types.includes(selectedType) ? "" : " hidden";
    return `<div class="field-group${hidden}" data-types="${escHtml(typeList)}">${body}</div>`;
  }

  _networkSqlFields(values, portPlaceholder, userPlaceholder, databaseLabel) {
    return `
      <div class="row"><div><label>주소</label><input data-field="host" value="${values.host}" placeholder="localhost" /></div>
      <div><label>포트</label><input data-field="port" value="${values.port}" placeholder="${escHtml(portPlaceholder)}" inputmode="numeric" /></div></div>
      <label>${escHtml(databaseLabel)}</label><input data-field="database" value="${values.database}" placeholder="app" />
      <label>아이디</label><input data-field="user" value="${values.user}" placeholder="${escHtml(userPlaceholder)}" />
      ${this._passwordField(values.passwordHint)}
    `;
  }

  _passwordField(passwordHint) {
    return `<label>비밀번호</label><input data-field="password" type="password" value="" placeholder="${passwordHint}" autocomplete="off" />`;
  }

  _detailHtml() {
    const selected = this.dbConnMgr.getSelected();
    const selectedId = selected && selected.id;
    const passwordHint = selected && selected.hasPassword ? "저장된 비밀번호 유지" : "비밀번호 입력";
    const form = selected ? `<section class="editor-box">
  <div class="meta-line">${escHtml(connectionSourceLabel(selected))} · ${escHtml(formatDbConnectionType(selected))} · ${escHtml(formatDbConnectionDetail(selected))}</div>
  <label>연결 이름</label><input id="name" value="${escHtml(selected.name)}" />
  <label>유형</label>
  <select id="type">${dbConnectionTypeOptions(selected.type)}</select>
  ${this._detailFieldsHtml(selected, passwordHint)}
  <div class="actions">
    <button class="btn btn-save" id="save">저장</button>
    <button class="btn btn-test" id="test">테스트</button>
  </div>
  <div class="actions">
    <button class="btn btn-cancel" id="disconnect">연결 해제</button>
    <button class="btn btn-delete" id="del">목록 제거</button>
  </div>
</section>` : `<section class="empty">연결 설정 목록에서 데이터베이스를 선택하세요.</section>`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{background:var(--vscode-sideBar-background,#1e1e1e);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:12px;margin:0;padding:8px}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
h4{margin:0;font-size:11px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.05em}
label{display:block;margin:8px 0 3px;font-size:10px;color:var(--vscode-descriptionForeground)}
input,select{width:100%;padding:4px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:3px;font-size:12px}
input:focus,select:focus{outline:1px solid var(--vscode-focusBorder);border-color:var(--vscode-focusBorder)}
button{font-family:inherit}
.hidden{display:none}
.meta-line{margin-bottom:8px;color:var(--vscode-descriptionForeground);font-size:10px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row{display:flex;gap:6px}.row>div{flex:1;min-width:0}
.actions{display:flex;gap:6px;margin-top:8px}
.btn{flex:1;padding:5px 0;border:none;border-radius:3px;cursor:pointer;font-size:11px}
.btn-save{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-save:hover{background:var(--vscode-button-hoverBackground)}
.btn-test{background:transparent;color:#89d185;border:1px solid #89d18555}
.btn-test:hover{background:#89d18522}
.btn-cancel{background:transparent;color:var(--vscode-foreground);border:1px solid #555}
.btn-delete{background:transparent;color:#f28b82;border:1px solid #f28b8255}
.btn-delete:hover{background:#f28b8220}
.empty{color:var(--vscode-descriptionForeground);font-size:11px;padding:8px;border:1px dashed var(--vscode-panel-border,#444);border-radius:5px}
.status{margin-bottom:8px;padding:6px 7px;border-radius:4px;font-size:11px;line-height:1.35;border:1px solid var(--vscode-panel-border,#444)}
.status.ok{color:#89d185;border-color:#89d18555;background:#89d18514}
.status.error{color:#f28b82;border-color:#f28b8255;background:#f28b8214}
.status.warn{color:#cca700;border-color:#cca70055;background:#cca70014}
</style></head><body>
<header><h4>선택된 연결 설정</h4></header>
${this._statusHtml()}
${form}
<script>
const vscode = acquireVsCodeApi();
const selectedId = ${JSON.stringify(selectedId || "")};
const typeSelect = document.getElementById('type');
function currentType() { return typeSelect ? typeSelect.value : ''; }
function updateFieldVisibility() {
  const type = currentType();
  document.querySelectorAll('.field-group').forEach((group) => {
    const types = (group.dataset.types || '').split(/\s+/).filter(Boolean);
    group.classList.toggle('hidden', !types.includes(type));
  });
}
if (typeSelect) {
  typeSelect.addEventListener('change', updateFieldVisibility);
  updateFieldVisibility();
}
function activeGroup() {
  return document.querySelector('.field-group:not(.hidden)');
}
function readField(group, name) {
  const input = group && group.querySelector('[data-field="' + name + '"]');
  return input ? input.value : undefined;
}
function collectChanges() {
  const changes = { name: document.getElementById('name').value, type: currentType() };
  const group = activeGroup();
  for (const field of ['path', 'containerName', 'host', 'port', 'database', 'user']) {
    const value = readField(group, field);
    if (value !== undefined) changes[field] = value;
  }
  const password = readField(group, 'password');
  if (password) changes.password = password;
  return changes;
}
const save = document.getElementById('save');
if (save) save.addEventListener('click', () => vscode.postMessage({ type: 'save', id: selectedId, changes: collectChanges() }));
const test = document.getElementById('test');
if (test) test.addEventListener('click', () => vscode.postMessage({ type: 'test', id: selectedId, changes: collectChanges() }));
const disconnect = document.getElementById('disconnect');
if (disconnect) disconnect.addEventListener('click', () => vscode.postMessage({ type: 'disconnect' }));
const del = document.getElementById('del');
if (del) del.addEventListener('click', () => {
  if (confirm('이 연결을 목록에서 제거할까요?')) vscode.postMessage({ type: 'delete', id: selectedId });
});
</script></body></html>`;
  }

  _icon(name) {
    if (name === "trash") {
      return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11"/><path d="M6.5 2.5h3"/><path d="M4.5 4l.5 9h6l.5-9"/><path d="M6.5 6.5v4"/><path d="M9.5 6.5v4"/></svg>`;
    }
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v4"/><path d="M10 2v4"/><path d="M4.5 6h7v2.5a3.5 3.5 0 0 1-7 0V6z"/><path d="M8 12v2"/></svg>`;
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDbConnectionType(conn) {
  const type = String(conn && conn.type ? conn.type : "").toLowerCase();
  if (type === "sqlite") return "SQLite";
  if (type === "postgres") return "PostgreSQL";
  if (type === "mysql") return "MySQL";
  if (type === "redis") return "Redis";
  if (type === "mysql-docker") return "MySQL 컨테이너";
  if (type === "postgres-docker") return "PostgreSQL 컨테이너";
  if (type === "redis-docker") return "Redis 컨테이너";
  return conn && conn.type ? conn.type : "DB";
}

function dbConnectionTypeOptions(selectedType) {
  const options = [
    ["mysql", "MySQL"],
    ["postgres", "PostgreSQL"],
    ["redis", "Redis"],
    ["sqlite", "SQLite"],
    ["mysql-docker", "MySQL 컨테이너"],
    ["postgres-docker", "PostgreSQL 컨테이너"],
    ["redis-docker", "Redis 컨테이너"]
  ];
  return options
    .map(([value, label]) => `<option value="${escHtml(value)}"${value === selectedType ? " selected" : ""}>${escHtml(label)}</option>`)
    .join("");
}

function formatDbConnectionDetail(conn) {
  if (!conn) return "";
  if (conn.type === "sqlite") return conn.path || "파일 경로 없음";
  if (conn.type === "mysql-docker") return `${conn.containerName || "container"} / ${conn.database || "database"}`;
  if (conn.type === "postgres-docker") return `${conn.containerName || "container"} / ${conn.database || "database"}`;
  if (conn.type === "redis-docker") return `${conn.containerName || "container"}${conn.port ? ` / ${conn.port}` : ""}`;
  if (conn.type === "redis") return `${conn.host || "localhost"}${conn.port ? `:${conn.port}` : ""}`;
  const host = conn.host || "localhost";
  const port = conn.port ? `:${conn.port}` : "";
  const database = conn.database ? ` / ${conn.database}` : "";
  return `${host}${port}${database}`;
}

function isAutoConnectionSource(source) {
  return /-auto$/.test(String(source || ""));
}

function connectionSourceLabel(conn) {
  if (!conn) return "알 수 없음";
  if (conn.draft) return "입력 중";
  if (conn.source === "docker-auto") return "Docker 감지";
  if (conn.source === "code-auto") return "코드 감지";
  if (conn.source === "local-auto") return "로컬 감지";
  if (isAutoConnectionSource(conn.source)) return "자동 감지";
  return "수동";
}

function defaultDbUser(type) {
  if (type === "mysql") return "root";
  if (type === "postgres") return "postgres";
  return "";
}

function shortError(error, secrets = []) {
  let text = String(error && error.message ? error.message : error || "")
    .replace(/MYSQL_PWD=[^\s"'`]+/g, "MYSQL_PWD=<secret>")
    .replace(/PGPASSWORD=[^\s"'`]+/g, "PGPASSWORD=<secret>");
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(String(secret)).join("<secret>");
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || "알 수 없는 오류";
}

class RuntimeController {
  constructor(context, notifProvider) {
    this.context = context;
    this.notif = notifProvider;
    this.output = vscode.window.createOutputChannel("실행 제어");
    this.processes = new Map();
    this.providers = new Map();
    this.dockerBin = getDockerBin();
  }

  registerProvider(kind, provider) {
    this.providers.set(kind, provider);
  }

  refreshAll() {
    for (const provider of this.providers.values()) {
      provider.refresh();
    }
  }

  refreshKind(kind) {
    const provider = this.providers.get(kind);
    if (provider) provider.refresh();
  }

  getProjectRoot() {
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const testProject = workspaceFolders.find((folder) => path.basename(folder.uri.fsPath).toLowerCase() === "testproject");
    if (testProject) {
      return testProject.uri.fsPath;
    }
    if (workspaceFolders[0]) {
      return workspaceFolders[0].uri.fsPath;
    }
    return null;
  }

  async getNodes(kind) {
    const root = this.getProjectRoot();
    if (!root) {
      return [
        new RuntimeNode({
          id: `${kind}:missing-root`,
          label: "testproject 폴더를 열어주세요",
          description: "실행 목록을 만들 수 없습니다",
          iconPath: new vscode.ThemeIcon("folder-opened")
        })
      ];
    }

    if (kind === VIEW_KINDS.javaSpring) {
      return this.getJavaSpringNodes(root);
    }
    if (kind === VIEW_KINDS.springControllers) {
      return this.getSpringControllerNodes(root);
    }
    if (kind === VIEW_KINDS.python) {
      return this.getPythonNodes(root);
    }
    if (kind === VIEW_KINDS.docker) {
      return this.getDockerNodes(root);
    }
    return this.getDatabaseNodes(root);
  }

  async getJavaSpringNodes(root) {
    const files = walk(root, [".java"]);
    const entries = [];

    for (const filePath of files) {
      const text = readText(filePath);
      if (!text || !text.includes("public static void main")) {
        continue;
      }

      const className = matchFirst(text, /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/);
      const isSpring = text.includes("@SpringBootApplication") || text.includes("SpringApplication.run");
      const kind = isSpring ? "spring" : "java";
      const functionName = `${className || path.basename(filePath, ".java")}.main`;
      const id = `${kind}:${relative(root, filePath)}:${functionName}`;
      const node = this.runnableNode({
        id,
        runKind: kind,
        label: functionName,
        description: isSpring ? "Spring Boot" : "Java",
        detail: isSpring ? "Spring Boot JVM" : "Java JVM",
        filePath,
        root
      });
      entries.push({ filePath, node });
    }

    if (entries.length === 0) {
      return [emptyNode("자바/스프링 실행 항목이 없습니다")];
    }

    return autoExpandFolderTree(buildFileTree(root, entries));
  }

  async getSpringControllerNodes(root) {
    const controllers = parseSpringControllers(root);
    if (controllers.length === 0) {
      return [emptyNode("Spring 컨트롤러를 찾지 못했습니다 (@RestController / @Controller)")];
    }
    return controllers.map((ctrl) => {
      const children = ctrl.endpoints.map((ep) =>
        new RuntimeNode({
          id: `springEndpoint:${ctrl.className}:${ep.httpMethod}:${ep.path}:${ep.methodName}`,
          label: `${ep.httpMethod}  ${ep.path}`,
          description: ep.methodName,
          tooltip: `${ep.httpMethod} ${ep.path}\n메서드: ${ep.methodName}\n파일: ${ep.filePath}:${ep.lineNumber}`,
          iconPath: new vscode.ThemeIcon(springMethodIcon(ep.httpMethod)),
          contextValue: "customDevToolsSpringEndpoint",
          filePath: ep.filePath,
          endpointData: ep
        })
      );
      return new RuntimeNode({
        id: `springController:${ctrl.className}`,
        label: ctrl.className,
        description: ctrl.basePath || "",
        tooltip: `${ctrl.className}\n${ctrl.filePath}`,
        iconPath: new vscode.ThemeIcon("symbol-class"),
        contextValue: "customDevToolsSpringController",
        filePath: ctrl.filePath,
        children,
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded
      });
    });
  }

  async getPythonNodes(root) {
    const files = walk(root, [".py"]);
    const entries = [];

    for (const filePath of files) {
      const text = readText(filePath);
      if (!text) {
        continue;
      }

      const mainName = text.includes("__main__")
        ? `${path.basename(filePath)}::__main__`
        : `${path.basename(filePath)}::top-level`;
      const id = `python:${relative(root, filePath)}:${mainName}`;
      const node = this.runnableNode({
        id,
        runKind: "python",
        label: mainName,
        description: "Python",
        detail: "Python process",
        filePath,
        root
      });
      entries.push({ filePath, node });
    }

    if (entries.length === 0) {
      return [emptyNode("파이썬 실행 항목이 없습니다")];
    }

    return autoExpandFolderTree(buildFileTree(root, entries));
  }

  async getDockerNodes(root) {
    const composeFiles = this.detectDockerComposeFiles(root);
    const composeChildren = composeFiles.length
      ? await Promise.all(composeFiles.map((filePath) => this.dockerComposeFileNode(root, filePath)))
      : [emptyNode("프로젝트에서 docker compose/yml 파일을 찾지 못했습니다")];

    const [containers, images] = await Promise.all([
      this.detectDockerContainers(),
      this.detectDockerImages()
    ]);

    const containerChildren = containers.length
      ? containers.map((container) => this.dockerDesktopContainerNode(container, root))
      : [emptyNode("Docker Desktop 컨테이너가 없습니다")];

    const imageChildren = images.length
      ? images.map((image) => this.dockerImageNode(image))
      : [emptyNode("Docker Desktop 이미지가 없습니다")];

    return [
      categoryNode("docker-project-compose", "프로젝트 Docker 구성", composeChildren, vscode.TreeItemCollapsibleState.Expanded, `${composeFiles.length}개`),
      categoryNode("docker-desktop-state", "Docker Desktop", [
        categoryNode("docker-desktop-containers", "컨테이너", containerChildren, vscode.TreeItemCollapsibleState.Expanded, `${containers.length}개`),
        categoryNode("docker-desktop-images", "이미지", imageChildren, vscode.TreeItemCollapsibleState.Collapsed, `${images.length}개`)
      ], vscode.TreeItemCollapsibleState.Expanded)
    ];
  }

  detectDockerComposeFiles(root) {
    return walk(root, [".yml", ".yaml"])
      .filter((filePath) => {
        const rel = relative(root, filePath).toLowerCase();
        const base = path.basename(filePath).toLowerCase();
        return rel.startsWith("docker/") || /(^|[-_.])compose[-_.]?/.test(base) || base === "docker-compose.yml" || base === "docker-compose.yaml";
      });
  }

  async dockerComposeFileNode(root, filePath) {
    const rel = relative(root, filePath);
    const services = parseComposeServiceDetails(filePath);
    const children = services.length
      ? await Promise.all(services.map(async (service) => {
          const containerName = service.containerName || service.name;
          const running = await this.isDockerContainerRunning(containerName);
          return this.runnableNode({
            id: `docker:${rel}:${service.name}`,
            runKind: "docker",
            label: service.name,
            description: `${running ? "실행 중" : "중지됨"} · ${service.image || "compose service"}`,
            detail: "Docker Compose service",
            filePath,
            composeFile: filePath,
            containerName,
            root,
            running
          });
        }))
      : [emptyNode("services 항목이 없습니다")];

    return new RuntimeNode({
      id: `docker-compose-file:${rel}`,
      label: path.basename(filePath),
      description: rel,
      tooltip: filePath,
      filePath,
      children,
      iconPath: new vscode.ThemeIcon("file-code"),
      contextValue: "customDevToolsOpenable",
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded
    });
  }

  dockerDesktopContainerNode(container, root) {
    const running = /^(up|running)/i.test(container.status || "");
    return new RuntimeNode({
      id: `docker-desktop-container:${container.id || container.name}`,
      runKind: "docker-container",
      label: container.name,
      description: `${running ? "실행 중" : "중지됨"} · ${container.image}`,
      tooltip: [
        container.name,
        `이미지: ${container.image}`,
        container.ports ? `포트: ${container.ports}` : "",
        container.status ? `상태: ${container.status}` : ""
      ].filter(Boolean).join("\n"),
      containerName: container.name,
      image: container.image,
      root,
      running,
      contextValue: running ? "customDevToolsRunnableRunning" : "customDevToolsRunnableStopped",
      iconPath: getIcon({ running })
    });
  }

  dockerImageNode(image) {
    return new RuntimeNode({
      id: `docker-image:${image.id}:${image.repository}:${image.tag}`,
      label: `${image.repository}:${image.tag}`,
      description: `${image.size} · ${image.created}`,
      tooltip: [
        `${image.repository}:${image.tag}`,
        `ID: ${image.id}`,
        `크기: ${image.size}`,
        `생성: ${image.created}`
      ].join("\n"),
      iconPath: new vscode.ThemeIcon("package"),
      contextValue: "customDevToolsDockerImage"
    });
  }

  async getDatabaseNodes(root) {
    const dbConnMgr = this.dbConnMgr;
    const dbInspector = this.dbInspector;

    await this.syncDetectedDatabaseConnections();
    const selected = dbConnMgr && dbConnMgr.getSelected();
    const children = selected && dbInspector
      ? [await this.databaseConnectionNode(selected, dbInspector, true)]
      : [emptyNode("연결 설정 관리에서 데이터베이스를 선택하세요.")];

    return [
      categoryNode("db-selected", "데이터베이스 관리", children, vscode.TreeItemCollapsibleState.Expanded)
    ];
  }

  async databaseConnectionNode(conn, dbInspector, expand) {
    let tableNodes = [];
    let tableCount = 0;

    try {
      if (conn.type === "redis-docker" || conn.type === "redis") {
        const keys = await dbInspector.getRedisKeys(conn);
        tableCount = keys.length;
        tableNodes = keys.length
          ? keys.map((key) => new RuntimeNode({
              id: `${conn.id}:redis:${key}`,
              label: key,
              description: "Redis key",
              iconPath: new vscode.ThemeIcon("symbol-key"),
              contextValue: "customDevToolsRedisKey",
              containerName: conn.containerName,
              redisConn: conn
            }))
          : [emptyNode("키가 없습니다")];
        return new RuntimeNode({
          id: conn.id,
          label: conn.name,
          description: `${formatDbConnectionType(conn)} · ${tableCount} keys`,
          tooltip: `${conn.name}\n${formatDbConnectionType(conn)}\n${formatDbConnectionDetail(conn)}`,
          iconPath: new vscode.ThemeIcon("database"),
          contextValue: "customDevToolsDbConn",
          children: tableNodes,
          collapsibleState: expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        });
      }

      const tables = await dbInspector.getTables(conn);
      tableCount = tables.length;
      if (tables.length) {
        for (const tableName of tables) {
          let colNodes;
          try {
            const columns = await dbInspector.getColumns(conn, tableName);
            colNodes = columns.length
              ? columns.map((col) => new RuntimeNode({
                  id: `${conn.id}:col:${tableName}:${col.name}`,
                  label: col.name,
                  description: `${col.type}${col.pk ? ' PK' : ''}`,
                  iconPath: new vscode.ThemeIcon("symbol-field"),
                  contextValue: "customDevToolsDbColumn"
                }))
              : [emptyNode("컬럼 없음")];
          } catch {
            colNodes = [emptyNode("컬럼 로드 실패")];
          }

          const visibleColumns = colNodes.filter((node) => node.contextValue !== "customDevToolsInfo").length;
          tableNodes.push(new RuntimeNode({
            id: `${conn.id}:table:${tableName}`,
            label: tableName,
            description: visibleColumns ? `${visibleColumns} cols` : "",
            iconPath: new vscode.ThemeIcon("table"),
            contextValue: "customDevToolsDbTable",
            connId: conn.id,
            tableName,
            children: colNodes,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
          }));
        }
      } else {
        tableNodes = [emptyNode("테이블이 없습니다")];
      }
    } catch (error) {
      tableNodes = [emptyNode(`DB 연결 실패: ${shortError(error, [conn.password])}`)];
    }

    return new RuntimeNode({
      id: conn.id,
      label: conn.name,
      description: `${formatDbConnectionType(conn)} · ${tableCount} tables`,
      tooltip: `${conn.name}\n${formatDbConnectionType(conn)}\n${formatDbConnectionDetail(conn)}`,
      iconPath: new vscode.ThemeIcon("database"),
      contextValue: "customDevToolsDbConn",
      children: tableNodes,
      collapsibleState: expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    });
  }

  runnableNode(options) {
    const running = options.running ?? this.isRunning(options.id);
    return new RuntimeNode({
      ...options,
      running,
      contextValue: running ? "customDevToolsRunnableRunning" : "customDevToolsRunnableStopped",
      iconPath: getIcon({ running }),
      tooltip: [
        options.label,
        options.detail,
        options.filePath ? options.filePath : "",
        running ? "상태: 실행 중" : "상태: 중지됨"
      ].filter(Boolean).join("\n")
    });
  }

  async databaseExistingContainerNode(container, root, dbInspector) {
    const running = container.status.toLowerCase().includes("up");
    const isMysql = /mysql|mariadb/i.test(`${container.name} ${container.image}`);
    const isRedis = /redis/i.test(`${container.name} ${container.image}`);

    let children = undefined;

    if (running && isMysql && dbInspector) {
      // Auto-detect credentials via docker inspect env vars
      let user = 'root', password = '', databases = [];
      try {
        const envOutput = await execFileText('docker', ['inspect', '--format', '{{range .Config.Env}}{{.}}\n{{end}}', container.name], {}, 8000).catch(() => '');
        const envMap = {};
        envOutput.trim().split(/\r?\n/).forEach(line => {
          const eq = line.indexOf('=');
          if (eq > 0) envMap[line.slice(0, eq)] = line.slice(eq + 1);
        });
        if (envMap['MYSQL_ROOT_PASSWORD']) password = envMap['MYSQL_ROOT_PASSWORD'];
        if (envMap['MYSQL_USER']) user = envMap['MYSQL_USER'];
        if (envMap['MYSQL_PASSWORD']) password = envMap['MYSQL_PASSWORD'];

        const baseConn = { type: 'mysql-docker', containerName: container.name, user, password, database: '' };
        databases = await dbInspector.getDatabases(baseConn);
      } catch {}

      if (databases.length) {
        const dbNodes = await Promise.all(databases.map(async (dbName) => {
          const conn = { type: 'mysql-docker', containerName: container.name, user, password, database: dbName };
          let tableNodes;
          try {
            const tables = await dbInspector.getTables(conn);
            if (tables.length) {
              tableNodes = tables.map(tableName => new RuntimeNode({
                id: `db-container:${container.name}:${dbName}:table:${tableName}`,
                label: tableName,
                iconPath: new vscode.ThemeIcon('table'),
                contextValue: 'customDevToolsDbTable',
                connId: `docker:${container.name}:${dbName}`,
                tableName,
                dockerConn: conn
              }));
            } else {
              tableNodes = [emptyNode('테이블이 없습니다')];
            }
          } catch {
            tableNodes = [emptyNode('테이블 로드 실패')];
          }
          return new RuntimeNode({
            id: `db-container:${container.name}:db:${dbName}`,
            label: dbName,
            iconPath: new vscode.ThemeIcon('database'),
            contextValue: 'customDevToolsDbConnTree',
            children: tableNodes
          });
        }));
        children = dbNodes;
      } else if (databases !== undefined) {
        children = [emptyNode('데이터베이스를 불러올 수 없습니다')];
      }
    } else if (running && isRedis && dbInspector) {
      try {
        const keys = await dbInspector.getRedisKeys({ containerName: container.name });
        if (keys.length) {
          const keyNodes = await Promise.all(keys.map(async (key) => {
            const info = await dbInspector.getRedisKeyInfo({ containerName: container.name }, key).catch(() => ({ type: '?', value: '' }));
            const shortVal = info.value.length > 60 ? info.value.slice(0, 60) + '…' : info.value;
            return new RuntimeNode({
              id: `redis:${container.name}:key:${key}`,
              label: key,
              description: `[${info.type}] ${shortVal.replace(/\r?\n/g, ' ')}`,
              tooltip: `${key}\n유형: ${info.type}\n값: ${info.value}`,
              iconPath: new vscode.ThemeIcon('symbol-key'),
              contextValue: 'customDevToolsRedisKey',
              containerName: container.name
            });
          }));
          children = keyNodes;
        } else {
          children = [emptyNode('키가 없습니다')];
        }
      } catch {
        children = [emptyNode('Redis 읽기 실패')];
      }
    }

    return new RuntimeNode({
      id: `db-container:${container.name}`,
      runKind: "db-container",
      label: container.name,
      containerName: container.name,
      image: container.image,
      root,
      description: `${running ? "실행 중" : "중지됨"} · ${container.image}`,
      tooltip: `${container.name}\n${container.image}\n${container.status}`,
      running,
      contextValue: running ? "customDevToolsRunnableRunning" : "customDevToolsRunnableStopped",
      iconPath: getIcon({ running }),
      children
    });
  }

  isRunning(id) {
    return this.processes.has(id);
  }

  async run(node) {
    if (!node) {
      return;
    }
    if (this.isRunning(node.id)) {
      vscode.window.showInformationMessage(`${node.label}은 이미 실행 중입니다.`);
      return;
    }

    if (node.runKind === "docker") {
      await this.runDockerCompose(node);
      return;
    }
    if (node.runKind === "db-container" || node.runKind === "docker-container") {
      await this.docker(["start", node.containerName], node.root, `도커 컨테이너 시작: ${node.containerName}`);
      this.refreshAll();
      return;
    }

    const script = this.scriptFor(node);
    if (!script) {
      vscode.window.showWarningMessage(`${node.label} 실행 스크립트를 찾지 못했습니다.`);
      return;
    }

    this.output.show(true);
    this.output.appendLine(`[run] ${node.label}`);
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script
    ], {
      cwd: node.root,
      windowsHide: true
    });

    this.processes.set(node.id, child);
    this.notif.push("run", `${node.label} 실행 시작`);

    let stderrBuf = "";
    child.stdout.on("data", (data) => this.output.append(data.toString()));
    child.stderr.on("data", (data) => {
      const text = data.toString();
      this.output.append(text);
      stderrBuf += text;
    });
    child.on("exit", (code) => {
      this.processes.delete(node.id);
      this.output.appendLine(`[exit] ${node.label} code=${code}`);
      if (code !== 0 && stderrBuf.trim()) {
        const excerpt = stderrBuf.trim().split("\n").slice(0, 3).join(" ").slice(0, 200);
        this.notif.push("error", `${node.label} 오류 종료 (code=${code})`, excerpt);
      } else {
        this.notif.push("stop", `${node.label} 종료 (code=${code})`);
      }
      this.refreshAll();
    });
    child.on("error", (error) => {
      this.processes.delete(node.id);
      this.output.appendLine(`[error] ${node.label}: ${error.message}`);
      this.notif.push("error", `${node.label} 실행 실패`, error.message);
      vscode.window.showErrorMessage(`${node.label} 실행 실패: ${error.message}`);
      this.refreshAll();
    });
    this.refreshAll();
  }

  async stop(node) {
    if (!node) {
      return;
    }

    if (node.runKind === "docker") {
      await this.stopDockerCompose(node);
      return;
    }
    if (node.runKind === "db-container" || node.runKind === "docker-container") {
      await this.docker(["stop", node.containerName], node.root, `도커 컨테이너 중지: ${node.containerName}`);
      this.refreshAll();
      return;
    }

    const child = this.processes.get(node.id);
    if (!child) {
      this.refreshAll();
      return;
    }

    this.output.appendLine(`[stop] ${node.label}`);
    await execFileText("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { cwd: node.root }).catch((error) => {
      this.output.appendLine(`[stop-error] ${node.label}: ${error.message}`);
    });
    this.processes.delete(node.id);
    this.notif.push("stop", `${node.label} 수동 중지`);
    this.refreshAll();
  }

  async testDbConnection(conn, options = {}) {
    if (!conn) {
      const message = "연결을 찾을 수 없습니다.";
      if (options.showResult) vscode.window.showErrorMessage(message);
      return { ok: false, message };
    }
    if (!this.dbInspector) {
      const message = "DB 검사기가 준비되지 않았습니다.";
      if (options.showResult) vscode.window.showErrorMessage(message);
      return { ok: false, message };
    }

    try {
      const message = await this.dbInspector.testConnection(conn);
      const result = `${conn.name}: ${message}`;
      if (options.showResult) vscode.window.showInformationMessage(result);
      return { ok: true, message: result };
    } catch (error) {
      const result = `${conn.name}: ${shortError(error, [conn.password])}`;
      if (options.showResult) vscode.window.showErrorMessage(result);
      return { ok: false, message: result };
    }
  }

  async openFile(node) {
    if (!node || !node.filePath) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath));
    await vscode.window.showTextDocument(doc);
  }

  scriptFor(node) {
    if (node.runKind === "java") {
      return path.join(node.root, "scripts", "run-java-basic.ps1");
    }
    if (node.runKind === "spring") {
      return path.join(node.root, "scripts", "run-spring.ps1");
    }
    if (node.runKind === "python") {
      return path.join(node.root, "scripts", "run-python.ps1");
    }
    return null;
  }

  async runDockerCompose(node) {
    const composeFile = node.composeFile || path.join(node.root, "docker", "docker-compose.yml");
    await this.docker(["compose", "-f", composeFile, "up", "-d"], node.root, `도커 실행: ${node.label}`);
    this.refreshAll();
  }

  async stopDockerCompose(node) {
    const composeFile = node.composeFile || path.join(node.root, "docker", "docker-compose.yml");
    await this.docker(["compose", "-f", composeFile, "down"], node.root, `도커 중지: ${node.label}`);
    this.refreshAll();
  }

  async detectDatabaseTools() {
    const tools = ["psql", "mysql", "mongosh", "redis-cli", "sqlite3", "sqlcmd"];
    const found = [];
    for (const tool of tools) {
      const resolved = await execFileText("where.exe", [tool], {}, 2500).catch(() => "");
      if (resolved.trim()) {
        found.push({ name: tool, path: resolved.trim().split(/\r?\n/)[0] });
      }
    }
    return found;
  }

  async detectDockerContainers() {
    const output = await this.dockerText([
      "ps",
      "-a",
      "--format",
      "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.ID}}"
    ]).catch(() => "");
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, image, status, ports, id] = line.split("\t");
        return { name, image, status, ports, id };
      });
  }

  async detectDockerImages() {
    const output = await this.dockerText([
      "images",
      "--format",
      "{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedSince}}"
    ]).catch(() => "");
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [repository, tag, id, size, created] = line.split("\t");
        return { repository, tag, id, size, created };
      });
  }

  async detectDatabaseContainers() {
    const containers = await this.detectDockerContainers();
    return containers
      .filter((container) => /postgres|mysql|mariadb|mongo|redis|mssql|sqlite|oracle/i.test(`${container.name} ${container.image}`));
  }

  async syncDetectedDatabaseConnections() {
    if (!this.dbConnMgr) return;
    const candidates = await this.detectDatabaseConnectionCandidates();
    await this.dbConnMgr.syncAutoDetected(candidates);
  }

  async detectDatabaseConnectionCandidates() {
    const candidates = [];

    const root = this.getProjectRoot();
    if (root) {
      candidates.push(...await this.detectProjectDatabaseConnections(root));
    }

    candidates.push(...await this.detectLocalDatabaseConnections());

    const containers = await this.detectDatabaseContainers();
    for (const container of containers) {
      const candidate = await this.databaseConnectionCandidateFromContainer(container).catch(() => null);
      if (Array.isArray(candidate)) candidates.push(...candidate.filter(Boolean));
      else if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  async detectProjectDatabaseConnections(root) {
    const candidates = [];

    for (const filePath of walk(root, [".db", ".sqlite", ".sqlite3"])) {
      candidates.push({
        id: stableConnectionId(`code:sqlite:${filePath}`),
        name: `${path.basename(filePath)} (프로젝트 SQLite)`,
        type: "sqlite",
        path: filePath,
        source: "code-auto",
        sourceLabel: relative(root, filePath)
      });
    }

    const configFiles = walk(root, [
      ".properties", ".yml", ".yaml", ".env", ".json", ".js", ".ts", ".java", ".py", ".toml"
    ]).filter((filePath) => {
      const rel = relative(root, filePath).toLowerCase();
      if (rel.includes("node_modules/") || rel.includes("target/") || rel.includes("out/")) return false;
      return /(^|\/)(application|bootstrap|database|datasource|settings|config|\.env|docker-compose|compose|package|prisma|orm|knex|sequelize)/i.test(rel)
        || /\.(java|py|js|ts)$/.test(filePath);
    }).slice(0, 180);

    for (const filePath of configFiles) {
      const text = readText(filePath);
      if (!text) continue;
      candidates.push(...extractDatabaseConnectionsFromText(text, filePath, root));
    }

    return dedupeConnections(candidates);
  }

  async detectLocalDatabaseConnections() {
    const portMap = [
      { port: 3306, type: "mysql", name: "localhost:3306 (MySQL)" },
      { port: 5432, type: "postgres", name: "localhost:5432 (PostgreSQL)" },
      { port: 6379, type: "redis", name: "localhost:6379 (Redis)" }
    ];
    // Docker/WSL이 포트 포워딩으로 점유한 포트는 실제 로컬 DB가 아니므로 제외
    const dockerPidRaw = await execFileText("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      "Get-Process | Where-Object { $_.ProcessName -match 'docker|wslrelay' } | Select-Object -ExpandProperty Id"
    ], {}, 5000).catch(() => "");
    const dockerPidSet = new Set(dockerPidRaw.split(/\r?\n/).map((l) => Number(l.trim())).filter(Boolean));
    let output = await execFileText("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$dp=(Get-Process|Where-Object{$_.ProcessName -match 'docker|wslrelay'}|Select-Object -ExpandProperty Id);Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$_.LocalPort -in 3306,5432,6379,1433,27017 -and $_.OwningProcess -notin $dp}|Select-Object -ExpandProperty LocalPort|Sort-Object -Unique"
    ], {}, 8000).catch(() => "");
    if (!output.trim()) {
      const netstat = await execFileText("netstat.exe", ["-ano", "-p", "TCP"], {}, 8000).catch(() => "");
      output = netstat
        .split(/\r?\n/)
        .map((line) => {
          const portMatch = line.match(/:(3306|5432|6379)\s/);
          const pidMatch = line.match(/LISTENING\s+(\d+)$/i);
          if (!portMatch || !pidMatch) return "";
          if (dockerPidSet.has(Number(pidMatch[1]))) return "";
          return portMatch[1];
        })
        .filter(Boolean)
        .join("\n");
    }
    const listening = new Set(output.split(/\r?\n/).map((line) => Number(line.trim())).filter(Boolean));
    return portMap
      .filter((entry) => listening.has(entry.port))
      .map((entry) => ({
        id: stableConnectionId(`local:${entry.type}:${entry.port}`),
        name: entry.name,
        type: entry.type,
        host: "localhost",
        port: String(entry.port),
        database: entry.type === "postgres" ? "postgres" : "",
        user: defaultDbUser(entry.type),
        source: "local-auto",
        sourceLabel: "로컬 실행 포트"
      }));
  }

  async databaseConnectionCandidateFromContainer(container) {
    const text = `${container.name} ${container.image}`;
    const running = /^(up|running)/i.test(container.status || "");
    const inspect = await this.inspectDockerContainer(container.name).catch(() => null);
    const envMap = envArrayToMap(inspect && inspect.Config && inspect.Config.Env);
    const ports = inspect && inspect.NetworkSettings ? inspect.NetworkSettings.Ports : {};

    if (/mysql|mariadb/i.test(text)) {
      const port = dockerHostPort(ports, "3306/tcp") || dockerPortFromText(container.ports, 3306) || "3306";
      const user = envMap.MYSQL_USER || "root";
      const password = envMap.MYSQL_PASSWORD || envMap.MYSQL_ROOT_PASSWORD || "";
      const base = {
        id: stableConnectionId(`docker:mysql:${container.name}:${envMap.MYSQL_DATABASE || ""}`),
        name: `${container.name} (MySQL)`,
        type: "mysql-docker",
        containerName: container.name,
        host: "localhost",
        port,
        database: envMap.MYSQL_DATABASE || "",
        user,
        password,
        image: container.image,
        status: container.status,
        running,
        source: "docker-auto",
        sourceLabel: container.name
      };
      const databases = await this.dbInspector?.getDatabases({ ...base, password }).catch(() => []);
      if (Array.isArray(databases) && databases.length) {
        return databases.map((database) => ({
          ...base,
          id: stableConnectionId(`docker:mysql:${container.name}:${database}`),
          name: `${container.name}/${database} (MySQL)`,
          database
        }));
      }
      return base;
    }

    if (/postgres/i.test(text)) {
      const port = dockerHostPort(ports, "5432/tcp") || dockerPortFromText(container.ports, 5432) || "5432";
      const user = envMap.POSTGRES_USER || "postgres";
      const password = envMap.POSTGRES_PASSWORD || "";
      const base = {
        id: stableConnectionId(`docker:postgres:${container.name}:${envMap.POSTGRES_DB || user || "postgres"}`),
        name: `${container.name} (PostgreSQL)`,
        type: "postgres-docker",
        containerName: container.name,
        host: "localhost",
        port,
        database: envMap.POSTGRES_DB || user || "postgres",
        user,
        password,
        image: container.image,
        status: container.status,
        running,
        source: "docker-auto",
        sourceLabel: container.name
      };
      const databases = await this.dbInspector?.getDatabases({ ...base, password }).catch(() => []);
      if (Array.isArray(databases) && databases.length) {
        return databases.map((database) => ({
          ...base,
          id: stableConnectionId(`docker:postgres:${container.name}:${database}`),
          name: `${container.name}/${database} (PostgreSQL)`,
          database
        }));
      }
      return base;
    }

    if (/redis/i.test(text)) {
      const port = dockerHostPort(ports, "6379/tcp") || dockerPortFromText(container.ports, 6379) || "6379";
      return {
        id: stableConnectionId(`docker:redis:${container.name}`),
        name: `${container.name} (Redis)`,
        type: "redis-docker",
        containerName: container.name,
        host: "localhost",
        port,
        password: envMap.REDIS_PASSWORD || "",
        image: container.image,
        status: container.status,
        running,
        source: "docker-auto",
        sourceLabel: container.name
      };
    }

    return null;
  }

  async inspectDockerContainer(name) {
    const output = await this.dockerText(["inspect", name], undefined);
    const parsed = JSON.parse(output || "[]");
    return parsed && parsed[0] ? parsed[0] : null;
  }

  async dockerContainerExists(name) {
    const output = await this.dockerText(["ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"]).catch(() => "");
    return output.split(/\r?\n/).some((line) => line.trim() === name);
  }

  async isDockerContainerRunning(name) {
    const output = await this.dockerText(["ps", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"]).catch(() => "");
    return output.split(/\r?\n/).some((line) => line.trim() === name);
  }

  async docker(args, cwd, label) {
    this.output.show(true);
    this.output.appendLine(`[docker] ${label}`);
    this.output.appendLine(`docker ${args.join(" ")}`);
    const output = await this.dockerText(args, cwd).catch((error) => {
      this.output.appendLine(error.message);
      vscode.window.showErrorMessage(`${label} 실패: ${error.message}`);
      throw error;
    });
    if (output.trim()) {
      this.output.appendLine(output.trim());
    }
  }

  async powershell(command, cwd, label) {
    this.output.show(true);
    this.output.appendLine(`[powershell] ${label}`);
    const output = await execFileText("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command
    ], { cwd: cwd || this.getProjectRoot() || os.homedir() }, 15000).catch((error) => {
      this.output.appendLine(error.message);
      vscode.window.showErrorMessage(`${label} 실패: ${error.message}`);
      throw error;
    });
    if (output.trim()) {
      this.output.appendLine(output.trim());
    }
  }

  dockerText(args, cwd) {
    return execFileText(this.dockerBin, args, { cwd: cwd || this.getProjectRoot() || os.homedir() }, 15000);
  }

  dispose() {
    for (const child of this.processes.values()) {
      try {
        child.kill();
      } catch {
        // Ignore child cleanup failures during extension shutdown.
      }
    }
    this.output.dispose();
  }
}

// Background and color settings ------------------------------------------------

const DEFAULT_THEME = {
  imagePath: "",
  color: "#b49de0"
};

const MANAGED_COLOR_KEYS = [
  "activityBar.background",
  "activityBar.border",
  "activityBarBadge.background",
  "activityBarBadge.foreground",
  "badge.background",
  "button.background",
  "button.hoverBackground",
  "button.foreground",
  "checkbox.background",
  "checkbox.border",
  "editor.background",
  "editor.findMatchBackground",
  "editor.findMatchBorder",
  "editor.findMatchHighlightBackground",
  "editor.lineHighlightBackground",
  "editor.lineHighlightBorder",
  "editor.selectionBackground",
  "editor.selectionHighlightBackground",
  "editor.wordHighlightBackground",
  "editor.wordHighlightStrongBackground",
  "editorGroupHeader.tabsBackground",
  "editorGroupHeader.tabsBorder",
  "editorLineNumber.activeForeground",
  "focusBorder",
  "input.border",
  "input.focusBorder",
  "list.activeSelectionBackground",
  "list.hoverBackground",
  "notificationCenterHeader.background",
  "notifications.background",
  "notifications.border",
  "panel.background",
  "panel.border",
  "panelTitle.activeBorder",
  "panelTitle.activeForeground",
  "progressBar.background",
  "scrollbarSlider.activeBackground",
  "scrollbarSlider.background",
  "scrollbarSlider.hoverBackground",
  "sideBar.background",
  "sideBar.border",
  "sideBarSectionHeader.background",
  "sideBarSectionHeader.border",
  "statusBar.background",
  "statusBar.border",
  "statusBar.debuggingBackground",
  "statusBar.foreground",
  "statusBar.noFolderBackground",
  "statusBar.noFolderBorder",
  "statusBar.noFolderForeground",
  "statusBarItem.hoverBackground",
  "tab.activeBorderTop",
  "tab.activeBackground",
  "tab.hoverBackground",
  "tab.inactiveBackground",
  "tab.unfocusedActiveBorderTop",
  "terminal.background",
  "terminalCursor.foreground",
  "textLink.activeForeground",
  "textLink.foreground",
  "titleBar.activeBackground",
  "titleBar.activeForeground",
  "titleBar.inactiveBackground"
];

function getSavedThemeSettings(context) {
  const store = context && context.globalState;
  if (!store) return { ...DEFAULT_THEME };
  const saved = store.get(THEME_STATE_KEY, DEFAULT_THEME);
  return {
    imagePath: typeof saved.imagePath === "string" ? saved.imagePath : "",
    color: normalizeThemeColor(saved.color)
  };
}

async function saveThemeSettings(context, value) {
  if (!context || !context.globalState) return;
  await context.globalState.update(THEME_STATE_KEY, {
    imagePath: typeof value.imagePath === "string" ? value.imagePath : "",
    color: normalizeThemeColor(value.color)
  });
}

function normalizeThemeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : DEFAULT_THEME.color;
}

function hexToRgbForTheme(hex) {
  const normalized = normalizeThemeColor(hex).slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function rgbToHslForTheme({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const sValue = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: sValue, l };
}

function hslToHexForTheme(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

function rgbaForTheme(hex, alpha) {
  const { r, g, b } = hexToRgbForTheme(hex);
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return "#" + r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0") + a;
}

function alphaHexForTheme(hex, alpha) {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

function buildOfficialColorCustomizations(color) {
  const accent = normalizeThemeColor(color);
  const hsl = rgbToHslForTheme(hexToRgbForTheme(accent));
  const fg      = hslToHexForTheme(hsl.h, 0.80, 0.93);
  const darkFg  = hslToHexForTheme(hsl.h, 0.40, 0.10);
  const base0   = hslToHexForTheme(hsl.h, 0.38, 0.055);
  const base1   = hslToHexForTheme(hsl.h, 0.40, 0.065);
  const base2   = hslToHexForTheme(hsl.h, 0.42, 0.075);
  const base3   = hslToHexForTheme(hsl.h, 0.44, 0.10);
  const status  = hslToHexForTheme(hsl.h, 0.55, 0.28);
  const debug   = hslToHexForTheme(hsl.h, 0.58, 0.34);
  const warm    = hslToHexForTheme((hsl.h + 40) % 360, 0.52, 0.67);
  return {
    "activityBar.background":            base1,
    "activityBar.border":                rgbaForTheme(accent, 0.28),
    "activityBarBadge.background":       accent,
    "activityBarBadge.foreground":       darkFg,
    "badge.background":                  accent,
    "button.background":                 status,
    "button.hoverBackground":            debug,
    "button.foreground":                 "#ffffff",
    "checkbox.background":               rgbaForTheme(accent, 0.094),
    "checkbox.border":                   rgbaForTheme(accent, 0.333),
    "editor.background":                 alphaHexForTheme(base0, 0.78),
    "editor.findMatchBackground":        rgbaForTheme(warm, 0.267),
    "editor.findMatchBorder":            rgbaForTheme(warm, 0.667),
    "editor.findMatchHighlightBackground": rgbaForTheme(warm, 0.133),
    "editor.lineHighlightBackground":    rgbaForTheme(accent, 0.063),
    "editor.lineHighlightBorder":        rgbaForTheme(accent, 0.094),
    "editor.selectionBackground":        rgbaForTheme(accent, 0.157),
    "editor.selectionHighlightBackground": rgbaForTheme(accent, 0.094),
    "editor.wordHighlightBackground":    rgbaForTheme(accent, 0.125),
    "editor.wordHighlightStrongBackground": rgbaForTheme(accent, 0.157),
    "editorGroupHeader.tabsBackground":  base1,
    "editorGroupHeader.tabsBorder":      rgbaForTheme(accent, 0.22),
    "editorLineNumber.activeForeground": accent,
    "focusBorder":                       rgbaForTheme(accent, 0.40),
    "input.border":                      rgbaForTheme(accent, 0.20),
    "input.focusBorder":                 rgbaForTheme(accent, 0.467),
    "list.activeSelectionBackground":    rgbaForTheme(accent, 0.24),
    "list.hoverBackground":              rgbaForTheme(accent, 0.12),
    "notificationCenterHeader.background": base3,
    "notifications.background":          base2,
    "notifications.border":              rgbaForTheme(accent, 0.20),
    "panel.background":                  alphaHexForTheme(base0, 0.78),
    "panel.border":                      rgbaForTheme(accent, 0.25),
    "panelTitle.activeBorder":           accent,
    "panelTitle.activeForeground":       fg,
    "progressBar.background":            accent,
    "scrollbarSlider.activeBackground":  rgbaForTheme(accent, 0.533),
    "scrollbarSlider.background":        rgbaForTheme(accent, 0.133),
    "scrollbarSlider.hoverBackground":   rgbaForTheme(accent, 0.333),
    "sideBar.background":                alphaHexForTheme(base2, 0.722),
    "sideBar.border":                    rgbaForTheme(accent, 0.133),
    "sideBarSectionHeader.background":   alphaHexForTheme(base3, 0.722),
    "sideBarSectionHeader.border":       rgbaForTheme(accent, 0.133),
    "statusBar.background":              status,
    "statusBar.border":                  rgbaForTheme(accent, 0.267),
    "statusBar.debuggingBackground":     debug,
    "statusBar.foreground":              fg,
    "statusBar.noFolderBackground":      status,
    "statusBar.noFolderBorder":          rgbaForTheme(accent, 0.267),
    "statusBar.noFolderForeground":      fg,
    "statusBarItem.hoverBackground":     rgbaForTheme(accent, 0.20),
    "tab.activeBorderTop":               accent,
    "tab.activeBackground":              rgbaForTheme(accent, 0.071),
    "tab.hoverBackground":               rgbaForTheme(accent, 0.031),
    "tab.inactiveBackground":            base1,
    "tab.unfocusedActiveBorderTop":      rgbaForTheme(accent, 0.333),
    "terminal.background":               alphaHexForTheme(hslToHexForTheme(hsl.h, 0.40, 0.040), 0.80),
    "terminalCursor.foreground":         accent,
    "textLink.activeForeground":         fg,
    "textLink.foreground":               accent,
    "titleBar.activeBackground":         alphaHexForTheme(hslToHexForTheme(hsl.h, 0.40, 0.13), 0.933),
    "titleBar.activeForeground":         fg,
    "titleBar.inactiveBackground":       alphaHexForTheme(hslToHexForTheme(hsl.h, 0.38, 0.10), 0.867)
  };
}

async function applyOfficialThemeColors(color) {
  const config = vscode.workspace.getConfiguration();
  const current = { ...(config.get("workbench.colorCustomizations") || {}) };
  const next = { ...current, ...buildOfficialColorCustomizations(color) };
  await config.update("workbench.colorCustomizations", next, vscode.ConfigurationTarget.Global);
}

async function clearOfficialThemeColors() {
  const config = vscode.workspace.getConfiguration();
  const current = { ...(config.get("workbench.colorCustomizations") || {}) };
  let changed = false;
  for (const key of MANAGED_COLOR_KEYS) {
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      delete current[key];
      changed = true;
    }
  }
  if (changed) {
    await config.update("workbench.colorCustomizations", current, vscode.ConfigurationTarget.Global);
  }
}

const WB_BG_TAG_START = "<!-- CUSTOM-DEV-TOOLS-BG-START -->";
const WB_BG_TAG_END   = "<!-- CUSTOM-DEV-TOOLS-BG-END -->";

function getWorkbenchHtmlPath() {
  return require('path').join(vscode.env.appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
}

function updateWorkbenchChecksum(htmlPath) {
  try {
    const p = require('path');
    const productPath = p.join(vscode.env.appRoot, 'product.json');
    const fs = require('fs');
    const bytes = fs.readFileSync(htmlPath);
    const hash = require('crypto').createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '');
    const raw = fs.readFileSync(productPath, 'utf8');
    const updated = raw.replace(
      /"vs\/code\/electron-browser\/workbench\/workbench\.html"\s*:\s*"[^"]*"/,
      `"vs/code/electron-browser/workbench/workbench.html": "${hash}"`
    );
    fs.writeFileSync(productPath, updated, 'utf8');
  } catch {}
}

async function patchWorkbenchBackground(imagePath) {
  const fs = require('fs');
  const htmlPath = getWorkbenchHtmlPath();
  let html = fs.readFileSync(htmlPath, 'utf8');
  const si = html.indexOf(WB_BG_TAG_START);
  const ei = html.indexOf(WB_BG_TAG_END);
  if (si !== -1 && ei !== -1) {
    const lineStart = html.lastIndexOf('\n', si);
    const blockEnd = ei + WB_BG_TAG_END.length;
    html = html.substring(0, lineStart > 0 ? lineStart : si) + html.substring(blockEnd);
  }
  if (imagePath) {
    const imgBuf = fs.readFileSync(imagePath);
    if (imgBuf.length > 5 * 1024 * 1024) throw new Error("이미지 크기가 5MB를 초과합니다.");
    const extRaw = imagePath.split(/[\\/]/).pop().split('.').pop().toLowerCase();
    const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp' }[extRaw] || 'image/png';
    const dataUri = `data:${mime};base64,${imgBuf.toString('base64')}`;
    const patch = `\n${WB_BG_TAG_START}\n<style>\nhtml,body{background:#0a0811}\n.monaco-workbench{background-color:transparent!important;background-image:url("${dataUri}")!important;background-size:cover!important;background-position:center center!important;background-attachment:fixed!important}\n</style>\n${WB_BG_TAG_END}`;
    html = html.replace('</head>', patch + '\n</head>');
  }
  fs.writeFileSync(htmlPath, html, 'utf8');
  updateWorkbenchChecksum(htmlPath);
}

function webviewCspMeta() {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">`;
}

class ThemeSettingsProvider {
  constructor(context) {
    this._context = context;
    this._view = null;
  }

  _setLocalRoots(webviewView, fsPath) {
    try {
      const sep = /[\\/]/;
      const parts = fsPath.split(sep);
      parts.pop();
      const dir = parts.join("/") || "/";
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(dir)]
      };
    } catch {}
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    const saved = getSavedThemeSettings(this._context);

    if (saved.imagePath) {
      this._setLocalRoots(webviewView, saved.imagePath);
    } else {
      webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    }

    const postStatus = (message, tone = "info") => {
      webviewView.webview.postMessage({ type: "operationDone", message, tone });
    };

    const toPreviewUri = (fsPath) => {
      if (!fsPath) return "";
      try { return webviewView.webview.asWebviewUri(vscode.Uri.file(fsPath)).toString(); } catch { return ""; }
    };

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "pickImage") {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { "Images": ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }
        });
        if (uris && uris[0]) {
          const fsPath = uris[0].fsPath;
          this._setLocalRoots(webviewView, fsPath);
          const filename = fsPath.split(/[\\/]/).pop();
          const previewUri = toPreviewUri(fsPath);
          webviewView.webview.postMessage({ type: "imagePicked", path: fsPath, filename, previewUri });
        }
        return;
      }

      if (msg.type === "clearImage") {
        await saveThemeSettings(this._context, { imagePath: "", color: normalizeThemeColor(msg.color) });
        try { await patchWorkbenchBackground(""); } catch {}
        webviewView.webview.postMessage({ type: "imagePicked", path: "", filename: "", previewUri: "" });
        return;
      }

      if (msg.type === "apply") {
        try {
          const next = { imagePath: msg.imagePath || "", color: normalizeThemeColor(msg.color) };
          await saveThemeSettings(this._context, next);
          await applyOfficialThemeColors(next.color);
          await patchWorkbenchBackground(next.imagePath);
          const previewUri = toPreviewUri(next.imagePath);
          webviewView.webview.postMessage({ type: "resetDone", imagePath: next.imagePath, color: next.color, previewUri });
          const msg2 = next.imagePath ? "테마와 배경 이미지를 적용했습니다. VS Code를 다시 로드하세요." : "테마 색상을 적용했습니다. VS Code를 다시 로드하세요.";
          postStatus(msg2, "success");
          vscode.window.showInformationMessage(msg2, "지금 다시 로드").then(sel => {
            if (sel === "지금 다시 로드") vscode.commands.executeCommand("workbench.action.reloadWindow");
          });
        } catch (err) {
          const message = "테마 적용 실패: " + err.message;
          postStatus(message, "error");
          vscode.window.showErrorMessage(message);
        }
        return;
      }

      if (msg.type === "reset") {
        try {
          await saveThemeSettings(this._context, DEFAULT_THEME);
          await applyOfficialThemeColors(DEFAULT_THEME.color);
          await patchWorkbenchBackground("");
          webviewView.webview.postMessage({ type: "resetDone", imagePath: "", color: DEFAULT_THEME.color, previewUri: "" });
          postStatus("이미지 없이 기본 색상을 적용했습니다. VS Code를 다시 로드하세요.", "success");
          vscode.window.showInformationMessage("기본값을 적용했습니다. VS Code를 다시 로드하세요.", "지금 다시 로드").then(sel => {
            if (sel === "지금 다시 로드") vscode.commands.executeCommand("workbench.action.reloadWindow");
          });
        } catch (err) {
          const message = "기본값 적용 실패: " + err.message;
          postStatus(message, "error");
          vscode.window.showErrorMessage(message);
        }
        return;
      }

      if (msg.type === "clear") {
        try {
          await saveThemeSettings(this._context, DEFAULT_THEME);
          await clearOfficialThemeColors();
          await patchWorkbenchBackground("");
          webviewView.webview.postMessage({ type: "resetDone", imagePath: "", color: DEFAULT_THEME.color, previewUri: "" });
          postStatus("이 확장이 관리하던 색상 설정을 제거했습니다. VS Code를 다시 로드하세요.", "success");
          vscode.window.showInformationMessage("관리 색상을 제거했습니다. VS Code를 다시 로드하세요.", "지금 다시 로드").then(sel => {
            if (sel === "지금 다시 로드") vscode.commands.executeCommand("workbench.action.reloadWindow");
          });
        } catch (err) {
          const message = "테마 제거 실패: " + err.message;
          postStatus(message, "error");
          vscode.window.showErrorMessage(message);
        }
      }
    });

    webviewView.webview.html = this._buildHtml(saved, webviewView.webview);
  }

  _buildHtml({ imagePath, color }, webview) {
    const safeImagePath = imagePath || "";
    const safeColor = normalizeThemeColor(color || DEFAULT_THEME.color);
    const emptyImageLabel = "이미지를 선택하지 않음";
    const safeFilename = safeImagePath ? safeImagePath.split(/[\\/]/).pop() : "";
    let initPreviewUri = "";
    if (safeImagePath && webview) {
      try { initPreviewUri = webview.asWebviewUri(vscode.Uri.file(safeImagePath)).toString(); } catch {}
    }
    const cspSource = webview ? webview.cspSource : "";
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${cspSource} data:;`;

    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:12px;margin:0}
  h3{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-descriptionForeground);margin:16px 0 8px}
  h3:first-child{margin-top:0}
  .row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
  .filename-box{flex:1;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#444);color:var(--vscode-input-foreground);padding:5px 8px;border-radius:3px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .filename-box.empty{color:var(--vscode-descriptionForeground)}
  button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:5px 10px;border-radius:3px;cursor:pointer;font-size:12px;white-space:nowrap}
  button:hover{background:var(--vscode-button-hoverBackground)}
  button.secondary{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc)}
  button.secondary:hover{background:var(--vscode-button-secondaryHoverBackground,#45494e)}
  button.icon{padding:5px 7px;min-width:28px}
  .color-row{display:flex;gap:8px;align-items:center}
  input[type=color]{width:40px;height:28px;border:1px solid var(--vscode-input-border,#444);border-radius:3px;cursor:pointer;padding:1px;background:var(--vscode-input-background)}
  .color-hex{flex:1;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#444);color:var(--vscode-input-foreground);padding:5px 8px;border-radius:3px;font-size:12px;font-family:monospace}
  .preview{width:100%;height:72px;border-radius:4px;margin:8px 0;border:1px solid var(--vscode-input-border,#444);background-size:cover;background-position:center;position:relative;overflow:hidden}
  .preview::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.38)}
  .preview-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)}
  .actions{display:flex;gap:8px;margin-top:12px}.actions button{flex:1}
  .status{display:none;margin-top:10px;padding:8px;border-radius:4px;font-size:11px;line-height:1.5;border:1px solid var(--vscode-panel-border,#333)}
  .status.show{display:block}.status.success{background:rgba(38,105,54,.22);border-color:rgba(84,180,101,.55)}.status.error{background:rgba(145,36,36,.22);border-color:rgba(220,90,90,.65)}.status.info{background:rgba(88,76,122,.22);border-color:rgba(150,130,210,.55)}
</style>
</head><body>
<h3>배경 이미지</h3>
<div class="row">
  <div class="filename-box${safeFilename ? "" : " empty"}" id="img-name">${escapeHtml(safeFilename || emptyImageLabel)}</div>
  <button id="pick-btn">찾아보기</button>
  <button class="secondary icon" id="clear-img-btn" title="이미지 제거">✕</button>
</div>
<h3>테마 색상</h3>
<div class="color-row"><input type="color" id="color-pick" value="${safeColor}"/><input class="color-hex" id="color-hex" type="text" value="${safeColor}" maxlength="7" placeholder="#rrggbb"/></div>
<h3>미리보기</h3>
<div class="preview" id="preview"><div class="preview-overlay">Custom Dev Tools & Theme Kit</div></div>
<div class="actions"><button id="apply-btn">적용</button><button class="secondary" id="reset-btn">기본값 적용</button></div>
<div class="actions"><button class="secondary" id="clear-btn">관리 색상 제거</button></div>
<div id="status" class="status"></div>
<script>
const vscode = acquireVsCodeApi();
let imagePath = ${JSON.stringify(safeImagePath)};
let previewUri = ${JSON.stringify(initPreviewUri)};
const emptyImageLabel = ${JSON.stringify(emptyImageLabel)};
function status(msg, tone) { const el = document.getElementById('status'); el.textContent = msg || ''; el.className = 'status show ' + (tone || 'info'); }
function hexToRgb(hex) { const m = hex.replace('#','').match(/../g); if (!m || m.length < 3) return {r:180,g:157,b:224}; return {r:parseInt(m[0],16), g:parseInt(m[1],16), b:parseInt(m[2],16)}; }
function updatePreview() {
  const color = document.getElementById('color-pick').value;
  const rgb = hexToRgb(color);
  const preview = document.getElementById('preview');
  preview.style.backgroundImage = previewUri ? "url('" + previewUri + "')" : 'none';
  preview.style.backgroundColor = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.80)';
}
function setImage(path, filename, uri) {
  imagePath = path || '';
  previewUri = uri || '';
  const nameEl = document.getElementById('img-name');
  if (imagePath && filename) {
    nameEl.textContent = filename;
    nameEl.className = 'filename-box';
  } else {
    nameEl.textContent = emptyImageLabel;
    nameEl.className = 'filename-box empty';
  }
  updatePreview();
}
document.getElementById('pick-btn').addEventListener('click', () => vscode.postMessage({ type: 'pickImage' }));
document.getElementById('clear-img-btn').addEventListener('click', () => {
  setImage('', '', '');
  vscode.postMessage({ type: 'clearImage', color: document.getElementById('color-pick').value });
});
document.getElementById('color-pick').addEventListener('input', function() { document.getElementById('color-hex').value = this.value; updatePreview(); });
document.getElementById('color-hex').addEventListener('input', function() { if (/^#[0-9a-fA-F]{6}$/.test(this.value)) { document.getElementById('color-pick').value = this.value; updatePreview(); } });
document.getElementById('apply-btn').addEventListener('click', () => { status('적용 중입니다.', 'info'); vscode.postMessage({ type: 'apply', imagePath, color: document.getElementById('color-pick').value }); });
document.getElementById('reset-btn').addEventListener('click', () => { status('기본값을 적용하는 중입니다.', 'info'); vscode.postMessage({ type: 'reset' }); });
document.getElementById('clear-btn').addEventListener('click', () => { status('관리 색상을 제거하는 중입니다.', 'info'); vscode.postMessage({ type: 'clear' }); });
window.addEventListener('message', function(ev) {
  const d = ev.data;
  if (d.type === 'imagePicked') {
    setImage(d.path, d.filename, d.previewUri);
  } else if (d.type === 'resetDone') {
    setImage(d.imagePath, d.imagePath ? d.imagePath.split(/[\\/]/).pop() : '', d.previewUri || '');
    document.getElementById('color-pick').value = d.color;
    document.getElementById('color-hex').value = d.color;
    updatePreview();
  } else if (d.type === 'operationDone') {
    status(d.message, d.tone);
  }
});
updatePreview();
</script>
</body></html>`;
  }
}
async function closeEmptyEditorGroups() {
  try {
    const groups = vscode.window.tabGroups?.all ?? [];
    const empty = groups.filter(g => g.tabs.length === 0);
    if (empty.length > 0) {
      await Promise.all(empty.map(g => vscode.window.tabGroups.close(g).catch(() => {})));
    }
  } catch (_) {}
}

async function activate(context) {
  // Register the serializer synchronously FIRST — before any await — so VSCode can
  // call deserializeWebviewPanel() as early as possible during startup.
  // Without this, the ghost tab stays visible until dbConnMgr.ready() finishes.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("springControllerTest", {
      async deserializeWebviewPanel(panel, _state) {
        panel.dispose();
      }
    })
  );

  await closeEmptyEditorGroups();
  vscode.commands.executeCommand("workbench.action.editorLayoutSingle").then(undefined, () => {});
  const notifProvider = new NotificationProvider();
  const controller = new RuntimeController(context, notifProvider);
  const dbConnMgr = new DatabaseConnectionManager(context);
  await dbConnMgr.ready();
  const dbInspector = new DatabaseInspector();
  controller.dbConnMgr = dbConnMgr;
  controller.dbInspector = dbInspector;
  const domBridge = new NotificationDomBridgeServer(notifProvider);
  const notificationDetailProvider = new NotificationDetailWebviewProvider(notifProvider, domBridge);
  domBridge.start();
  installNotificationBridge(notifProvider, context, domBridge);
  const dbConnListProvider = new DatabaseConnectionSettingsProvider(dbConnMgr, controller, "list");
  const dbConnDetailProvider = new DatabaseConnectionSettingsProvider(dbConnMgr, controller, "detail");
  dbConnListProvider.addPeer(dbConnDetailProvider);
  dbConnDetailProvider.addPeer(dbConnListProvider);

  const runtimeProviders = [
    [VIEW_KINDS.javaSpring, "customDevTools.runtime.javaSpring"],
    [VIEW_KINDS.springControllers, "customDevTools.runtime.springControllers"],
    [VIEW_KINDS.python, "customDevTools.runtime.python"],
    [VIEW_KINDS.docker, "customDevTools.runtime.docker"],
    [VIEW_KINDS.database, "customDevTools.runtime.database"]
  ];

  for (const [kind, viewId] of runtimeProviders) {
    const provider = new RuntimeProvider(controller, kind);
    controller.registerProvider(kind, provider);
    context.subscriptions.push(vscode.window.registerTreeDataProvider(viewId, provider));
  }

  // Auto-refresh docker/database views when containers start or stop
  const dockerEventsDisposable = startDockerEventWatcher(controller);
  context.subscriptions.push(dockerEventsDisposable);

  const notificationTreeView = vscode.window.createTreeView("customDevTools.runtime.notifications", {
    treeDataProvider: notifProvider,
    showCollapseAll: false
  });

  context.subscriptions.push(
    notificationTreeView,
    notificationTreeView.onDidChangeSelection((event) => {
      const [item] = event.selection || [];
      notifProvider.select(item);
    }),
    vscode.window.registerWebviewViewProvider("customDevTools.runtime.notificationDetail", notificationDetailProvider),
    vscode.window.registerWebviewViewProvider("customDevTools.runtime.dbConnectionForm", dbConnListProvider),
    vscode.window.registerWebviewViewProvider("customDevTools.runtime.dbConnectionDetail", dbConnDetailProvider),
    controller,
    domBridge,
    vscode.commands.registerCommand("customDevTools.runtime.refresh", () => controller.refreshAll()),
    vscode.commands.registerCommand("customDevTools.runtime.run", (node) => controller.run(node)),
    vscode.commands.registerCommand("customDevTools.runtime.stop", (node) => controller.stop(node)),
    vscode.commands.registerCommand("customDevTools.runtime.openFile", (node) => controller.openFile(node)),
    vscode.commands.registerCommand("customDevTools.runtime.clearNotifications", () => notifProvider.clear()),
    vscode.commands.registerCommand("customDevTools.runtime.selectNotification", (item) => notifProvider.select(item)),
    vscode.commands.registerCommand("customDevTools.runtime.removeNotification", (item) => {
      domBridge.enqueueDismiss(item);
      notifProvider.remove(item);
    }),
    vscode.commands.registerCommand("customDevTools.runtime.toggleNotificationExpand", (item) => notifProvider.toggleExpand(item)),
    vscode.commands.registerCommand("customDevTools.runtime.expandNotification", (item) => notifProvider.expand(item)),
    vscode.commands.registerCommand("customDevTools.runtime.collapseNotification", (item) => notifProvider.collapse(item)),
    vscode.commands.registerCommand("customDevTools.runtime.translateNotification", (item) => notifProvider.translate(item)),
    vscode.commands.registerCommand("customDevTools.runtime.showOriginalNotification", (item) => notifProvider.showOriginal(item)),
    vscode.commands.registerCommand("customDevTools.runtime.showTranslationNotification", (item) => notifProvider.showTranslation(item)),
    vscode.commands.registerCommand("customDevTools.runtime.addDbConnection", async () => {
      const conn = await addDbConnection(dbConnMgr, dbInspector, controller);
      if (conn) dbConnDetailProvider.showEdit(conn);
      await dbConnListProvider.refresh(false);
    }),
    vscode.commands.registerCommand("customDevTools.runtime.testDbConnection", async (node) => {
      const conn = node && node.type ? node : dbConnMgr.get(node && (node.connId || node.id));
      await controller.testDbConnection(conn, { showResult: true });
      controller.refreshAll();
    }),
    vscode.commands.registerCommand("customDevTools.runtime.removeDbConnection", (node) => removeDbConnection(dbConnMgr, controller, node)),
    vscode.commands.registerCommand("customDevTools.runtime.editDbConnection", (node) => {
      const conn = dbConnMgr.get(node.id || node.connId);
      if (conn) dbConnDetailProvider.showEdit(conn);
    }),
    vscode.commands.registerCommand("customDevTools.runtime.openTableData", (node) => openTableDataWebview(dbInspector, dbConnMgr, node, context)),
    vscode.commands.registerCommand("customDevTools.runtime.openTableErd", (node) => openErdWebview(dbInspector, dbConnMgr, node, context)),
    vscode.commands.registerCommand("customDevTools.runtime.openRedisKeyData", (node) => openRedisKeyDataWebview(dbInspector, node, context)),

    vscode.commands.registerCommand("customDevTools.runtime.enableJavaExtensions", () => {}),
    vscode.commands.registerCommand("customDevTools.runtime.disableJavaExtensions", () => {}),
    vscode.commands.registerCommand("customDevTools.runtime.testEndpoint", (node) => openControllerTestWebview(node, context)),
    vscode.commands.registerCommand("customDevTools.runtime.refreshControllers", () => controller.refreshKind(VIEW_KINDS.springControllers)),
    vscode.window.registerWebviewViewProvider("customDevTools.runtime.themeSettings", new ThemeSettingsProvider(context))
  );
}

function startDockerEventWatcher(controller) {
  let child = null;
  let restartTimer = null;
  let disposed = false;

  function start() {
    if (disposed) return;
    child = spawn(getDockerBin(), [
      'events', '--filter', 'type=container',
      '--format', '{{.Status}} {{.Actor.Attributes.name}}'
    ], { windowsHide: true });

    child.stdout.on('data', (data) => {
      if (/\b(start|stop|die|restart|kill)\b/.test(data.toString())) {
        controller.refreshKind(VIEW_KINDS.docker);
        controller.refreshKind(VIEW_KINDS.database);
      }
    });

    child.on('exit', () => {
      if (!disposed) {
        restartTimer = setTimeout(start, 5000);
      }
    });
    child.on('error', () => {
      if (!disposed) {
        restartTimer = setTimeout(start, 10000);
      }
    });
  }

  start();

  return {
    dispose() {
      disposed = true;
      if (restartTimer) clearTimeout(restartTimer);
      if (child) { try { child.kill(); } catch {} }
    }
  };
}

function deactivate() {
  // Synchronous dispose only — async operations are unreliable during extension host shutdown.
  // panel.dispose() is synchronous and removes the tab from the editor immediately,
  // so the session state saved by VSCode will not include the webview panel.
  if (controllerTestPanel) {
    controllerTestPanel.dispose();
    controllerTestPanel = null;
  }
}

// ── 데이터베이스 연결 관리 ──────────────────────────────────────────────

class DatabaseConnectionManager {
  constructor(context) {
    this.context = context;
    this.secretStorage = context && context.secrets;
    this.selectedStateKey = 'customDevTools.runtime.selectedDbConnectionId';
    this.hiddenAutoStateKey = 'customDevTools.runtime.hiddenAutoDbConnectionIds';
    this.secretKeyPrefix = 'customDevTools.runtime.dbConnection.password.';
    this.configPath = path.join(os.homedir(), '.custom-dev-tools-db-connections.json');
    this.secretCache = new Map();
    this.pendingSecretWrites = new Map();
    this.connections = this.load();
    const persistedSelectedId = context && context.globalState
      ? context.globalState.get(this.selectedStateKey)
      : undefined;
    const hiddenAutoIds = context && context.globalState
      ? context.globalState.get(this.hiddenAutoStateKey, [])
      : [];
    this.hiddenAutoIds = new Set(Array.isArray(hiddenAutoIds) ? hiddenAutoIds : []);
    this.selectedConnectionId = typeof persistedSelectedId === 'string' ? persistedSelectedId : null;
  }
  async ready() {
    await this._flushPendingSecrets();
    this._ensureDefaults();
    await this._hydrateSecrets();
    if (this.selectedConnectionId === null || (this.selectedConnectionId && !this.getSelected())) {
      await this.select(this.connections[0] && this.connections[0].id);
    }
    this.save();
  }
  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      const connections = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.connections) ? parsed.connections : []);
      if (!Array.isArray(parsed) && parsed.selectedConnectionId && !this.selectedConnectionId) {
        this.selectedConnectionId = parsed.selectedConnectionId;
      }
      return connections.map((conn) => {
        const clean = { ...conn };
        if (typeof clean.password === 'string' && clean.password) {
          this.pendingSecretWrites.set(clean.id, clean.password);
        }
        delete clean.password;
        return clean;
      });
    } catch {
      return [];
    }
  }
  save() { fs.writeFileSync(this.configPath, JSON.stringify(this.connections, null, 2), 'utf8'); }
  _ensureDefaults() {
    // Defaults are discovered from the workspace, local processes, Docker, and user-created entries.
  }
  _secretKey(id) { return `${this.secretKeyPrefix}${id}`; }
  async _flushPendingSecrets() {
    if (!this.secretStorage) return;
    for (const [id, password] of this.pendingSecretWrites) {
      await this.secretStorage.store(this._secretKey(id), password);
    }
    this.pendingSecretWrites.clear();
  }
  async _hydrateSecrets() {
    if (!this.secretStorage) return;
    this.secretCache.clear();
    for (const conn of this.connections) {
      const password = await this.secretStorage.get(this._secretKey(conn.id));
      if (password) this.secretCache.set(conn.id, password);
    }
  }
  _withSecret(conn) {
    if (!conn) return undefined;
    const password = this.secretCache.get(conn.id) || '';
    return {
      ...conn,
      password,
      hasPassword: Boolean(password)
    };
  }
  async add(conn) {
    const id = `conn:${Date.now()}`;
    const { password, ...stored } = { ...conn, id };
    this.connections.push(stored);
    if (password) {
      if (this.secretStorage) await this.secretStorage.store(this._secretKey(id), password);
      this.secretCache.set(id, password);
    }
    this.save();
    await this.select(id);
    return this.get(id);
  }
  async addDraft() {
    return this.add({
      name: "새 연결",
      type: "mysql",
      host: "localhost",
      port: "3306",
      database: "",
      user: "",
      source: "manual",
      draft: true
    });
  }
  async syncAutoDetected(candidates) {
    const manualConnections = this.connections.filter((conn) => !isAutoConnectionSource(conn.source));
    const existingAutoById = new Map(this.connections.filter((conn) => isAutoConnectionSource(conn.source)).map((conn) => [conn.id, conn]));
    const nextAutoConnections = [];
    const seen = new Set();

    for (const candidate of candidates || []) {
      if (!candidate || !candidate.id || seen.has(candidate.id)) continue;
      if (this.hiddenAutoIds.has(candidate.id)) continue;
      seen.add(candidate.id);
      const { password, ...stored } = { ...candidate, source: candidate.source || "detected-auto", draft: false };
      const existing = existingAutoById.get(stored.id);
      const merged = existing ? {
        ...stored,
        name: existing.name || stored.name,
        host: existing.host || stored.host,
        port: existing.port || stored.port,
        database: existing.database || stored.database,
        user: existing.user || stored.user,
        containerName: existing.containerName || stored.containerName
      } : stored;
      nextAutoConnections.push(merged);
      if (password) {
        if (this.secretStorage) await this.secretStorage.store(this._secretKey(merged.id), password);
        this.secretCache.set(merged.id, password);
      }
    }

    const nextIds = new Set([...manualConnections, ...nextAutoConnections].map((conn) => conn.id));
    for (const conn of this.connections) {
      if (isAutoConnectionSource(conn.source) && !nextIds.has(conn.id)) {
        this.secretCache.delete(conn.id);
        if (this.secretStorage) await this.secretStorage.delete(this._secretKey(conn.id));
      }
    }

    this.connections = [...manualConnections, ...nextAutoConnections];
    if (this.selectedConnectionId && !this.connections.some((conn) => conn.id === this.selectedConnectionId)) {
      await this.select('');
    }
    this.save();
  }
  async remove(id) {
    const conn = this.connections.find(c => c.id === id);
    if (conn && isAutoConnectionSource(conn.source)) {
      this.hiddenAutoIds.add(id);
      if (this.context && this.context.globalState) {
        await this.context.globalState.update(this.hiddenAutoStateKey, Array.from(this.hiddenAutoIds));
      }
    }
    this.connections = this.connections.filter(c => c.id !== id);
    this.secretCache.delete(id);
    if (this.secretStorage) await this.secretStorage.delete(this._secretKey(id));
    if (this.selectedConnectionId === id) {
      await this.select(this.connections[0] && this.connections[0].id);
    }
    this.save();
  }
  async update(id, changes) {
    const idx = this.connections.findIndex(c => c.id === id);
    if (idx === -1) return;
    const next = { ...changes };
    if (Object.prototype.hasOwnProperty.call(next, 'password')) {
      const password = next.password;
      delete next.password;
      if (password) {
        if (this.secretStorage) await this.secretStorage.store(this._secretKey(id), password);
        this.secretCache.set(id, password);
      }
    }
    if (this.connections[idx].draft) {
      next.draft = false;
    }
    this.connections[idx] = { ...this.connections[idx], ...next };
    this.save();
  }
  getAll() { return this.connections.map((conn) => this._withSecret(conn)); }
  get(id) { return this._withSecret(this.connections.find(c => c.id === id)); }
  getSelected() {
    return this.selectedConnectionId ? this.get(this.selectedConnectionId) : undefined;
  }
  async select(id) {
    const validId = this.connections.some((conn) => conn.id === id) ? id : '';
    this.selectedConnectionId = validId;
    if (this.context && this.context.globalState) {
      await this.context.globalState.update(this.selectedStateKey, validId);
    }
  }
  async disconnect() {
    await this.select('');
  }
}

function getSqlite3Bin() {
  return process.env.CUSTOM_DEV_TOOLS_SQLITE3 || 'sqlite3';
}

class DatabaseInspector {
  sqlite3Bin() { return getSqlite3Bin(); }

  _parseTabularOutput(output) {
    const lines = output.trim().split(/\r?\n/).filter(l => l && !l.startsWith('mysql:'));
    if (lines.length < 2) return [];
    const headers = lines[0].split('\t');
    return lines.slice(1).map(line => {
      const vals = line.split('\t');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] === 'NULL' ? null : (vals[i] ?? null); });
      return obj;
    });
  }

  _mysqlDockerBase(connection) {
    // MYSQL_PWD로 비밀번호 전달 → stderr 경고 없음
    const user = connection.user || 'root';
    const password = connection.password || '';
    const database = connection.database || '';
    const args = ['exec', '-e', `MYSQL_PWD=${password}`, connection.containerName,
      'mysql', `-u${user}`, '--batch'];
    if (database) args.push(database);
    return args;
  }

  async _mysqlDockerQuery(connection, sql, strict = false) {
    const args = [...this._mysqlDockerBase(connection), '--skip-column-names', '-e', sql];
    const request = execFileText('docker', args, {}, 15000);
    return strict ? request : request.catch(() => '');
  }

  async _mysqlDockerQueryJson(connection, sql) {
    const args = [...this._mysqlDockerBase(connection), '-e', sql];
    const output = await execFileText('docker', args, {}, 15000).catch(() => '');
    return this._parseTabularOutput(output);
  }

  _mysqlClientBase(connection) {
    const args = [
      '-h', connection.host || 'localhost',
      '-P', String(connection.port || 3306),
      `-u${connection.user || 'root'}`,
      '--batch'
    ];
    if (connection.database) args.push(connection.database);
    return args;
  }

  async _mysqlClientQuery(connection, sql, strict = false) {
    const args = [...this._mysqlClientBase(connection), '--skip-column-names', '-e', sql];
    const request = execFileText('mysql', args, {
      env: { ...process.env, MYSQL_PWD: connection.password || '' }
    }, 15000);
    return strict ? request : request.catch(() => '');
  }

  async _mysqlClientQueryJson(connection, sql) {
    const args = [...this._mysqlClientBase(connection), '-e', sql];
    const output = await execFileText('mysql', args, {
      env: { ...process.env, MYSQL_PWD: connection.password || '' }
    }, 15000).catch(() => '');
    return this._parseTabularOutput(output);
  }

  async _postgresQuery(connection, sql, strict = false) {
    const args = [
      '-h', connection.host || 'localhost',
      '-p', String(connection.port || 5432),
      '-U', connection.user || 'postgres',
      '-d', connection.database || 'postgres',
      '-At',
      '-F', '\t',
      '-c', sql
    ];
    const request = execFileText('psql', args, {
      env: { ...process.env, PGPASSWORD: connection.password || '' }
    }, 15000);
    return strict ? request : request.catch(() => '');
  }

  async _postgresDockerQuery(connection, sql, strict = false) {
    const args = [
      'exec',
      '-e', `PGPASSWORD=${connection.password || ''}`,
      connection.containerName,
      'psql',
      '-U', connection.user || 'postgres',
      '-d', connection.database || 'postgres',
      '-At',
      '-F', '\t',
      '-c', sql
    ];
    const request = execFileText('docker', args, {}, 15000);
    return strict ? request : request.catch(() => '');
  }

  async _postgresAnyQuery(connection, sql, strict = false) {
    if (connection.type === 'postgres-docker') {
      return this._postgresDockerQuery(connection, sql, strict);
    }
    return this._postgresQuery(connection, sql, strict);
  }

  _postgresRows(output) {
    return output.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  _redisCommand(connection, args) {
    if (connection.type === 'redis-docker') {
      const result = ['exec', connection.containerName, 'redis-cli'];
      if (connection.password) result.push('-a', connection.password);
      result.push(...args);
      return { command: 'docker', args: result };
    }
    const result = ['-h', connection.host || 'localhost', '-p', String(connection.port || 6379)];
    if (connection.password) result.push('-a', connection.password);
    result.push(...args);
    return { command: 'redis-cli', args: result };
  }

  async _redisQuery(connection, args, timeout = 8000) {
    const spec = this._redisCommand(connection, args);
    return execFileText(spec.command, spec.args, {}, timeout);
  }

  async testConnection(connection) {
    if (connection.type === 'sqlite') {
      if (!connection.path || !fs.existsSync(connection.path)) {
        throw new Error('SQLite 파일을 찾을 수 없습니다.');
      }
      await execFileText(this.sqlite3Bin(), [connection.path, 'SELECT 1;'], {}, 8000);
      const tables = await this.getTables(connection);
      return `연결됨 · ${tables.length} tables`;
    }
    if (connection.type === 'mysql-docker') {
      await this._mysqlDockerQuery(connection, 'SELECT 1', true);
      const tables = await this.getTables(connection);
      return `연결됨 · ${tables.length} tables`;
    }
    if (connection.type === 'mysql') {
      await this._mysqlClientQuery(connection, 'SELECT 1', true);
      const tables = await this.getTables(connection);
      return `연결됨 · ${tables.length} tables`;
    }
    if (connection.type === 'postgres') {
      await this._postgresQuery(connection, 'SELECT 1', true);
      const tables = await this.getTables(connection);
      return `연결됨 · ${tables.length} tables`;
    }
    if (connection.type === 'postgres-docker') {
      await this._postgresDockerQuery(connection, 'SELECT 1', true);
      const tables = await this.getTables(connection);
      return `연결됨 · ${tables.length} tables`;
    }
    if (connection.type === 'redis-docker') {
      const output = await this._redisQuery(connection, ['PING'], 8000);
      if (!/PONG/i.test(output)) throw new Error(output || 'Redis PING 실패');
      const keys = await this.getRedisKeys(connection);
      return `연결됨 · ${keys.length} keys`;
    }
    if (connection.type === 'redis') {
      const output = await this._redisQuery(connection, ['PING'], 8000);
      if (!/PONG/i.test(output)) throw new Error(output || 'Redis PING 실패');
      const keys = await this.getRedisKeys(connection);
      return `연결됨 · ${keys.length} keys`;
    }
    throw new Error(`지원하지 않는 DB 유형입니다: ${connection.type}`);
  }

  async getDatabases(connection) {
    if (connection.type === 'mysql-docker') {
      const output = await this._mysqlDockerQuery({ ...connection, database: '' }, 'SHOW DATABASES');
      return output.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        .filter(db => !['information_schema','performance_schema','sys','mysql'].includes(db));
    }
    if (connection.type === 'postgres-docker') {
      const output = await this._postgresDockerQuery({ ...connection, database: 'postgres' },
        `SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname`
      );
      return this._postgresRows(output);
    }
    return [];
  }

  async getTables(connection) {
    if (connection.type === 'sqlite') {
      const output = await execFileText(this.sqlite3Bin(), [connection.path, '.tables'], {}, 8000).catch(() => '');
      return output.trim().split(/\s+/).filter(Boolean);
    }
    if (connection.type === 'mysql-docker') {
      const output = await this._mysqlDockerQuery(connection, 'SHOW TABLES');
      return output.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    if (connection.type === 'mysql') {
      const output = await this._mysqlClientQuery(connection, 'SHOW TABLES');
      return output.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    if (connection.type === 'postgres' || connection.type === 'postgres-docker') {
      const output = await this._postgresAnyQuery(connection,
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
      );
      return this._postgresRows(output);
    }
    return [];
  }

  async getColumns(connection, tableName) {
    if (connection.type === 'sqlite') {
      const output = await execFileText(this.sqlite3Bin(), [connection.path, '-json', `PRAGMA table_info('${tableName}')`], {}, 8000).catch(() => '[]');
      try {
        const rows = JSON.parse(output.trim() || '[]');
        return rows.map(r => ({ name: r.name, type: r.type, pk: r.pk > 0, notnull: r.notnull > 0 }));
      } catch { return []; }
    }
    if (connection.type === 'mysql-docker') {
      const rows = await this._mysqlDockerQueryJson(connection,
        `SELECT COLUMN_NAME as name, COLUMN_TYPE as type, COLUMN_KEY as key_type, IS_NULLABLE as nullable ` +
        `FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=${sqlTextLiteral(connection.database)} AND TABLE_NAME=${sqlTextLiteral(tableName)} ORDER BY ORDINAL_POSITION`
      );
      return rows.map(r => ({ name: r.name, type: r.type, pk: r.key_type === 'PRI', notnull: r.nullable === 'NO' }));
    }
    if (connection.type === 'mysql') {
      const rows = await this._mysqlClientQueryJson(connection,
        `SELECT COLUMN_NAME as name, COLUMN_TYPE as type, COLUMN_KEY as key_type, IS_NULLABLE as nullable ` +
        `FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=${sqlTextLiteral(connection.database)} AND TABLE_NAME=${sqlTextLiteral(tableName)} ORDER BY ORDINAL_POSITION`
      );
      return rows.map(r => ({ name: r.name, type: r.type, pk: r.key_type === 'PRI', notnull: r.nullable === 'NO' }));
    }
    if (connection.type === 'postgres' || connection.type === 'postgres-docker') {
      const output = await this._postgresAnyQuery(connection,
        `SELECT c.column_name, c.data_type, ` +
        `CASE WHEN tc.constraint_type='PRIMARY KEY' THEN '1' ELSE '0' END, ` +
        `CASE WHEN c.is_nullable='NO' THEN '1' ELSE '0' END ` +
        `FROM information_schema.columns c ` +
        `LEFT JOIN information_schema.key_column_usage kcu ON c.table_schema=kcu.table_schema AND c.table_name=kcu.table_name AND c.column_name=kcu.column_name ` +
        `LEFT JOIN information_schema.table_constraints tc ON kcu.constraint_schema=tc.constraint_schema AND kcu.constraint_name=tc.constraint_name ` +
        `WHERE c.table_schema='public' AND c.table_name=${sqlTextLiteral(tableName)} ORDER BY c.ordinal_position`
      );
      return this._postgresRows(output).map((line) => {
        const [name, type, pk, notnull] = line.split('\t');
        return { name, type, pk: pk === '1', notnull: notnull === '1' };
      });
    }
    return [];
  }

  async getData(connection, tableName, limit = 200) {
    if (connection.type === 'sqlite') {
      const output = await execFileText(this.sqlite3Bin(), [connection.path, '-json', `SELECT * FROM '${tableName}' LIMIT ${limit}`], {}, 8000).catch(() => '[]');
      try { return JSON.parse(output.trim() || '[]'); } catch { return []; }
    }
    if (connection.type === 'mysql-docker') {
      return this._mysqlDockerQueryJson(connection, `SELECT * FROM ${sqlIdentifier(connection, tableName)} LIMIT ${Number(limit) || 200}`);
    }
    if (connection.type === 'mysql') {
      return this._mysqlClientQueryJson(connection, `SELECT * FROM ${sqlIdentifier(connection, tableName)} LIMIT ${Number(limit) || 200}`);
    }
    if (connection.type === 'postgres' || connection.type === 'postgres-docker') {
      const output = await this._postgresAnyQuery(connection,
        `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text FROM (SELECT * FROM ${sqlIdentifier(connection, tableName)} LIMIT ${Number(limit) || 200}) t`
      );
      try { return JSON.parse(output.trim() || '[]'); } catch { return []; }
    }
    return [];
  }

  async getForeignKeys(connection, tableName) {
    if (connection.type === 'sqlite') {
      const output = await execFileText(this.sqlite3Bin(), [connection.path, '-json', `PRAGMA foreign_key_list('${tableName}')`], {}, 8000).catch(() => '[]');
      try {
        const rows = JSON.parse(output.trim() || '[]');
        return rows.map(r => ({ from: r.from, table: r.table, to: r.to }));
      } catch { return []; }
    }
    if (connection.type === 'mysql-docker') {
      const rows = await this._mysqlDockerQueryJson(connection,
        `SELECT COLUMN_NAME as \`from\`, REFERENCED_TABLE_NAME as \`table\`, REFERENCED_COLUMN_NAME as \`to\` ` +
        `FROM information_schema.KEY_COLUMN_USAGE ` +
        `WHERE TABLE_SCHEMA=${sqlTextLiteral(connection.database)} AND TABLE_NAME=${sqlTextLiteral(tableName)} AND REFERENCED_TABLE_NAME IS NOT NULL`
      );
      return rows;
    }
    if (connection.type === 'mysql') {
      const rows = await this._mysqlClientQueryJson(connection,
        `SELECT COLUMN_NAME as \`from\`, REFERENCED_TABLE_NAME as \`table\`, REFERENCED_COLUMN_NAME as \`to\` ` +
        `FROM information_schema.KEY_COLUMN_USAGE ` +
        `WHERE TABLE_SCHEMA=${sqlTextLiteral(connection.database)} AND TABLE_NAME=${sqlTextLiteral(tableName)} AND REFERENCED_TABLE_NAME IS NOT NULL`
      );
      return rows;
    }
    if (connection.type === 'postgres' || connection.type === 'postgres-docker') {
      const output = await this._postgresAnyQuery(connection,
        `SELECT kcu.column_name, ccu.table_name, ccu.column_name ` +
        `FROM information_schema.table_constraints tc ` +
        `JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema ` +
        `JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema ` +
        `WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name=${sqlTextLiteral(tableName)}`
      );
      return this._postgresRows(output).map((line) => {
        const [from, table, to] = line.split('\t');
        return { from, table, to };
      });
    }
    return [];
  }

  async executeSQL(connection, sql) {
    if (connection.type === 'sqlite') {
      const output = await execFileText(this.sqlite3Bin(), [connection.path, sql], {}, 10000);
      return output;
    }
    if (connection.type === 'mysql-docker') {
      return this._mysqlDockerQuery(connection, sql);
    }
    if (connection.type === 'mysql') {
      return this._mysqlClientQuery(connection, sql);
    }
    if (connection.type === 'postgres' || connection.type === 'postgres-docker') {
      return this._postgresAnyQuery(connection, sql);
    }
    throw new Error('지원하지 않는 DB 유형입니다.');
  }

  async getRedisKeys(connection) {
    const output = await this._redisQuery(connection, ['KEYS', '*'], 8000).catch(() => '');
    return output.trim().split(/\r?\n/).filter(Boolean).sort();
  }

  async getRedisKeyInfo(connection, key) {
    const typeOut = await this._redisQuery(connection, ['TYPE', key], 5000).catch(() => 'none');
    const type = typeOut.trim();
    let value = '';
    try {
      if (type === 'string') {
        value = await this._redisQuery(connection, ['GET', key], 5000);
      } else if (type === 'hash') {
        value = await this._redisQuery(connection, ['HGETALL', key], 5000);
      } else if (type === 'list') {
        value = await this._redisQuery(connection, ['LRANGE', key, '0', '-1'], 5000);
      } else if (type === 'set') {
        value = await this._redisQuery(connection, ['SMEMBERS', key], 5000);
      } else if (type === 'zset') {
        value = await this._redisQuery(connection, ['ZRANGE', key, '0', '-1', 'WITHSCORES'], 5000);
      }
    } catch {}
    return { type, value: value.trim() };
  }

  async getAllTablesSchema(connection) {
    const tables = await this.getTables(connection);
    const result = [];
    for (const tableName of tables) {
      const [columns, foreignKeys] = await Promise.all([
        this.getColumns(connection, tableName),
        this.getForeignKeys(connection, tableName)
      ]);
      result.push({ tableName, columns, foreignKeys });
    }
    return result;
  }
}

// ── DB 커맨드 함수 ──────────────────────────────────────────────

async function addDbConnection(dbConnMgr, dbInspector, controller) {
  const conn = await dbConnMgr.addDraft();
  controller.refreshAll();
  return conn;
}

async function removeDbConnection(dbConnMgr, controller, node) {
  const id = node && (node.connId || node.id);
  const conn = dbConnMgr.get(id);
  if (!conn) {
    vscode.window.showErrorMessage("연결을 찾을 수 없습니다.");
    return;
  }
  const answer = await vscode.window.showWarningMessage(
    `'${conn.name}' 연결을 삭제할까요?`,
    { modal: true },
    "삭제"
  );
  if (answer !== "삭제") return;
  await dbConnMgr.remove(id);
  controller.refreshAll();
}

async function openEditConnectionWebview(dbConnMgr, controller, node, context) {
  const conn = dbConnMgr.get(node.id);
  if (!conn) { vscode.window.showErrorMessage('연결을 찾을 수 없습니다.'); return; }

  const panel = vscode.window.createWebviewPanel(
    'customDevToolsEditDbConn',
    `연결 편집: ${conn.name}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const isSqlite = conn.type === 'sqlite';
  panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body { background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 20px; }
label { display: block; margin-bottom: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
input { width: 100%; padding: 6px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); border-radius: 3px; font-size: 13px; margin-bottom: 12px; }
input:focus { outline: 1px solid var(--vscode-focusBorder); }
.row { display: flex; gap: 12px; }
.row > div { flex: 1; }
.btn { padding: 6px 18px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 13px; margin-right: 8px; }
.btn:hover { background: var(--vscode-button-hoverBackground); }
h3 { margin: 0 0 16px; font-size: 14px; }
</style></head><body>
<h3>연결 편집</h3>
<label>연결 이름</label>
<input id="name" value="${escapeHtml(conn.name)}" />
<label>유형</label>
<input id="type" value="${escapeHtml(conn.type)}" readonly style="opacity:0.6;cursor:not-allowed" />
${isSqlite ? `
<label>파일 경로</label>
<input id="path" value="${escapeHtml(conn.path || '')}" />
` : `
<div class="row">
  <div><label>호스트</label><input id="host" value="${escapeHtml(conn.host || 'localhost')}" /></div>
  <div><label>포트</label><input id="port" value="${escapeHtml(String(conn.port || ''))}" /></div>
</div>
<label>데이터베이스</label>
<input id="database" value="${escapeHtml(conn.database || '')}" />
<label>사용자</label>
<input id="user" value="${escapeHtml(conn.user || '')}" />
<label>비밀번호</label>
<input id="password" type="password" value="" placeholder="${escapeHtml(conn.hasPassword ? '저장된 비밀번호 유지' : '비밀번호 입력')}" autocomplete="off" />
`}
<button class="btn" id="save">저장</button>
<button class="btn" id="cancel" style="background:transparent;border:1px solid #555;color:var(--vscode-foreground)">취소</button>
<script>
const vscode = acquireVsCodeApi();
document.getElementById('save').addEventListener('click', () => {
  const isSqlite = ${JSON.stringify(isSqlite)};
  const changes = { name: document.getElementById('name').value };
  if (isSqlite) {
    changes.path = document.getElementById('path').value;
  } else {
    changes.host = document.getElementById('host').value;
    changes.port = document.getElementById('port').value;
    changes.database = document.getElementById('database').value;
    changes.user = document.getElementById('user').value;
    const password = document.getElementById('password').value;
    if (password) changes.password = password;
  }
  vscode.postMessage({ type: 'save', changes });
});
document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
</script>
</body></html>`;

  panel.webview.onDidReceiveMessage(async msg => {
    if (msg.type === 'save') {
      await dbConnMgr.update(conn.id, msg.changes);
      controller.refreshAll();
      vscode.window.showInformationMessage(`'${msg.changes.name || conn.name}' 연결이 수정되었습니다.`);
      panel.dispose();
    } else if (msg.type === 'cancel') {
      panel.dispose();
    }
  }, undefined, context.subscriptions);
}

async function openTableDataWebview(dbInspector, dbConnMgr, node, context) {
  const conn = node.dockerConn || dbConnMgr.get(node.connId);
  if (!conn) {
    vscode.window.showErrorMessage('연결을 찾을 수 없습니다.');
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'customDevToolsTableData',
    `${node.tableName} 데이터`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  async function loadAndRender() {
    try {
      const [rows, columns] = await Promise.all([
        dbInspector.getData(conn, node.tableName),
        dbInspector.getColumns(conn, node.tableName)
      ]);
      panel.webview.html = buildTableDataHtml(rows, columns, node.tableName, conn);
    } catch (err) {
      panel.webview.html = `<html><body style="background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);padding:16px"><p>오류: ${escapeHtml(err.message)}</p></body></html>`;
    }
  }

  await loadAndRender();

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'insert') {
      try {
        const cols = msg.row ? Object.keys(msg.row).filter(k => msg.row[k] !== '' && msg.row[k] !== null) : [];
        if (!cols.length) { vscode.window.showErrorMessage('삽입할 데이터가 없습니다.'); return; }
        const vals = cols.map(c => sqlLiteral(msg.row[c]));
        const sql = `INSERT INTO ${sqlIdentifier(conn, node.tableName)} (${cols.map(c => sqlIdentifier(conn, c)).join(',')}) VALUES (${vals.join(',')})`;
        await dbInspector.executeSQL(conn, sql);
        await loadAndRender();
      } catch (e) { vscode.window.showErrorMessage(`삽입 실패: ${e.message}`); }
    } else if (msg.type === 'update') {
      try {
        const setClause = Object.entries(msg.changes).map(([k, v]) => `${sqlIdentifier(conn, k)}=${sqlLiteral(v)}`).join(',');
        const whereClause = Object.entries(msg.pk).map(([k, v]) => `${sqlIdentifier(conn, k)}=${sqlLiteral(v)}`).join(' AND ');
        const sql = `UPDATE ${sqlIdentifier(conn, node.tableName)} SET ${setClause} WHERE ${whereClause}`;
        await dbInspector.executeSQL(conn, sql);
        await loadAndRender();
      } catch (e) { vscode.window.showErrorMessage(`수정 실패: ${e.message}`); }
    } else if (msg.type === 'delete') {
      try {
        const whereClause = Object.entries(msg.pk).map(([k, v]) => `${sqlIdentifier(conn, k)}=${sqlLiteral(v)}`).join(' AND ');
        const sql = `DELETE FROM ${sqlIdentifier(conn, node.tableName)} WHERE ${whereClause}`;
        await dbInspector.executeSQL(conn, sql);
        await loadAndRender();
      } catch (e) { vscode.window.showErrorMessage(`삭제 실패: ${e.message}`); }
    }
  }, undefined, context.subscriptions);
}

function sqlLiteral(value) {
  if (value === null || value === undefined || value === 'NULL') return 'NULL';
  const n = Number(value);
  if (!isNaN(n) && String(value).trim() !== '') return String(n);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextLiteral(value) {
  if (value === null || value === undefined) return "''";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlIdentifier(connection, value) {
  const text = String(value).replace(/\0/g, "");
  if (connection && (connection.type === 'postgres' || connection.type === 'postgres-docker')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return `\`${text.replace(/`/g, '``')}\``;
}

function erdPositionStorageKey(connection) {
  const raw = [
    connection && connection.id,
    connection && connection.type,
    connection && connection.database,
    connection && connection.path,
    connection && connection.containerName
  ].filter(Boolean).join('|');
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
  }
  return `customDevTools.runtime.erdPositions.${(hash >>> 0).toString(36)}`;
}

function buildTableDataHtml(rows, columns, tableName, conn) {
  const pkCols = columns.filter(c => c.pk).map(c => c.name);
  const colNames = columns.map(c => c.name);
  const hasRows = rows.length > 0;
  const effectiveCols = hasRows ? Object.keys(rows[0]) : colNames;

  const thHeaders = effectiveCols.map(h => `<th>${escapeHtml(String(h))}</th>`).join('');
  const bodyRows = rows.map((r, ri) => {
    const pkData = JSON.stringify(pkCols.reduce((acc, k) => { acc[k] = r[k]; return acc; }, {}));
    const cells = effectiveCols.map(h => {
      const val = r[h];
      return `<td contenteditable="true" data-col="${escapeHtml(h)}" data-orig="${escapeHtml(val == null ? '' : String(val))}">${escapeHtml(val == null ? '' : String(val))}</td>`;
    }).join('');
    return `<tr data-ri="${ri}" data-pk='${pkData.replace(/'/g, "&#39;")}'>${cells}<td class="actions-col"><button class="btn-save" data-ri="${ri}">저장</button><button class="btn-del" data-ri="${ri}">삭제</button></td></tr>`;
  }).join('');

  const newRowInputs = effectiveCols.map(h =>
    `<td><input class="new-input" data-col="${escapeHtml(h)}" placeholder="${escapeHtml(h)}" /></td>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { background: var(--vscode-editor-background); color: var(--vscode-foreground); margin: 8px; font-family: var(--vscode-font-family); font-size: 12px; }
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.btn { padding: 3px 10px; border: 1px solid var(--vscode-button-background); background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 3px; cursor: pointer; font-size: 11px; }
.btn:hover { background: var(--vscode-button-hoverBackground); }
.btn-del { background: transparent; color: #e57373; border: 1px solid #e5737355; }
.btn-del:hover { background: #e5737322; }
.btn-save { background: transparent; color: #81c784; border: 1px solid #81c78455; }
.btn-save:hover { background: #81c78422; }
.count { color: var(--vscode-descriptionForeground); font-size: 11px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--vscode-panel-border, #333); padding: 3px 6px; text-align: left; }
th { background: var(--vscode-editor-lineHighlightBackground, #1e1e1e); position: sticky; top: 0; z-index: 1; }
tr:nth-child(even) { background: rgba(255,255,255,0.03); }
td[contenteditable="true"]:focus { outline: 1px solid var(--vscode-focusBorder); background: rgba(255,255,255,0.07); }
.actions-col { width: 100px; white-space: nowrap; }
.new-row-section { margin-top: 12px; }
.new-row-section h4 { margin: 0 0 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.new-input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 2px 4px; font-size: 11px; width: 100%; }
</style></head><body>
<div class="toolbar">
  <span class="count">${rows.length} rows · ${tableName}</span>
</div>
<table>
  <thead><tr>${thHeaders}<th class="actions-col"></th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
<div class="new-row-section">
  <h4>새 행 추가</h4>
  <table>
    <thead><tr>${thHeaders}<th></th></tr></thead>
    <tbody><tr id="new-row">${newRowInputs}<td><button class="btn" id="btn-insert">삽입</button></td></tr></tbody>
  </table>
</div>
<script>
const vscode = acquireVsCodeApi();
const pkCols = ${JSON.stringify(pkCols)};

document.querySelectorAll('.btn-save').forEach(btn => {
  btn.addEventListener('click', () => {
    const ri = btn.dataset.ri;
    const row = document.querySelector('tr[data-ri="'+ri+'"]');
    const pk = JSON.parse(row.dataset.pk.replace(/&#39;/g, "'"));
    const changes = {};
    row.querySelectorAll('td[data-col]').forEach(td => {
      const orig = td.dataset.orig;
      const cur = td.textContent;
      if (cur !== orig) changes[td.dataset.col] = cur;
    });
    if (!Object.keys(changes).length) return;
    vscode.postMessage({ type: 'update', pk, changes });
  });
});

document.querySelectorAll('.btn-del').forEach(btn => {
  btn.addEventListener('click', () => {
    const ri = btn.dataset.ri;
    const row = document.querySelector('tr[data-ri="'+ri+'"]');
    const pk = JSON.parse(row.dataset.pk.replace(/&#39;/g, "'"));
    if (!pkCols.length) { alert('PK 컬럼이 없어 삭제할 수 없습니다.'); return; }
    if (!confirm('이 행을 삭제하시겠습니까?')) return;
    vscode.postMessage({ type: 'delete', pk });
  });
});

document.getElementById('btn-insert').addEventListener('click', () => {
  const row = {};
  document.querySelectorAll('.new-input').forEach(inp => {
    if (inp.value !== '') row[inp.dataset.col] = inp.value;
  });
  vscode.postMessage({ type: 'insert', row });
});
</script>
</body></html>`;
}

async function openErdWebview(dbInspector, dbConnMgr, node, context) {
  const conn = node.dockerConn || dbConnMgr.get(node.connId);
  if (!conn) {
    vscode.window.showErrorMessage('연결을 찾을 수 없습니다.');
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'customDevToolsErd',
    `${conn.name} ERD`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  try {
    const schema = await dbInspector.getAllTablesSchema(conn);
    const storageKey = erdPositionStorageKey(conn);
    const savedPositions = context.globalState.get(storageKey, {});
    const COLS = 3;
    const BOX_W = 180;
    const COL_H = 16;
    const HEADER_H = 24;
    const PAD = 8;
    const H_GAP = 220;
    const V_GAP = 200;

    const tableIndex = new Map(schema.map((t, i) => [t.tableName, i]));
    const boxes = schema.map((t, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const saved = savedPositions[t.tableName] || {};
      const x = Number.isFinite(saved.x) ? saved.x : col * H_GAP + PAD;
      const y = Number.isFinite(saved.y) ? saved.y : row * V_GAP + PAD;
      const h = HEADER_H + t.columns.length * COL_H + PAD;
      return { ...t, x, y, w: BOX_W, h };
    });

    const totalRows = Math.ceil(schema.length / COLS);
    const svgW = Math.max(1200, COLS * H_GAP + PAD * 2);
    const svgH = Math.max(800, totalRows * V_GAP + PAD * 2);

    let lines = '';
    for (const box of boxes) {
      for (const fk of box.foreignKeys) {
        const target = boxes.find(b => b.tableName === fk.table);
        if (!target) continue;
        lines += `<line class="fk-line" data-from="${escapeHtml(box.tableName)}" data-to="${escapeHtml(target.tableName)}" stroke="#888" stroke-width="1" marker-end="url(#arrow)"/>`;
      }
    }

    let rects = '';
    for (const box of boxes) {
      rects += `<g class="table-box" data-table="${escapeHtml(box.tableName)}" data-x="${box.x}" data-y="${box.y}" data-w="${box.w}" data-h="${box.h}" transform="translate(${box.x},${box.y})">`;
      rects += `<rect x="0" y="0" width="${box.w}" height="${box.h}" rx="4" fill="#1e1e1e" stroke="#6b6b6b" stroke-width="1"/>`;
      rects += `<rect class="drag-handle" x="0" y="0" width="${box.w}" height="${HEADER_H}" rx="4" fill="#252535" stroke="none"/>`;
      rects += `<text x="${box.w / 2}" y="16" text-anchor="middle" font-size="13" font-weight="bold" fill="#ddd">${escapeHtml(box.tableName)}</text>`;
      box.columns.forEach((col, ci) => {
        const cy = HEADER_H + ci * COL_H + 12;
        const label = `${col.name} : ${col.type}${col.pk ? ' PK' : ''}`;
        rects += `<text x="6" y="${cy}" font-size="11" fill="${col.pk ? '#f5a623' : '#aaa'}">${escapeHtml(label)}</text>`;
      });
      rects += `</g>`;
    }

    panel.webview.html = `<!DOCTYPE html><html><head><style>
body { background: #111; color:#ddd; margin: 0; padding: 0; font-family: var(--vscode-font-family); overflow: auto; }
.toolbar { position: sticky; top: 0; z-index: 2; display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; background:#111; border-bottom:1px solid #333; color:#aaa; font-size:11px; }
.canvas { padding: 8px; }
svg { display: block; background:#151515; border:1px solid #333; }
.table-box { cursor: grab; user-select:none; }
.table-box:active { cursor: grabbing; }
.table-box.dragging rect:first-child { stroke: var(--vscode-focusBorder,#7aa2f7); stroke-width: 2; }
.fk-line { pointer-events:none; }
</style></head><body>
<div class="toolbar"><strong>${escapeHtml(conn.name)}</strong><span>테이블을 드래그해서 ERD 위치를 조절할 수 있습니다.</span></div>
<div class="canvas">
<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#888"/></marker></defs>
${lines}${rects}
</svg></div>
<script>
const vscode = acquireVsCodeApi();
const svg = document.querySelector('svg');
const groups = Array.from(document.querySelectorAll('.table-box'));
let drag = null;
let saveTimer = null;

function pointFromEvent(event) {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function groupMap() {
  const map = new Map();
  groups.forEach((group) => map.set(group.dataset.table, group));
  return map;
}

function updateLines() {
  const map = groupMap();
  document.querySelectorAll('.fk-line').forEach((line) => {
    const from = map.get(line.dataset.from);
    const to = map.get(line.dataset.to);
    if (!from || !to) return;
    const fx = Number(from.dataset.x);
    const fy = Number(from.dataset.y);
    const fw = Number(from.dataset.w);
    const fh = Number(from.dataset.h);
    const tx = Number(to.dataset.x);
    const ty = Number(to.dataset.y);
    const th = Number(to.dataset.h);
    line.setAttribute('x1', fx + fw);
    line.setAttribute('y1', fy + Math.min(24, fh / 2));
    line.setAttribute('x2', tx);
    line.setAttribute('y2', ty + Math.min(24, th / 2));
  });
}

function collectPositions() {
  const positions = {};
  groups.forEach((group) => {
    positions[group.dataset.table] = {
      x: Number(group.dataset.x),
      y: Number(group.dataset.y)
    };
  });
  return positions;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    vscode.postMessage({ type: 'erdPositions', positions: collectPositions() });
  }, 250);
}

groups.forEach((group) => {
  group.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const start = pointFromEvent(event);
    drag = {
      group,
      startX: start.x,
      startY: start.y,
      baseX: Number(group.dataset.x),
      baseY: Number(group.dataset.y)
    };
    group.classList.add('dragging');
    group.setPointerCapture(event.pointerId);
  });
  group.addEventListener('pointermove', (event) => {
    if (!drag || drag.group !== group) return;
    const pt = pointFromEvent(event);
    const x = Math.max(0, drag.baseX + pt.x - drag.startX);
    const y = Math.max(0, drag.baseY + pt.y - drag.startY);
    group.dataset.x = String(Math.round(x));
    group.dataset.y = String(Math.round(y));
    group.setAttribute('transform', 'translate(' + Math.round(x) + ',' + Math.round(y) + ')');
    updateLines();
  });
  group.addEventListener('pointerup', (event) => {
    if (!drag || drag.group !== group) return;
    group.classList.remove('dragging');
    drag = null;
    group.releasePointerCapture(event.pointerId);
    scheduleSave();
  });
});

updateLines();
</script></body></html>`;
    panel.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === 'erdPositions' && msg.positions && typeof msg.positions === 'object') {
        context.globalState.update(storageKey, msg.positions);
      }
    }, undefined, context.subscriptions);
  } catch (err) {
    panel.webview.html = `<html><body style="background:#111;color:#ddd;font-family:monospace;padding:16px"><p>ERD 오류: ${escapeHtml(err.message)}</p></body></html>`;
  }
}

async function openRedisKeyDataWebview(dbInspector, node, context) {
  const panel = vscode.window.createWebviewPanel(
    'customDevToolsRedisKeyData',
    `Redis: ${node.label}`,
    vscode.ViewColumn.One,
    { enableScripts: false }
  );
  try {
    const { type, value } = await dbInspector.getRedisKeyInfo(node.redisConn || { containerName: node.containerName }, node.label);
    let bodyHtml = '';
    if (type === 'hash') {
      const lines = value.split(/\r?\n/).filter(Boolean);
      const rows = [];
      for (let i = 0; i < lines.length; i += 2) {
        rows.push(`<tr><td class="key-col">${escapeHtml(lines[i])}</td><td>${escapeHtml(lines[i+1] ?? '')}</td></tr>`);
      }
      bodyHtml = `<table><thead><tr><th>필드</th><th>값</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    } else if (type === 'list' || type === 'set' || type === 'zset') {
      const lines = value.split(/\r?\n/).filter(Boolean);
      const rows = lines.map((l, i) => `<tr><td class="key-col">${i}</td><td>${escapeHtml(l)}</td></tr>`).join('');
      bodyHtml = `<table><thead><tr><th>인덱스</th><th>값</th></tr></thead><tbody>${rows}</tbody></table>`;
    } else {
      bodyHtml = `<pre class="string-val">${escapeHtml(value)}</pre>`;
    }
    panel.webview.html = `<!DOCTYPE html><html><head><style>
body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:12px;margin:8px}
.meta{color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:8px}
.type-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:bold;background:#7c4daa;color:#fff;margin-right:6px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--vscode-panel-border,#333);padding:4px 8px;text-align:left}
th{background:var(--vscode-editor-lineHighlightBackground);position:sticky;top:0}
tr:nth-child(even){background:rgba(255,255,255,.03)}
.key-col{color:#b49de0;font-weight:500;white-space:nowrap;width:30%}
.string-val{white-space:pre-wrap;word-break:break-all;background:var(--vscode-editor-lineHighlightBackground);padding:12px;border-radius:4px;margin:0}
</style></head><body>
<div class="meta"><span class="type-badge">${escapeHtml(type)}</span><strong>${escapeHtml(node.label)}</strong></div>
${bodyHtml}
</body></html>`;
  } catch (err) {
    panel.webview.html = `<html><body style="background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:16px"><p>오류: ${escapeHtml(err.message)}</p></body></html>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getIcon(node) {
  if (node.running) {
    return new vscode.ThemeIcon("debug-stop");
  }
  if (node.contextValue === "customDevToolsRunnableStopped" || node.runKind) {
    return new vscode.ThemeIcon("play");
  }
  return node.iconPath || new vscode.ThemeIcon("circle-outline");
}

function categoryNode(id, label, children, collapsibleState = vscode.TreeItemCollapsibleState.Collapsed, description = "") {
  return new RuntimeNode({
    id,
    label,
    description,
    children,
    collapsibleState,
    iconPath: new vscode.ThemeIcon("folder"),
    contextValue: "customDevToolsCategory"
  });
}

function emptyNode(label) {
  return new RuntimeNode({
    id: `empty:${label}`,
    label,
    description: "",
    iconPath: new vscode.ThemeIcon("info"),
    contextValue: "customDevToolsInfo"
  });
}

function buildFileTree(root, entries) {
  const virtualRoot = { children: [] };
  const nodeByRelPath = new Map();
  nodeByRelPath.set("", virtualRoot);

  for (const { filePath, node } of entries) {
    const relPath = relative(root, filePath).replace(/\\/g, "/");
    const parts = relPath.split("/");
    const dirParts = parts.slice(0, -1);
    let currentRelPath = "";

    for (const dirPart of dirParts) {
      const parentRelPath = currentRelPath;
      currentRelPath = currentRelPath ? `${currentRelPath}/${dirPart}` : dirPart;

      if (!nodeByRelPath.has(currentRelPath)) {
        const dirNode = new RuntimeNode({
          id: `dir:${currentRelPath}`,
          label: dirPart,
          dirPath: path.join(root, currentRelPath.replace(/\//g, path.sep)),
          children: [],
          contextValue: "customDevToolsCategory"
          // iconPath 미설정 → material-icon-theme이 폴더 아이콘 자동 적용
        });
        nodeByRelPath.get(parentRelPath).children.push(dirNode);
        nodeByRelPath.set(currentRelPath, dirNode);
      }
    }

    nodeByRelPath.get(dirParts.join("/")).children.push(node);
  }

  return virtualRoot.children;
}

// 형제가 없는(유일한 자식) 폴더만 자동 펼침, 형제가 있으면 접힘
function autoExpandFolderTree(nodes) {
  const onlyChild = nodes.length === 1;
  return nodes.map(node => {
    if (!node.children) return node;
    const processed = autoExpandFolderTree(node.children);
    return new RuntimeNode(Object.assign({}, node, {
      collapsibleState: onlyChild
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      children: processed
    }));
  });
}

function walk(root, extensions) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < 500) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      if (extensions.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function parseComposeServices(filePath) {
  const text = readText(filePath);
  const services = [];
  let inServices = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) {
      continue;
    }
    const match = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
    if (match) {
      services.push(match[1]);
    }
  }
  return services;
}

function parseComposeServiceDetails(filePath) {
  const text = readText(filePath);
  const lines = text.split(/\r?\n/);
  const services = [];
  let current = null;
  let inServices = false;
  let currentIndent = 0;

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;

    const serviceMatch = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
    if (serviceMatch) {
      current = { name: serviceMatch[1], image: "", containerName: "" };
      services.push(current);
      currentIndent = 2;
      continue;
    }

    if (!current) continue;
    const indent = (line.match(/^ */) || [""])[0].length;
    if (indent <= currentIndent && line.trim() && !line.startsWith("  ")) {
      inServices = false;
      current = null;
      continue;
    }

    const imageMatch = line.match(/^\s+image:\s*["']?([^"'\s#]+)["']?/);
    if (imageMatch) current.image = imageMatch[1];
    const containerMatch = line.match(/^\s+container_name:\s*["']?([^"'\s#]+)["']?/);
    if (containerMatch) current.containerName = containerMatch[1];
  }

  return services.length ? services : parseComposeServices(filePath).map((name) => ({ name, image: "", containerName: "" }));
}

function envArrayToMap(env) {
  const result = {};
  if (!Array.isArray(env)) return result;
  for (const item of env) {
    const eq = String(item).indexOf("=");
    if (eq > 0) result[String(item).slice(0, eq)] = String(item).slice(eq + 1);
  }
  return result;
}

function dockerHostPort(ports, containerPort) {
  const entries = ports && ports[containerPort];
  if (!Array.isArray(entries) || !entries[0]) return "";
  return entries[0].HostPort || "";
}

function dockerPortFromText(text, fallbackPort) {
  const match = String(text || "").match(new RegExp(`(?:0\\.0\\.0\\.0:|127\\.0\\.0\\.1:|:::)?(\\d+)->${fallbackPort}/tcp`));
  return match ? match[1] : "";
}

function stableConnectionId(value) {
  return `auto:${hashStableText(value)}`;
}

function hashStableText(value) {
  const text = String(value || "");
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function extractDatabaseConnectionsFromText(text, filePath, root) {
  const values = parseLooseConfigValues(text);
  const urls = new Set();
  const sourceLabel = relative(root, filePath);

  for (const [key, value] of Object.entries(values)) {
    if (/(url|uri|dsn|database_url|datasource|connection|string)/i.test(key)) {
      collectDatabaseUrls(value, urls);
    }
  }
  collectDatabaseUrls(text, urls);

  const username =
    values["spring.datasource.username"] ||
    values["datasource.username"] ||
    values["db.username"] ||
    values["db.user"] ||
    values["database.user"] ||
    values["database.username"] ||
    values["user"] ||
    values["username"] ||
    values["DB_USER"] ||
    values["MYSQL_USER"] ||
    values["POSTGRES_USER"] ||
    "";
  const password =
    values["spring.datasource.password"] ||
    values["datasource.password"] ||
    values["db.password"] ||
    values["database.password"] ||
    values["password"] ||
    values["DB_PASSWORD"] ||
    values["MYSQL_PASSWORD"] ||
    values["MYSQL_ROOT_PASSWORD"] ||
    values["POSTGRES_PASSWORD"] ||
    "";

  const fromUrls = Array.from(urls)
    .map((url) => databaseConnectionFromUrl(url, { username, password, filePath, root, sourceLabel }))
    .filter(Boolean);
  const fromLooseValues = databaseConnectionFromLooseValues(values, { username, password, sourceLabel });
  if (fromLooseValues) fromUrls.push(fromLooseValues);
  return dedupeConnections(fromUrls);
}

function parseLooseConfigValues(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*[:=]\s*["']?(.+?)["']?\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

function collectDatabaseUrls(text, urls) {
  const patterns = [
    /jdbc:(mysql|postgresql):\/\/[^\s"'<>]+/gi,
    /jdbc:sqlite:[^\s"'<>]+/gi,
    /\b(mysql|postgres|postgresql|redis):\/\/[^\s"'<>]+/gi
  ];
  for (const pattern of patterns) {
    for (const match of String(text || "").matchAll(pattern)) {
      urls.add(match[0].replace(/[),;]+$/g, ""));
    }
  }
}

function databaseConnectionFromUrl(rawUrl, options) {
  let url = String(rawUrl || "").trim();
  if (!url) return null;

  if (/^jdbc:sqlite:/i.test(url)) {
    const rawPath = url.replace(/^jdbc:sqlite:/i, "").replace(/^file:/i, "");
    const dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(options.root, rawPath);
    return {
      id: stableConnectionId(`code:sqlite-url:${dbPath}`),
      name: `${path.basename(dbPath)} (코드 SQLite)`,
      type: "sqlite",
      path: dbPath,
      source: "code-auto",
      sourceLabel: options.sourceLabel
    };
  }

  url = url.replace(/^jdbc:/i, "");
  if (/^postgresql:\/\//i.test(url)) {
    url = url.replace(/^postgresql:/i, "postgres:");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  const type = protocol === "postgresql" ? "postgres" : protocol;
  if (!["mysql", "postgres", "redis"].includes(type)) return null;

  const host = parsed.hostname || "localhost";
  const port = parsed.port || defaultDbPort(type);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || (type === "postgres" ? "postgres" : "");
  const user = decodeURIComponent(parsed.username || options.username || defaultDbUser(type));
  const password = decodeURIComponent(parsed.password || options.password || "");
  const scope = `${type}:${host}:${port}:${database}`;

  return {
    id: stableConnectionId(`code:${scope}`),
    name: `${database || host} (${formatDbTypeName(type)} · 코드)`,
    type,
    host,
    port,
    database,
    user,
    password,
    source: "code-auto",
    sourceLabel: options.sourceLabel
  };
}

function databaseConnectionFromLooseValues(values, options) {
  const host = firstValue(values, [
    "spring.datasource.host", "datasource.host", "db.host", "database.host",
    "DB_HOST", "DATABASE_HOST", "MYSQL_HOST", "POSTGRES_HOST", "POSTGRESQL_HOST", "REDIS_HOST"
  ]);
  const port = firstValue(values, [
    "spring.datasource.port", "datasource.port", "db.port", "database.port",
    "DB_PORT", "DATABASE_PORT", "MYSQL_PORT", "POSTGRES_PORT", "POSTGRESQL_PORT", "REDIS_PORT"
  ]);
  const database = firstValue(values, [
    "spring.datasource.database", "datasource.database", "db.database", "database.database",
    "db.name", "database.name", "DB_NAME", "DB_DATABASE", "DATABASE_NAME", "DATABASE",
    "MYSQL_DATABASE", "POSTGRES_DB", "POSTGRES_DATABASE"
  ]);
  const type = inferDbTypeFromConfig(values, port);

  if (!host || !type) return null;

  const user = options.username || firstValue(values, [
    "spring.datasource.user", "datasource.user", "DB_USER", "DATABASE_USER",
    "MYSQL_USER", "POSTGRES_USER", "POSTGRESQL_USER", "REDIS_USER"
  ]) || defaultDbUser(type);
  const password = options.password || firstValue(values, [
    "DB_PASSWORD", "DATABASE_PASSWORD", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD",
    "POSTGRES_PASSWORD", "POSTGRESQL_PASSWORD", "REDIS_PASSWORD"
  ]);
  const effectivePort = port || defaultDbPort(type);
  const effectiveDatabase = database || (type === "postgres" ? "postgres" : "");
  const scope = `${type}:${host}:${effectivePort}:${effectiveDatabase}`;

  return {
    id: stableConnectionId(`code:${scope}`),
    name: `${effectiveDatabase || host} (${formatDbTypeName(type)} · 코드 설정)`,
    type,
    host,
    port: effectivePort,
    database: effectiveDatabase,
    user,
    password,
    source: "code-auto",
    sourceLabel: options.sourceLabel
  };
}

function firstValue(values, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(values, key) && String(values[key] ?? "").trim()) {
      return String(values[key]).trim();
    }
  }
  return "";
}

function inferDbTypeFromConfig(values, port) {
  const explicit = firstValue(values, [
    "spring.datasource.platform", "spring.datasource.type", "datasource.type",
    "db.type", "db.engine", "database.type", "database.engine", "DB_TYPE", "DB_ENGINE", "DATABASE_TYPE"
  ]).toLowerCase();
  const driver = firstValue(values, [
    "spring.datasource.driver-class-name", "datasource.driver-class-name", "driver", "DB_DRIVER", "DATABASE_DRIVER"
  ]).toLowerCase();
  const haystack = `${explicit} ${driver} ${Object.keys(values).join(" ")}`.toLowerCase();

  if (/postgres|postgresql|pg/.test(haystack) || String(port) === "5432") return "postgres";
  if (/mysql|mariadb/.test(haystack) || String(port) === "3306") return "mysql";
  if (/redis/.test(haystack) || String(port) === "6379") return "redis";
  return "";
}

function defaultDbPort(type) {
  if (type === "mysql") return "3306";
  if (type === "postgres") return "5432";
  if (type === "redis") return "6379";
  return "";
}

function formatDbTypeName(type) {
  if (type === "mysql") return "MySQL";
  if (type === "postgres") return "PostgreSQL";
  if (type === "redis") return "Redis";
  return type || "DB";
}

function dedupeConnections(connections) {
  const byId = new Map();
  for (const conn of connections) {
    if (!conn || !conn.id || byId.has(conn.id)) continue;
    byId.set(conn.id, conn);
  }
  return Array.from(byId.values());
}

function getDockerBin() {
  const candidates = [
    process.env.DOCKER,
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    "docker.exe",
    "docker"
  ].filter(Boolean);
  return candidates.find((candidate) => candidate.includes("\\") && fs.existsSync(candidate)) || candidates[candidates.length - 1];
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function relative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function matchFirst(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : "";
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseSpringControllers(root) {
  const controllers = [];
  for (const filePath of walk(root, [".java"])) {
    const text = readText(filePath);
    if (!text || !/@RestController|@Controller\b/.test(text)) continue;

    const className = matchFirst(text, /public\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!className) continue;

    const classMappingMatch = text.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
    const basePath = classMappingMatch ? classMappingMatch[1].replace(/\/$/, "") : "";

    const endpoints = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const annotMatch = line.match(/@(Get|Post|Put|Delete|Patch|Request)Mapping(?:\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["']|\s*\(\s*\)|\s*["']([^"']*)["'])?/);
      if (!annotMatch) continue;

      const verb = annotMatch[1];
      const endpointPath = (annotMatch[2] || annotMatch[3] || "").replace(/\/$/, "");
      const httpMethod = verb === "Request" ? "ANY" : verb.toUpperCase();
      const fullPath = basePath + endpointPath || "/";

      let methodName = "";
      let returnType = "";
      let params = [];

      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const m = lines[j].match(/\b(?:public|protected)\s+(\S+(?:<[^>]+>)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (m) {
          methodName = m[2];
          returnType = extractReturnType(m[1]);
          let sig = lines[j];
          for (let k = j + 1; k < Math.min(j + 8, lines.length) && !sig.includes(")"); k++) {
            sig += " " + lines[k].trim();
          }
          params = parseMethodParams(sig);
          break;
        }
      }

      endpoints.push({ httpMethod, path: fullPath, methodName, filePath, lineNumber: i + 1, returnType, params });
    }

    if (endpoints.length > 0) {
      controllers.push({ className, filePath, basePath, endpoints });
    }
  }
  return controllers;
}

function extractReturnType(raw) {
  const m = raw.match(/ResponseEntity\s*<\s*(.+?)\s*>$/);
  if (m) return m[1];
  return raw;
}

function splitGenericParams(str) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of str) {
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth--;
    else if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function extractJavaType(paramStr) {
  const clean = paramStr.replace(/@\w+(?:\([^)]*\))?\s*/g, "").trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) return parts[parts.length - 2];
  if (parts.length === 1) return parts[0];
  return "Object";
}

function parseMethodParams(sig) {
  const parenMatch = sig.match(/\(([^)]*)\)/s);
  if (!parenMatch) return [];
  const paramsStr = parenMatch[1].trim();
  if (!paramsStr) return [];

  const parts = splitGenericParams(paramsStr);
  const params = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (/HttpServletRequest|HttpServletResponse|Model\b|BindingResult/.test(trimmed)) continue;

    let kind = "";
    let name = "";
    let type = extractJavaType(trimmed);
    let required = true;

    if (/@PathVariable/.test(trimmed)) {
      kind = "path";
      const a = trimmed.match(/@PathVariable\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
      name = a ? a[1] : "";
    } else if (/@RequestBody/.test(trimmed)) {
      kind = "body";
      name = "body";
    } else if (/@RequestParam/.test(trimmed)) {
      kind = "query";
      const a = trimmed.match(/@RequestParam\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
      name = a ? a[1] : "";
      const r = trimmed.match(/required\s*=\s*(true|false)/);
      required = r ? r[1] === "true" : true;
    } else if (/@RequestHeader/.test(trimmed)) {
      kind = "header";
      const a = trimmed.match(/@RequestHeader\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
      name = a ? a[1] : "";
    } else {
      continue;
    }

    if (!name) {
      const v = trimmed.match(/(\w+)\s*$/);
      if (v) name = v[1];
    }
    if (name) params.push({ kind, name, type, required });
  }
  return params;
}

function parseDtoClasses(root) {
  const dtoMap = {};
  for (const filePath of walk(root, [".java"])) {
    const text = readText(filePath);
    if (!text) continue;
    const classMatch = text.match(/(?:public\s+)?(?:class|record)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!classMatch) continue;
    const className = classMatch[1];
    const fields = [];
    const recordMatch = text.match(/(?:public\s+)?record\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]+)\)/);
    if (recordMatch) {
      for (const part of splitGenericParams(recordMatch[1])) {
        const clean = part.trim().replace(/@\w+(?:\([^)]*\))?\s*/g, "");
        const m = clean.match(/(\S+)\s+(\w+)\s*$/);
        if (m) fields.push({ name: m[2], type: m[1] });
      }
    } else {
      const fieldRe = /(?:private|public|protected)\s+(?:final\s+)?(\S+(?:<[^>]+>)?)\s+([a-z_][A-Za-z0-9_]*)\s*[;=]/g;
      let m;
      while ((m = fieldRe.exec(text)) !== null) fields.push({ name: m[2], type: m[1] });
    }
    if (fields.length > 0) dtoMap[className] = fields;
  }
  return dtoMap;
}

function javaTypeDefaultValue(type, dtoMap, depth = 0) {
  if (!type || depth > 2) return "null";
  const t = type.replace(/<.*>/, "").trim();
  if (t === "String") return '""';
  if (["int", "long", "Integer", "Long", "short", "Short", "byte", "Byte"].includes(t)) return "0";
  if (["float", "double", "Float", "Double", "BigDecimal"].includes(t)) return "0.0";
  if (["boolean", "Boolean"].includes(t)) return "false";
  if (["List", "ArrayList"].includes(t)) return "[]";
  if (["Map", "HashMap"].includes(t)) return "{}";
  if (dtoMap && dtoMap[t]) return buildJsonTemplate(t, dtoMap, depth + 1);
  return "null";
}

function buildJsonTemplate(className, dtoMap, depth = 0) {
  const fields = dtoMap ? dtoMap[className] : null;
  if (!fields || depth > 2) return `{}`;
  const indent = "  ".repeat(depth + 1);
  const entries = fields.map((f) => `${indent}"${f.name}": ${javaTypeDefaultValue(f.type, dtoMap, depth)}`);
  const closing = "  ".repeat(depth);
  return `{\n${entries.join(",\n")}\n${closing}}`;
}

function springMethodIcon(method) {
  return { GET: "arrow-down", POST: "arrow-up", PUT: "edit", DELETE: "trash", PATCH: "diff-modified" }[method] || "symbol-method";
}

function httpRequest({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error("잘못된 URL: " + url)); }
    const lib = parsed.protocol === "https:" ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method: method.toUpperCase(),
      headers: { ...(headers || {}) }
    };
    if (body && !opts.headers["Content-Type"] && !opts.headers["content-type"]) {
      opts.headers["Content-Type"] = "application/json";
    }
    if (body) opts.headers["Content-Length"] = Buffer.byteLength(body);
    const start = Date.now();

    let settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; clearTimeout(hardTimer); fn(val); } };

    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk.toString(); });
      res.on("end", () => finish(resolve, { status: res.statusCode, statusText: res.statusMessage, headers: res.headers, body: data, time: Date.now() - start }));
    });
    req.on("error", (err) => finish(reject, err.message ? err : new Error("서버 연결 실패")));

    // Reject first, then destroy — so settled=true before destroy's error event fires
    const hardTimer = setTimeout(() => {
      finish(reject, new Error("서버에 연결할 수 없습니다 (5s 초과) — Spring Boot가 실행 중인지 확인하세요"));
      try { req.destroy(); } catch (_) {}
    }, 5000);

    if (body) req.write(body);
    req.end();
  });
}

function readSpringServerPort(root) {
  if (!root) return "8080";
  const candidates = [
    require("path").join(root, "src", "main", "resources", "application.properties"),
    require("path").join(root, "springboot-demo", "src", "main", "resources", "application.properties"),
  ];
  for (const filePath of candidates) {
    try {
      const text = require("fs").readFileSync(filePath, "utf8");
      const match = text.match(/^\s*server\.port\s*=\s*(\d+)/m);
      if (match) return match[1];
    } catch (_) {}
  }
  return "8080";
}

function openControllerTestWebview(node, context) {
  if (!node || !node.endpointData) return;
  const ep = node.endpointData;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  let dtoMap = {};
  try { if (root) dtoMap = parseDtoClasses(root); } catch (_) {}
  const serverPort = readSpringServerPort(root);

  if (controllerTestPanel) {
    if (controllerMsgDisposable) { controllerMsgDisposable.dispose(); controllerMsgDisposable = null; }
    controllerTestPanel.title = `${ep.httpMethod} ${ep.path}`;
    controllerTestPanel.webview.html = buildControllerTestHtml(ep, dtoMap, serverPort);
    controllerTestPanel.reveal(vscode.ViewColumn.Two, false);
  } else {
    const panel = vscode.window.createWebviewPanel(
      "springControllerTest",
      `${ep.httpMethod} ${ep.path}`,
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.onDidDispose(async () => {
      controllerTestPanel = null;
      if (controllerMsgDisposable) { controllerMsgDisposable.dispose(); controllerMsgDisposable = null; }
      await closeEmptyEditorGroups();
    }, null, context.subscriptions);
    panel.webview.html = buildControllerTestHtml(ep, dtoMap, serverPort);
    controllerTestPanel = panel;
  }

  const activePanel = controllerTestPanel;
  controllerMsgDisposable = activePanel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type !== "send") return;
    try {
      const result = await httpRequest(msg);
      activePanel.webview.postMessage({ type: "response", ...result });
    } catch (err) {
      activePanel.webview.postMessage({ type: "response", error: err.message, status: 0, statusText: "", headers: {}, body: "", time: 0 });
    }
  });
}

function buildControllerTestHtml(ep, dtoMap = {}, serverPort = "8080") {
  const method = ep.httpMethod === "ANY" ? "GET" : ep.httpMethod;
  const epPath = ep.path || "/";
  const methodOptions = ["GET", "POST", "PUT", "DELETE", "PATCH"]
    .map((m) => `<option${m === method ? " selected" : ""}>${m}</option>`).join("");

  const params = ep.params || [];
  const pathParams = params.filter((p) => p.kind === "path");
  const queryParams = params.filter((p) => p.kind === "query");
  const bodyParam = params.find((p) => p.kind === "body");
  const returnType = ep.returnType || "";
  const bodyFields = bodyParam ? (dtoMap[bodyParam.type] || []) : [];
  const returnFields = returnType ? (dtoMap[returnType] || []) : [];
  const isList = /^List|^ArrayList/.test(returnType);

  function inputRow(name, type, cls, optional) {
    const opt = optional ? `<span class="opt">?</span>` : "";
    return `<div class="frow"><div class="fmeta"><span class="fname">${escHtml(name)}${opt}</span><span class="ftype">${escHtml(type)}</span></div><input class="${escHtml(cls)}" data-name="${escHtml(name)}" data-type="${escHtml(type)}" placeholder="${escHtml(type)}" autocomplete="off"/></div>`;
  }
  function respRow(name, type) {
    return `<div class="frow resp-row" data-name="${escHtml(name)}"><div class="fmeta"><span class="fname">${escHtml(name)}</span><span class="ftype">${escHtml(type)}</span></div><span class="rval">—</span></div>`;
  }

  const pathBlock = pathParams.length
    ? `<div class="blk-label">PATH</div>${pathParams.map((p) => inputRow(p.name, p.type, "path-inp", false)).join("")}` : "";
  const queryBlock = queryParams.length
    ? `<div class="blk-label">QUERY</div>${queryParams.map((p) => inputRow(p.name, p.type, "query-inp", !p.required)).join("")}` : "";
  const bodyBlock = bodyParam
    ? `<div class="blk-label">BODY <em>${escHtml(bodyParam.type)}</em></div>${
        bodyFields.length
          ? bodyFields.map((f) => inputRow(f.name, f.type, "body-inp", false)).join("")
          : `<textarea id="bodyRaw" class="body-ta" placeholder='{"key": "value"}'></textarea>`
      }` : "";

  const respBlock = returnFields.length && !isList
    ? returnFields.map((f) => respRow(f.name, f.type)).join("")
    : `<pre id="resp-raw" class="resp-raw"></pre>`;

  const NR = JSON.stringify(["int","long","Integer","Long","short","Short","byte","Byte","float","double","Float","Double","BigDecimal"]);
  const BR = JSON.stringify(["boolean","Boolean"]);

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:14px;display:flex;flex-direction:column;gap:10px}
input,select,textarea{font-family:inherit;font-size:13px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:3px;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--vscode-focusBorder,#007acc)}
/* url row */
.url-row{display:flex;gap:6px}
#m-sel{padding:5px 7px;min-width:82px}
#url-inp{flex:1;padding:5px 9px}
#send-btn{padding:5px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;white-space:nowrap;font-family:inherit;font-size:13px}
#send-btn:hover{filter:brightness(1.12)}
#send-btn:disabled{opacity:.45;cursor:default}
/* status */
#status{font-size:12px;padding:5px 10px;border-radius:3px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#444);color:var(--vscode-descriptionForeground,#888)}
#status.s-sending{color:#3794ff;border-color:#3794ff}
#status.s-ok{color:#4caf50;border-color:#4caf50;background:rgba(76,175,80,.08)}
#status.s-warn{color:#ff9800;border-color:#ff9800;background:rgba(255,152,0,.08)}
#status.s-err{color:#f44336;border-color:#f44336;background:rgba(244,67,54,.08)}
/* panels */
.panel{border:1px solid var(--vscode-panel-border,#333);border-radius:4px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.panel-hdr{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;opacity:.55;display:flex;align-items:center;gap:6px}
.panel-hdr em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:400;color:var(--vscode-textLink-foreground,#b49de0);font-size:12px;opacity:1}
.blk-label{font-size:10px;text-transform:uppercase;letter-spacing:.4px;opacity:.35;margin-top:4px}
.blk-label em{font-style:normal;text-transform:none;letter-spacing:0;color:var(--vscode-textLink-foreground,#b49de0);opacity:.9}
/* field rows */
.frow{display:grid;grid-template-columns:130px 1fr;gap:8px;align-items:center}
.fmeta{display:flex;flex-direction:column;gap:1px;min-width:0}
.fname{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opt{font-size:10px;opacity:.45;margin-left:1px}
.ftype{font-size:10px;opacity:.38;font-style:italic}
.frow input{padding:4px 7px;width:100%}
.body-ta{width:100%;min-height:72px;resize:vertical;font-family:monospace;font-size:12px;padding:6px 8px}
/* response values */
.resp-row .rval{font-size:12px;color:var(--vscode-textLink-foreground,#b49de0);word-break:break-all;min-width:0}
.resp-raw{font-family:monospace;font-size:12px;padding:8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#444);border-radius:3px;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow:auto}
/* header section */
.hdr-toggle{font-size:11px;opacity:.45;background:none;border:none;cursor:pointer;color:inherit;padding:0;text-align:left}
.hdr-toggle:hover{opacity:.8}
.hdr-body{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.hrow{display:grid;grid-template-columns:1fr 1fr 22px;gap:4px}
.hrow input{padding:3px 6px;font-size:12px}
.rm-btn{background:none;border:1px solid var(--vscode-input-border,#555);color:inherit;border-radius:3px;cursor:pointer;opacity:.45;font-size:11px}
.rm-btn:hover{opacity:.85}
.add-hdr-btn{font-size:11px;background:none;border:1px dashed var(--vscode-input-border,#555);color:inherit;border-radius:3px;cursor:pointer;padding:2px 8px;opacity:.45;margin-top:2px;font-family:inherit}
.add-hdr-btn:hover{opacity:.85}
</style></head>
<body>

<div class="url-row">
  <select id="m-sel">${methodOptions}</select>
  <input id="url-inp" value="http://localhost:${serverPort}${epPath}" autocomplete="off"/>
  <button id="send-btn">전송</button>
</div>

<div id="status">전송 대기</div>

<div class="panel">
  <div class="panel-hdr">📥 요청${bodyParam ? `<em>${escHtml(bodyParam.type)}</em>` : ""}</div>
  ${pathBlock}${queryBlock}${bodyBlock}
  <div>
    <button class="hdr-toggle" id="hdr-toggle">▸ 헤더 추가</button>
    <div id="hdr-body" class="hdr-body" style="display:none">
      <div id="hdr-list"></div>
      <button class="add-hdr-btn" id="add-hdr">+ 추가</button>
    </div>
  </div>
</div>

<div class="panel">
  <div class="panel-hdr">📤 응답${returnType ? `<em>${escHtml(isList ? returnType : (returnType || ""))}</em>` : ""}</div>
  ${respBlock}
</div>

<script>
(function(){
var vscode = acquireVsCodeApi();
var NR = ${NR};
var BR = ${BR};

function setStatus(cls, txt) {
  var el = document.getElementById('status');
  el.className = cls ? 'status ' + cls : '';
  el.textContent = txt;
}

/* send */
document.getElementById('send-btn').addEventListener('click', function() {
  try {
    var method = document.getElementById('m-sel').value;
    var url = document.getElementById('url-inp').value.trim();

    document.querySelectorAll('.path-inp').forEach(function(inp) {
      var v = inp.value.trim() || ('{'+inp.dataset.name+'}');
      url = url.replace('{'+inp.dataset.name+'}', encodeURIComponent(v));
    });

    var qp = [];
    document.querySelectorAll('.query-inp').forEach(function(inp) {
      if (inp.value.trim()) qp.push(encodeURIComponent(inp.dataset.name)+'='+encodeURIComponent(inp.value.trim()));
    });
    if (qp.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + qp.join('&');

    var body = '';
    var rawTA = document.getElementById('bodyRaw');
    if (rawTA) {
      body = rawTA.value.trim();
    } else {
      var obj = {};
      document.querySelectorAll('.body-inp').forEach(function(inp) {
        var val = inp.value.trim(); if (!val) return;
        var t = inp.dataset.type;
        if (NR.indexOf(t) >= 0) { var n=Number(val); obj[inp.dataset.name]=isNaN(n)?val:n; }
        else if (BR.indexOf(t) >= 0) { obj[inp.dataset.name]=(val==='true'||val==='1'); }
        else { obj[inp.dataset.name]=val; }
      });
      if (Object.keys(obj).length) body = JSON.stringify(obj);
    }

    var hdrs = {};
    document.querySelectorAll('.hrow').forEach(function(r) {
      var k=r.querySelector('.hk').value.trim(), v=r.querySelector('.hv').value.trim();
      if (k) hdrs[k]=v;
    });
    if (body && !hdrs['Content-Type'] && !hdrs['content-type']) hdrs['Content-Type']='application/json';

    setStatus('s-sending', '전송 중…');
    document.getElementById('send-btn').disabled = true;
    vscode.postMessage({type:'send', method:method, url:url, headers:hdrs, body:body});
  } catch(e) {
    setStatus('s-err', '오류: '+e.message);
    document.getElementById('send-btn').disabled = false;
  }
});

/* headers toggle */
document.getElementById('hdr-toggle').addEventListener('click', function() {
  var bd = document.getElementById('hdr-body');
  var show = bd.style.display === 'none';
  bd.style.display = show ? '' : 'none';
  this.textContent = show ? '▾ 헤더 숨기기' : '▸ 헤더 추가';
});
document.getElementById('add-hdr').addEventListener('click', function() {
  var r = document.createElement('div'); r.className = 'hrow';
  r.innerHTML = '<input class="hk" placeholder="키"/><input class="hv" placeholder="값"/><button class="rm-btn">✕</button>';
  document.getElementById('hdr-list').appendChild(r);
});
document.getElementById('hdr-list').addEventListener('click', function(e) {
  if (e.target.classList.contains('rm-btn')) e.target.closest('.hrow').remove();
});

/* response */
window.addEventListener('message', function(ev) {
  var m = ev.data;
  if (!m || m.type !== 'response') return;

  document.getElementById('send-btn').disabled = false;

  if (m.error || !m.status) {
    setStatus('s-err', m.error ? '전송 실패: '+m.error : '서버 연결 실패 (응답 없음)');
    clearResp();
    return;
  }

  var ok = m.status >= 200 && m.status < 300;
  setStatus(ok ? 's-ok' : 's-warn', m.status+' '+(m.statusText||'')+'  ·  '+m.time+'ms');

  var parsed = null;
  try { parsed = JSON.parse(m.body); } catch(e) {}

  var frows = document.querySelectorAll('.resp-row');
  var rawEl = document.getElementById('resp-raw');

  if (frows.length && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    frows.forEach(function(row) {
      var v = parsed[row.dataset.name];
      row.querySelector('.rval').textContent = (v !== undefined && v !== null) ? String(v) : '—';
    });
    if (rawEl) rawEl.style.display = 'none';
  } else {
    if (rawEl) {
      rawEl.textContent = parsed !== null ? JSON.stringify(parsed, null, 2) : (m.body || '');
      rawEl.style.display = '';
    }
    frows.forEach(function(r) { r.querySelector('.rval').textContent = '—'; });
  }
});

function clearResp() {
  document.querySelectorAll('.resp-row .rval').forEach(function(el){ el.textContent='—'; });
  var rawEl = document.getElementById('resp-raw');
  if (rawEl) { rawEl.textContent=''; rawEl.style.display='none'; }
}
})();
</script>
</body></html>`;
}

function execFileText(command, args, options = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024,
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        const message = [error.message, stderr].filter(Boolean).join("\n");
        reject(new Error(message));
        return;
      }
      resolve(`${stdout || ""}${stderr || ""}`);
    });
  });
}

module.exports = {
  activate,
  deactivate
};
