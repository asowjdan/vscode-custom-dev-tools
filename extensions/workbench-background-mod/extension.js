const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATE_KEY = "customWorkbenchBackgroundMod.settings";
const DEFAULT_SETTINGS = {
  imagePath: "",
  posX: 50,
  posY: 50,
  bgSize: "cover"
};

// 허용 파일 형식 목록: mime, magic bytes(첫 바이트 시퀀스), 크기 상한
const ALLOWED_FORMATS = {
  ".png":  { mime: "image/png",  maxMb: 10, magic: [[0x89,0x50,0x4E,0x47]] },
  ".jpg":  { mime: "image/jpeg", maxMb: 10, magic: [[0xFF,0xD8,0xFF]] },
  ".jpeg": { mime: "image/jpeg", maxMb: 10, magic: [[0xFF,0xD8,0xFF]] },
  ".webp": { mime: "image/webp", maxMb: 10, magic: [[0x52,0x49,0x46,0x46]] },  // RIFF....WEBP
  ".gif":  { mime: "image/gif",  maxMb: 3,  magic: [[0x47,0x49,0x46,0x38,0x37,0x61],   // GIF87a
                                                      [0x47,0x49,0x46,0x38,0x39,0x61]] }, // GIF89a
  ".bmp":  { mime: "image/bmp",  maxMb: 5,  magic: [[0x42,0x4D]] },
};

const WB_BG_TAG_START = "<!-- CUSTOM-WORKBENCH-BG-MOD-START -->";
const WB_BG_TAG_END = "<!-- CUSTOM-WORKBENCH-BG-MOD-END -->";
const LEGACY_BG_TAG_START = "<!-- CUSTOM-DEV-TOOLS-BG-START -->";
const LEGACY_BG_TAG_END = "<!-- CUSTOM-DEV-TOOLS-BG-END -->";

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "customWorkbenchBackgroundMod.settings",
      new BackgroundSettingsProvider(context)
    )
  );
  reconcileInstalledBackground(context).catch((error) => {
    console.warn("Custom Workbench Background Mod reconcile failed:", error && error.message ? error.message : error);
  });
}

function deactivate() {}

class BackgroundSettingsProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const settings = getSettings(this.context);
    this.setLocalRoots(webviewView, settings.imagePath);
    const toPreviewUri = (fsPath) => {
      if (!fsPath) return "";
      try {
        return webviewView.webview.asWebviewUri(vscode.Uri.file(fsPath)).toString();
      } catch {
        return "";
      }
    };

    const postStatus = (message, tone = "info") => {
      webviewView.webview.postMessage({ type: "operationDone", message, tone });
    };

    const postSettings = (next) => {
      webviewView.webview.postMessage({
        type: "settings",
        imagePath: next.imagePath || "",
        posX: normPos(next.posX, 50),
        posY: normPos(next.posY, 50),
        bgSize: normBgSize(next.bgSize),
        previewUri: toPreviewUri(next.imagePath)
      });
    };

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "pickImage") {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { "이미지 (PNG·JPG·WebP·GIF·BMP)": ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }
        });
        if (uris && uris[0]) {
          const fsPath = uris[0].fsPath;
          this.setLocalRoots(webviewView, fsPath);
          webviewView.webview.postMessage({
            type: "imagePicked",
            path: fsPath,
            filename: path.basename(fsPath),
            previewUri: toPreviewUri(fsPath)
          });
        }
        return;
      }

      if (msg.type === "applyBackground") {
        try {
          const next = {
            imagePath: msg.imagePath || "",
            posX: normPos(msg.posX, 50),
            posY: normPos(msg.posY, 50),
            bgSize: normBgSize(msg.bgSize)
          };
          await saveSettings(this.context, next);
          const patched = await patchWorkbenchBackground(next);
          postSettings(next);
          if (patched) {
            const message = next.imagePath
              ? "배경 이미지를 적용했습니다. VS Code를 다시 로드하세요."
              : "배경 이미지를 제거했습니다. VS Code를 다시 로드하세요.";
            postStatus(message, "success");
            vscode.window.showInformationMessage(message, "지금 다시 로드").then((selected) => {
              if (selected === "지금 다시 로드") vscode.commands.executeCommand("workbench.action.reloadWindow");
            });
          } else {
            postStatus("배경 이미지 설정은 이미 적용된 상태입니다.", "success");
          }
        } catch (error) {
          const message = "배경 이미지 적용 실패: " + error.message;
          postStatus(message, "error");
          vscode.window.showErrorMessage(message);
        }
        return;
      }

      if (msg.type === "clearImage" || msg.type === "resetBackground") {
        try {
          const next = { ...DEFAULT_SETTINGS };
          await saveSettings(this.context, next);
          const patched = await patchWorkbenchBackground(next);
          webviewView.webview.postMessage({ type: "imagePicked", path: "", filename: "", previewUri: "" });
          postSettings(next);
          if (patched) {
            const message = "배경 이미지를 제거했습니다. VS Code를 다시 로드하세요.";
            postStatus(message, "success");
            vscode.window.showInformationMessage(message, "지금 다시 로드").then((selected) => {
              if (selected === "지금 다시 로드") vscode.commands.executeCommand("workbench.action.reloadWindow");
            });
          } else {
            postStatus("배경 이미지 설정을 비웠습니다.", "success");
          }
        } catch (error) {
          const message = "배경 이미지 제거 실패: " + error.message;
          postStatus(message, "error");
          vscode.window.showErrorMessage(message);
        }
      }
    });

    webviewView.webview.html = this.buildHtml(settings, webviewView.webview);
  }

  setLocalRoots(webviewView, fsPath) {
    if (!fsPath) {
      webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
      return;
    }
    try {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.dirname(fsPath))]
      };
    } catch {
      webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    }
  }

  buildHtml({ imagePath, posX, posY, bgSize }, webview) {
    const safeImagePath = imagePath || "";
    const safePosX = normPos(posX, 50);
    const safePosY = normPos(posY, 50);
    const safeBgSize = normBgSize(bgSize);
    const filename = safeImagePath ? path.basename(safeImagePath) : "";
    let previewUri = "";
    if (safeImagePath && webview) {
      try {
        previewUri = webview.asWebviewUri(vscode.Uri.file(safeImagePath)).toString();
      } catch {}
    }
    const cspSource = webview ? webview.cspSource : "";
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${cspSource} data:;`;

    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:12px;margin:0}
h3{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-descriptionForeground);margin:14px 0 7px}
h3:first-child{margin-top:0}
.row{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.filename-box{flex:1;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#444);color:var(--vscode-input-foreground);padding:4px 8px;border-radius:3px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.filename-box.empty{color:var(--vscode-descriptionForeground)}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;white-space:nowrap}
button:hover{background:var(--vscode-button-hoverBackground)}
button.sec{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc)}
button.sec:hover{background:var(--vscode-button-secondaryHoverBackground,#45494e)}
button.ico{padding:4px 7px;min-width:26px}
.slider-row{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.slider-label{font-size:11px;color:var(--vscode-descriptionForeground);width:30px;flex-shrink:0}
.slider-val{font-size:11px;color:var(--vscode-descriptionForeground);width:30px;text-align:right;flex-shrink:0}
input[type=range]{flex:1;accent-color:var(--vscode-button-background)}
.size-row{display:flex;gap:4px;margin-bottom:6px}
.size-btn{flex:1;padding:3px 0;font-size:11px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-input-border,#444);background:var(--vscode-input-background);color:var(--vscode-input-foreground)}
.size-btn.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}
.preview{width:100%;height:110px;border-radius:4px;margin:6px 0;border:1px solid var(--vscode-input-border,#444);position:relative;overflow:hidden;background-color:#0a0811}
.preview-dark{position:absolute;inset:0;background:rgba(10,8,17,0.62)}
.actions{display:flex;gap:6px;margin-top:10px}.actions button{flex:1}
.note{font-size:11px;line-height:1.45;color:var(--vscode-descriptionForeground);margin-top:8px}
.status{display:none;margin-top:8px;padding:7px;border-radius:4px;font-size:11px;line-height:1.5;border:1px solid var(--vscode-panel-border,#333)}
.status.show{display:block}.status.success{background:rgba(38,105,54,.22);border-color:rgba(84,180,101,.55)}.status.error{background:rgba(145,36,36,.22);border-color:rgba(220,90,90,.65)}.status.info{background:rgba(88,76,122,.22);border-color:rgba(150,130,210,.55)}
</style>
</head><body>
<h3>배경 이미지</h3>
<div class="row">
  <div class="filename-box${filename ? "" : " empty"}" id="img-name">${escapeHtml(filename || "이미지를 선택하지 않음")}</div>
  <button id="pick-btn">찾아보기</button>
  <button class="sec ico" id="clear-img-btn" title="이미지 제거">X</button>
</div>
<div class="size-row">
  <button class="size-btn${safeBgSize === "cover" ? " active" : ""}" id="sz-cover">채우기</button>
  <button class="size-btn${safeBgSize === "contain" ? " active" : ""}" id="sz-contain">화면 맞춤</button>
  <button class="size-btn${safeBgSize === "auto" ? " active" : ""}" id="sz-auto">원본 크기</button>
</div>
<div id="pos-sliders" style="${safeBgSize === "auto" ? "display:none" : ""}">
  <div class="slider-row"><span class="slider-label">수평</span><input type="range" id="pos-x" min="0" max="100" value="${safePosX}"/><span class="slider-val" id="pos-x-val">${safePosX}%</span></div>
  <div class="slider-row"><span class="slider-label">수직</span><input type="range" id="pos-y" min="0" max="100" value="${safePosY}"/><span class="slider-val" id="pos-y-val">${safePosY}%</span></div>
</div>
<h3>미리보기</h3>
<div class="preview" id="preview"><div class="preview-dark"></div></div>
<div class="actions"><button id="apply-btn">배경 적용</button><button class="sec" id="reset-btn">배경 제거</button></div>
<div class="note">이 로컬 모드는 VS Code workbench 파일에 관리 CSS 블록을 삽입합니다. 적용 후 다시 로드해야 전체 화면에 반영됩니다.</div>
<div id="status" class="status"></div>
<script>
const vscode = acquireVsCodeApi();
let imagePath = ${JSON.stringify(safeImagePath)};
let previewUri = ${JSON.stringify(previewUri)};
let bgSize = ${JSON.stringify(safeBgSize)};
function status(msg,tone){const el=document.getElementById('status');el.textContent=msg||'';el.className='status show '+(tone||'info');}
function getPosX(){return parseInt(document.getElementById('pos-x').value,10)||0;}
function getPosY(){return parseInt(document.getElementById('pos-y').value,10)||0;}
function updatePreview(){const p=document.getElementById('preview');p.style.backgroundImage=previewUri?"url('"+previewUri+"')":'none';p.style.backgroundSize=bgSize;p.style.backgroundPosition=bgSize==='auto'?'center center':getPosX()+'% '+getPosY()+'%';p.style.backgroundRepeat='no-repeat';}
function setImage(path,filename,uri){imagePath=path||'';previewUri=uri||'';const el=document.getElementById('img-name');const fname=filename||(path?path.replace(/.*[\\\\/]/,''):'');if(fname){el.textContent=fname;el.className='filename-box';}else{el.textContent='이미지를 선택하지 않음';el.className='filename-box empty';}updatePreview();}
function setPos(px,py){document.getElementById('pos-x').value=px;document.getElementById('pos-y').value=py;document.getElementById('pos-x-val').textContent=px+'%';document.getElementById('pos-y-val').textContent=py+'%';updatePreview();}
function setBgSize(sz){bgSize=sz;['cover','contain','auto'].forEach(s=>{const b=document.getElementById('sz-'+s);if(b)b.className='size-btn'+(s===sz?' active':'');});document.getElementById('pos-sliders').style.display=sz==='auto'?'none':'';updatePreview();}
document.getElementById('pos-x').addEventListener('input',function(){document.getElementById('pos-x-val').textContent=this.value+'%';updatePreview();});
document.getElementById('pos-y').addEventListener('input',function(){document.getElementById('pos-y-val').textContent=this.value+'%';updatePreview();});
['cover','contain','auto'].forEach(s=>document.getElementById('sz-'+s).addEventListener('click',()=>setBgSize(s)));
document.getElementById('pick-btn').addEventListener('click',()=>vscode.postMessage({type:'pickImage'}));
document.getElementById('clear-img-btn').addEventListener('click',()=>{setImage('','','');vscode.postMessage({type:'clearImage'});});
document.getElementById('apply-btn').addEventListener('click',()=>{status('배경 적용 중입니다.','info');vscode.postMessage({type:'applyBackground',imagePath,posX:getPosX(),posY:getPosY(),bgSize});});
document.getElementById('reset-btn').addEventListener('click',()=>{status('배경 제거 중입니다.','info');vscode.postMessage({type:'resetBackground'});});
window.addEventListener('message',function(ev){const d=ev.data;if(d.type==='imagePicked'){setImage(d.path,d.filename,d.previewUri);}else if(d.type==='settings'){setImage(d.imagePath,d.imagePath?d.imagePath.replace(/.*[\\\\/]/,''):'',d.previewUri||'');if(d.posX!=null)setPos(d.posX,d.posY);if(d.bgSize)setBgSize(d.bgSize);}else if(d.type==='operationDone'){status(d.message,d.tone);}});
updatePreview();
</script>
</body></html>`;
  }
}

