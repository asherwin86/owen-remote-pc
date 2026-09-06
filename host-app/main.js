// Remote Desktop — host app main process.
//
// WebRTC (getUserMedia/RTCPeerConnection) only exists in a renderer, not in
// Electron's main process, so all the capture/streaming logic lives in
// renderer.js. This file's job is the two things a renderer genuinely can't
// do itself: listing capturable screens (desktopCapturer is main-process-only)
// and actually moving the mouse / pressing keys on the real OS (nut-js needs
// Node's native bindings, which a contextIsolation:true renderer doesn't
// have direct access to — see preload.js for the bridge).
const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require("electron");
const path = require("path");
const os = require("os");
const { mouse, keyboard, Point, Button, Key } = require("@nut-tree-fork/nut-js");
const { startSignalingServer } = require("./signaling");

mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

const SIGNALING_PORT = 5555;

let mainWindow;
let serverInfo = { port: SIGNALING_PORT, lanIp: null, error: null };

function lanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 360,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(async () => {
  // The signaling server runs in-process now — this app IS the only thing
  // that needs to be launched on the Windows machine being controlled, no
  // separate Node process or npm install required on that machine.
  try {
    await startSignalingServer(SIGNALING_PORT);
    serverInfo.lanIp = lanIp();
  } catch (e) {
    serverInfo.error = e.message;
  }
  createWindow();
});
app.on("window-all-closed", () => app.quit());

ipcMain.handle("get-server-info", () => serverInfo);

ipcMain.handle("get-screen-source", async () => {
  // Capturing the whole primary screen for the pilot rather than offering a
  // window picker — simplest thing that actually shows "the desktop" the
  // way a remote-desktop tool is expected to.
  const sources = await desktopCapturer.getSources({ types: ["screen"] });
  return sources.length ? { id: sources[0].id, name: sources[0].name } : null;
});

ipcMain.handle("get-screen-size", () => {
  return screen.getPrimaryDisplay().size;
});

// Browser KeyboardEvent.code -> nut-js Key. Deliberately covers the keys a
// remote-desktop session actually needs (letters, digits, arrows, common
// punctuation, modifiers, function keys) rather than nut-js's entire enum —
// an unmapped code is just silently ignored (see inject-input below) rather
// than throwing, since a viewer's browser can in principle send any code
// string and this shouldn't crash the host over an obscure/unmapped key.
const KEY_MAP = {
  Escape: Key.Escape, F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  Backquote: Key.Grave, Digit1: Key.Num1, Digit2: Key.Num2, Digit3: Key.Num3, Digit4: Key.Num4,
  Digit5: Key.Num5, Digit6: Key.Num6, Digit7: Key.Num7, Digit8: Key.Num8, Digit9: Key.Num9, Digit0: Key.Num0,
  Minus: Key.Minus, Equal: Key.Equal, Backspace: Key.Backspace,
  Tab: Key.Tab, KeyQ: Key.Q, KeyW: Key.W, KeyE: Key.E, KeyR: Key.R, KeyT: Key.T, KeyY: Key.Y, KeyU: Key.U,
  KeyI: Key.I, KeyO: Key.O, KeyP: Key.P, BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket,
  Backslash: Key.Backslash,
  CapsLock: Key.CapsLock, KeyA: Key.A, KeyS: Key.S, KeyD: Key.D, KeyF: Key.F, KeyG: Key.G, KeyH: Key.H,
  KeyJ: Key.J, KeyK: Key.K, KeyL: Key.L, Semicolon: Key.Semicolon, Quote: Key.Quote, Enter: Key.Enter,
  ShiftLeft: Key.LeftShift, KeyZ: Key.Z, KeyX: Key.X, KeyC: Key.C, KeyV: Key.V, KeyB: Key.B, KeyN: Key.N,
  KeyM: Key.M, Comma: Key.Comma, Period: Key.Period, Slash: Key.Slash, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, MetaLeft: Key.LeftSuper, AltLeft: Key.LeftAlt, Space: Key.Space,
  AltRight: Key.RightAlt, MetaRight: Key.RightSuper, ControlRight: Key.RightControl,
  ArrowLeft: Key.Left, ArrowUp: Key.Up, ArrowRight: Key.Right, ArrowDown: Key.Down,
  Insert: Key.Insert, Delete: Key.Delete, Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
};

function mouseButtonFor(n) {
  return n === 2 ? Button.RIGHT : n === 1 ? Button.MIDDLE : Button.LEFT;
}

ipcMain.handle("inject-input", async (_event, cmd) => {
  try {
    if (cmd.type === "mousemove") {
      const { width, height } = screen.getPrimaryDisplay().size;
      await mouse.setPosition(new Point(Math.round(cmd.x * width), Math.round(cmd.y * height)));
    } else if (cmd.type === "mousedown") {
      await mouse.pressButton(mouseButtonFor(cmd.button));
    } else if (cmd.type === "mouseup") {
      await mouse.releaseButton(mouseButtonFor(cmd.button));
    } else if (cmd.type === "scroll") {
      // Browser wheel deltas are usually in the ~100/notch range; nut-js
      // scroll amount is "steps", so this is a rough, not exact, translation.
      const steps = Math.max(1, Math.round(Math.abs(cmd.deltaY) / 40));
      if (cmd.deltaY > 0) await mouse.scrollDown(steps);
      else if (cmd.deltaY < 0) await mouse.scrollUp(steps);
    } else if (cmd.type === "keydown") {
      const key = KEY_MAP[cmd.code];
      if (key !== undefined) await keyboard.pressKey(key);
    } else if (cmd.type === "keyup") {
      const key = KEY_MAP[cmd.code];
      if (key !== undefined) await keyboard.releaseKey(key);
    }
  } catch (e) {
    console.error("Input injection failed:", e.message);
  }
});
