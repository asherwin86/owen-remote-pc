# Remote Desktop

Screen + system audio + microphone + remote mouse/keyboard control, from any
device with a web browser, over WebRTC. Pair a viewer to a host with a short
code — no accounts, no server to deploy, no install on the viewing device.

**Scope:**
- **Host**: Windows only, packaged as a single Electron app. Screen capture,
  system-audio loopback, and native input injection all use Windows-specific
  paths.
- **No separate server, ever.** The host app runs its own signaling server
  in-process (`signaling.js`) — installing/running `host-app` on the Windows
  machine you want to control is the entire setup. Nothing gets deployed or
  hosted anywhere else.
- **Network**: same LAN/Wi-Fi only. Uses Google's public STUN servers, no
  TURN relay — this works whenever both devices can reach each other
  directly, which a shared network always allows, but won't reliably work
  across the open internet or through strict corporate NATs.

## How it fits together

```
host-app/    Electron app for the Windows machine being controlled. On
             launch it starts its own signaling server (signaling.js) and
             serves the viewer page from viewer/ — nothing else needs to
             run. Captures the screen + system audio, streams them over
             WebRTC, plays back the viewer's microphone through this
             machine's speakers, and injects incoming remote input into
             the real OS via @nut-tree-fork/nut-js.
viewer/      A single static page bundled into host-app and served by it —
             open it on literally any device with a browser (phone, tablet,
             laptop, doesn't matter). Enter the code, watch the stream,
             click it to start sending your mouse/keyboard to the host.
```

Once the WebRTC connection is up, the signaling server drops out of the
picture for video/audio/input — those flow directly between host and viewer.
The only things that still go through it afterwards are renegotiations (e.g.
toggling the viewer's microphone on/off).

## Running it

Everything runs **on the Windows machine you want to control**.

**Easiest — prebuilt app:** grab `Remote Desktop Host-Setup-<version>.exe`
(installer) or `Remote Desktop Host-Portable-<version>.exe` (no install) from
a release, and run it. No Node, no npm, nothing else to install.

**From source:**
```
cd host-app
npm install
npm start
```

Either way: click **Start Sharing**. Windows will likely prompt for
screen-recording permission the first time — allow it. Once sharing starts
you'll see both an address (e.g. `http://<this-PC's-LAN-IP>:5555`) and a
6-character code.

On the other device, open that address in any browser, type in the code, and
click Connect. Click the video once it appears to start sending your
mouse/keyboard to the host; press **Esc** to stop sending input without
disconnecting. Use the **🎤 Mic** button to send your voice to the host (it
plays through the host's speakers); **⛶ Fullscreen** to fill the screen with
the video; the number in the top-left is the incoming frame rate.

**Building the Windows installer/portable exe yourself** (from a Linux/WSL
box with Wine set up — see `USE_SYSTEM_WINE`):
```
cd host-app
USE_SYSTEM_WINE=true npx electron-builder --win nsis portable
```
Output lands in `host-app/dist/`. `npmRebuild: false` in `package.json`'s
`build` config is deliberate — `@nut-tree-fork/nut-js`'s native bindings ship
prebuilt for all platforms in the published npm package, so electron-builder
should package the Windows one as-is rather than trying to recompile it
(which would fail without a Windows toolchain).

## Known limitations (not bugs, just not built yet)

- **No authentication beyond the code itself.** Anyone who has the code can
  view and control the host for as long as it's valid (until the host
  disconnects or a new sharing session starts, which issues a fresh code).
  Fine for "share this with someone I'm on a call with right now"; not
  something to leave running unattended.
- **One viewer at a time.** A second person trying to join an
  already-viewed session gets turned away, not queued or merged in.
- **Whole primary screen only** — no per-window picker, no picking a second
  monitor if you have one.
- **No clipboard sync, no file transfer.** Screen/audio/mic/input only.