function getSettings(context) {
  const saved = context.globalState.get(STATE_KEY, DEFAULT_SETTINGS);
  return {
    imagePath: typeof saved.imagePath === "string" ? saved.imagePath : "",
    posX: normPos(saved.posX, 50),
    posY: normPos(saved.posY, 50),
    bgSize: normBgSize(saved.bgSize)
  };
}

function saveSettings(context, settings) {
  return context.globalState.update(STATE_KEY, {
    imagePath: typeof settings.imagePath === "string" ? settings.imagePath : "",
    posX: normPos(settings.posX, 50),
    posY: normPos(settings.posY, 50),
    bgSize: normBgSize(settings.bgSize)
  });
}

async function reconcileInstalledBackground(context) {
  const settings = getSettings(context);
  if (!settings.imagePath) {
    return;
  }
  const patched = await patchWorkbenchBackground(settings);
  if (patched) {
    const message = "배경 모드 CSS를 현재 설정과 동기화했습니다. VS Code를 다시 로드하면 반영됩니다.";
    vscode.window.showInformationMessage(message, "지금 다시 로드").then((selected) => {
      if (selected === "지금 다시 로드") vscode.commands.executeCommand("workbench.action.reloadWindow");
    });
  }
}

async function patchWorkbenchBackground(settings) {
  const htmlPath = getWorkbenchHtmlPath();
  const originalHtml = fs.readFileSync(htmlPath, "utf8");
  let html = removeManagedBlock(originalHtml, WB_BG_TAG_START, WB_BG_TAG_END);
  html = removeManagedBlock(html, LEGACY_BG_TAG_START, LEGACY_BG_TAG_END);

  if (settings.imagePath) {
    // 형식·magic bytes·크기 검증 (문제 시 Error throw → 호출부에서 사용자에게 표시)
    validateImageFile(settings.imagePath);
    // VS Code's workbench CSP allows data: images but blocks file: images.
    const imageUri = imageFileToDataUri(settings.imagePath);
    const size = normBgSize(settings.bgSize);
    const bgPos = size === "auto" ? "center center" : `${normPos(settings.posX, 50)}% ${normPos(settings.posY, 50)}%`;

    // Compute semi-transparent zone backgrounds from the current color settings.
    // Solid zone colors (set by the theme extension) would block the image, so we
    // read the configured hex and re-encode with an alpha component at patch time.
    // (After changing colors, re-apply the background to pick up the new values.)
    const colorCfg = vscode.workspace.getConfiguration("workbench").get("colorCustomizations") || {};
    function solidHexToRgba(hex, alpha) {
      const h = (hex || "").replace(/^#/, "").slice(0, 6);
      if (!/^[0-9a-f]{6}$/i.test(h)) return null;
      return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`;
    }
    const editorBg  = solidHexToRgba(colorCfg["editor.background"],  0.48) || "rgba(10,8,17,0.48)";
    const sidebarBg = solidHexToRgba(colorCfg["sideBar.background"],  0.72) || "rgba(14,12,22,0.72)";
    const panelBg   = solidHexToRgba(colorCfg["panel.background"],   0.78) || "rgba(10,8,17,0.78)";

    const patch = [
      `\n${WB_BG_TAG_START}`,
      "<style>",
      "html{background:var(--vscode-editor-background,#0a0811)}",
      "body{background:transparent}",
      `body::before{content:'';position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:var(--vscode-editor-background,#0a0811);background-image:url("${imageUri}");background-size:${size};background-position:${bgPos};background-repeat:no-repeat;background-attachment:fixed;z-index:0;pointer-events:none}`,
      "body>.monaco-workbench{background:transparent!important}",
      ".monaco-workbench .part.editor,.monaco-workbench .part.editor>.content{background:transparent!important}",
      ".monaco-workbench .part.editor>.content .editor-group-container,.monaco-workbench .part.editor>.content .editor-group-container>.editor-group{background:transparent!important}",
      // var(--cust-*-alpha) is kept live by buildBgAlphaScript(); fallback = value at patch time
      `.monaco-workbench .part.editor .editor-container,.monaco-workbench .part.editor .editor-instance,.monaco-workbench .part.editor .monaco-editor{background:var(--cust-editor-alpha,${editorBg})!important}`,
      ".monaco-workbench .monaco-editor>.overflow-guard,.monaco-workbench .monaco-editor .monaco-scrollable-element,.monaco-workbench .monaco-editor-background,.monaco-workbench .monaco-editor .margin,.monaco-workbench .monaco-editor .lines-content,.monaco-workbench .monaco-editor .view-lines{background:transparent!important}",
      `.monaco-workbench .part.sidebar,.monaco-workbench .part.auxiliarybar{background:var(--cust-sidebar-alpha,${sidebarBg})!important}`,
      `.monaco-workbench .part.panel{background:var(--cust-panel-alpha,${panelBg})!important}`,
      ".monaco-workbench .part.titlebar{background:var(--vscode-titleBar-activeBackground)!important}",
      ".monaco-workbench .part.activitybar{background:var(--vscode-activityBar-background)!important}",
      ".monaco-workbench .part.statusbar{background:var(--vscode-statusBar-background)!important}",
      ".monaco-workbench .part.banner{background:var(--vscode-editor-background,#0a0811)!important}",
      ".monaco-workbench .tabs-and-actions-container,.monaco-workbench .title.tabs,.monaco-workbench .editor-group-container>.title{background:var(--vscode-editorGroupHeader-tabsBackground)!important}",
      ".monaco-workbench .notifications-center,.monaco-workbench .notifications-toasts .notification-toast,.monaco-workbench .notifications-center .notifications-list-container,.monaco-workbench .notification-list-item{background:var(--vscode-notifications-background)!important}",
      // Sidebar / aux-bar inner containers: clear solid fills so the semi-transparent outer layer shows through
      ".monaco-workbench .part.sidebar .composite.viewlet,.monaco-workbench .part.sidebar .composite.viewlet>.content,.monaco-workbench .part.sidebar .pane-body,.monaco-workbench .part.sidebar .monaco-list,.monaco-workbench .part.sidebar .monaco-list-rows,.monaco-workbench .part.auxiliarybar .composite.viewlet,.monaco-workbench .part.auxiliarybar .composite.viewlet>.content,.monaco-workbench .part.auxiliarybar .pane-body,.monaco-workbench .part.auxiliarybar .monaco-list,.monaco-workbench .part.auxiliarybar .monaco-list-rows{background:transparent!important}",
      // Section headers: dark overlay so they read slightly deeper than empty sidebar space
      ".monaco-workbench .part.sidebar .pane-header,.monaco-workbench .part.auxiliarybar .pane-header{background:rgba(0,0,0,0.22)!important}",
      // Each row: darker tint so content rows are clearly deeper/darker than the empty sidebar gap
      ".monaco-workbench .part.sidebar .monaco-list-row,.monaco-workbench .part.auxiliarybar .monaco-list-row{background:rgba(0,0,0,0.18)!important}",
      // Preserve VS Code's own hover / selection highlights (higher specificity wins over the row base)
      ".monaco-workbench .part.sidebar .monaco-list-row.selected,.monaco-workbench .part.sidebar .monaco-list-row.focused,.monaco-workbench .part.auxiliarybar .monaco-list-row.selected,.monaco-workbench .part.auxiliarybar .monaco-list-row.focused{background:var(--vscode-list-activeSelectionBackground)!important}",
      ".monaco-workbench .part.sidebar .monaco-list:hover .monaco-list-row:hover,.monaco-workbench .part.auxiliarybar .monaco-list:hover .monaco-list-row:hover{background:var(--vscode-list-hoverBackground)!important}",
      "</style>",
      ...buildBgAlphaScript(),
      ...buildNotificationSyncScript(),
      WB_BG_TAG_END
    ].join("\n");
    html = html.replace("</head>", patch + "\n</head>");
  }

  if (html === originalHtml) return false;
  fs.writeFileSync(htmlPath, html, "utf8");
  updateWorkbenchChecksum(htmlPath);
  return true;
}

function buildBgAlphaScript() {
  // ── Three root-cause bugs fixed in this version ──────────────────────────
  // Bug 1 (critical): Script is injected into <head> and runs BEFORE <body>
  //   is parsed. At that point document.body is null. The previous version
  //   called upd() immediately and tried to observe document.body — both
  //   silently failed. The body MutationObserver was NEVER registered, so
  //   VS Code's CSS-variable updates on body went undetected forever.
  //   Fix: defer all setup to DOMContentLoaded (body exists by then).
  //
  // Bug 2: getComputedStyle was called on document.body which may not have
  //   the --vscode-* vars if VS Code scopes them to .monaco-workbench or
  //   sets them only on documentElement. getVar() now tries each candidate
  //   in priority order and returns the first non-empty value.
  //
  // Bug 3: head MutationObserver was missing characterData:true, so VS Code
  //   updating an existing <style> tag's text content was never detected.
  // ──────────────────────────────────────────────────────────────────────────
  return [
    "<script>",
    "(()=>{",
    "if(window.__customBgAlphaSync)return;",
    "window.__customBgAlphaSync=true;",
    "function h2rgba(hex,a){const h=(hex||'').replace(/^#/,'').trim().slice(0,6);if(!/^[0-9a-f]{6}$/i.test(h))return null;return 'rgba('+parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16)+','+a+')';}",
    // Try .monaco-workbench first (VS Code may scope its CSS vars there),
    // then body (inline style), then documentElement (:root / inline style).
    "function getVar(n){const els=[document.querySelector('.monaco-workbench'),document.body,document.documentElement];for(const el of els){if(!el)continue;const v=getComputedStyle(el).getPropertyValue(n).trim();if(v)return v;}return '';}",
    // _lv: last known CSS-var triplet. Guard skips setProperty() when nothing
    // changed (prevents the MutationObserver from triggering itself in a loop).
    // Empty-guard: if all three vars are empty VS Code hasn't initialised yet —
    // don't cache that state so the next tick still detects the real values.
    "let _lv='';",
    "function upd(){const ev=getVar('--vscode-editor-background');const sv=getVar('--vscode-sideBar-background');const pv=getVar('--vscode-panel-background');if(!ev&&!sv&&!pv)return;const key=ev+'|'+sv+'|'+pv;if(key===_lv)return;_lv=key;const e=h2rgba(ev,0.48);const sb=h2rgba(sv,0.72);const p=h2rgba(pv,0.78);if(e)document.documentElement.style.setProperty('--cust-editor-alpha',e);if(sb)document.documentElement.style.setProperty('--cust-sidebar-alpha',sb);if(p)document.documentElement.style.setProperty('--cust-panel-alpha',p);}",
    // init() is called after DOMContentLoaded so body is guaranteed to exist.
    "function init(){upd();const obs=new MutationObserver(upd);obs.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});try{if(document.body)obs.observe(document.body,{attributes:true,attributeFilter:['style','class']});}catch(_){}try{new MutationObserver(upd).observe(document.head,{childList:true,subtree:true,characterData:true});}catch(_){}setInterval(upd,8000);}",
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init,{once:true});}else{init();}",
    "})();",
    "</script>"
  ];
}

function buildNotificationSyncScript() {
  return [
    "<script>",
    "(()=>{",
    "if(window.__customDevToolsNotificationSync)return;",
    "window.__customDevToolsNotificationSync=true;",
    "const PORTS=[17891,17892,17893,17894,17895];",
    "let activePort=0,lastSnapshot='',syncTimer=0,_syncing=false;",
    "const clean=(value)=>String(value||'').replace(/\\s+/g,' ').trim();",
    "function hash(value){const text=clean(value);let h=5381;for(let i=0;i<text.length;i++){h=((h<<5)+h)^text.charCodeAt(i);}return (h>>>0).toString(36);}",
    "function optionalText(root,selectors){for(const selector of selectors){const node=root.querySelector(selector);const text=clean(node&&node.textContent);if(text)return text;}return '';}",
    "function typeFrom(root){const cls=String(root.className||'').toLowerCase();if(cls.includes('error')||root.querySelector('.codicon-error,.codicon-error-small'))return 'error';if(cls.includes('warning')||cls.includes('warn')||root.querySelector('.codicon-warning,.codicon-warning-small'))return 'warn';return 'info';}",
    "function isCenterOpen(){const el=document.querySelector('.notifications-center');if(!el)return false;return el.offsetWidth>0&&el.offsetHeight>0;}",
    "function notificationRoots(){return Array.from(document.querySelectorAll('.notifications-center .notification-list-item,.notifications-toasts .notification-toast,.notification-toast')).filter(Boolean);}",
    "function collectEntries(){const seen=new Set();const entries=[];for(const root of notificationRoots()){const message=optionalText(root,['.notification-list-item-message','.notification-toast-message','.message','.notification-message'])||clean(root.getAttribute('aria-label'))||clean(root.textContent);if(!message)continue;const source=optionalText(root,['.notification-list-item-source','.notification-source','.source']);const type=typeFrom(root);const key='dom:'+hash(message);if(seen.has(key))continue;seen.add(key);const actions=Array.from(root.querySelectorAll('.notification-list-item-buttons button,.notification-list-item-buttons a,button.monaco-button,a.monaco-button')).map((node,index)=>{const label=clean(node.textContent||node.getAttribute('aria-label')||node.getAttribute('title'));return label?{id:key+':action:'+index+':'+hash(label),label}:null;}).filter(Boolean);entries.push({key,type,message,original:message,source,actions,root});}return entries;}",
    "function collect(){return collectEntries().map(({root,...payload})=>payload);}",
    "async function post(path,payload){const ports=activePort?[activePort,...PORTS.filter((port)=>port!==activePort)]:PORTS;for(const port of ports){try{const response=await fetch('http://127.0.0.1:'+port+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(response.ok){activePort=port;return true;}}catch{}}return false;}",
    "async function sync(){if(_syncing)return;const notifications=collect();const co=isCenterOpen();const snapshot=JSON.stringify({n:notifications,c:co});if(snapshot===lastSnapshot)return;_syncing=true;const ok=await post('/notifications-sync',{notifications,centerOpen:co});_syncing=false;if(ok)lastSnapshot=snapshot;}",
    "function schedule(){clearTimeout(syncTimer);syncTimer=setTimeout(sync,250);}",
    "function dismissByKey(key){const entry=collectEntries().find((item)=>item.key===key);if(!entry)return;const close=entry.root.querySelector('[aria-label*=\"Close\"],[title*=\"Close\"],[aria-label*=\"닫\"],[title*=\"닫\"],.codicon-close');if(close&&typeof close.click==='function')close.click();}",
    "async function pollActions(){const ports=activePort?[activePort,...PORTS.filter((port)=>port!==activePort)]:PORTS;for(const port of ports){try{const response=await fetch('http://127.0.0.1:'+port+'/actions');if(!response.ok)continue;activePort=port;const payload=await response.json();for(const action of payload.actions||[]){if(action&&action.type==='dismissNotification')dismissByKey(action.key);}break;}catch{}}setTimeout(pollActions,2500);}",
    // Observe only the notification containers (childList+subtree — no characterData or
    // attributes). VS Code's editor emits thousands of attribute/characterData mutations
    // per second (cursor moves, typing, hover, intellisense). Watching all of them with
    // schedule() caused constant clearTimeout/setTimeout churn and V8 GC pressure.
    // Narrowing to the notification area + removing unnecessary mutation types drops the
    // observer fire rate from thousands/s to near-zero when no notifications change.
    "function getObsTarget(){return document.querySelector('.notifications-toasts,.notifications-center,.notification-toast-container')||document.body||document.documentElement;}",
    "function init(){sync();new MutationObserver(schedule).observe(getObsTarget(),{childList:true,subtree:true});setInterval(sync,4000);pollActions();}",
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init,{once:true});}else{init();}",
    "})();",
    "</script>"
  ];
}

function removeManagedBlock(html, startTag, endTag) {
  const start = html.indexOf(startTag);
  const end = html.indexOf(endTag);
  if (start === -1 || end === -1 || end < start) return html;
  const lineStart = html.lastIndexOf("\n", start);
  let blockEnd = end + endTag.length;
  if (html[blockEnd] === "\n") blockEnd += 1;
  return html.substring(0, lineStart > 0 ? lineStart : start) + html.substring(blockEnd);
}

function getWorkbenchHtmlPath() {
  return path.join(vscode.env.appRoot, "out", "vs", "code", "electron-browser", "workbench", "workbench.html");
}

function updateWorkbenchChecksum(htmlPath) {
  try {
    const productPath = path.join(vscode.env.appRoot, "product.json");
    const hash = sha256Base64NoPadding(htmlPath);
    const raw = fs.readFileSync(productPath, "utf8");
    const updated = raw.replace(
      /"vs\/code\/electron-browser\/workbench\/workbench\.html"\s*:\s*"[^"]*"/,
      `"vs/code/electron-browser/workbench/workbench.html": "${hash}"`
    );
    if (updated !== raw) {
      fs.writeFileSync(productPath, updated, "utf8");
    }
  } catch {}
}

function sha256Base64NoPadding(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("base64").replace(/=+$/, "");
}

function mimeFromPath(filePath) {
  return (ALLOWED_FORMATS[path.extname(filePath).toLowerCase()] || {}).mime || "image/png";
}

// 파일 형식·magic bytes·크기를 통합 검증. 문제 시 Error를 throw.
function validateImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const fmt = ALLOWED_FORMATS[ext];
  if (!fmt) {
    const allowed = Object.keys(ALLOWED_FORMATS).map(e => e.slice(1).toUpperCase()).join(", ");
    throw new Error(`지원하지 않는 파일 형식입니다 (${ext || "확장자 없음"}). 허용 형식: ${allowed}`);
  }

  const stat = fs.statSync(filePath);
  const sizeMb = stat.size / 1024 / 1024;
  if (sizeMb > fmt.maxMb) {
    throw new Error(`${ext.slice(1).toUpperCase()} 파일은 최대 ${fmt.maxMb}MB까지 지원합니다. (현재 ${sizeMb.toFixed(1)}MB)`);
  }

  // magic bytes 검증 — 확장자 위장 방지
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  const matched = fmt.magic.some(seq => seq.every((b, i) => buf[i] === b));
  if (!matched) {
    throw new Error(`파일 내용이 ${ext.slice(1).toUpperCase()} 형식과 일치하지 않습니다. 파일을 확인하세요.`);
  }

  return fmt;
}

// Embed the selected image in the managed CSS block so workbench CSP can load it.
function imageFileToDataUri(filePath) {
  const mime = mimeFromPath(filePath);
  const base64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${base64}`;
}

function normPos(value, fallback = 50) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function normBgSize(value) {
  return ["cover", "contain", "auto"].includes(value) ? value : "cover";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { activate, deactivate };
