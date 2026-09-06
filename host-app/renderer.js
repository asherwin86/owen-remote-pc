// Remote Desktop — host renderer. This is the half of the pipeline that
// actually can run in a browser context: capturing the screen+system audio
// via getUserMedia's Electron-specific desktop constraints, and driving the
// WebRTC side of the connection as the offering peer. Remote input arriving
// over the data channel is hemmed back out through hostAPI (preload.js) to
// main.js, since actually moving the mouse needs nut-js's native bindings,
// which this renderer has no direct access to.
(function () {
  "use strict";

  const startBtn = document.getElementById("startBtn");
  const codeBox = document.getElementById("codeBox");
  const codeDisplay = document.getElementById("codeDisplay");
  const linkDisplay = document.getElementById("linkDisplay");
  const statusEl = document.getElementById("status");
  const remoteMicAudio = document.getElementById("remoteMicAudio");

  const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  let ws = null;
  let pc = null;
  let dataChannel = null;
  let localStream = null;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || "";
  }

  async function startSharing() {
    startBtn.disabled = true;
    setStatus("Getting screen source…");

    const info = await window.hostAPI.getServerInfo();
    if (info.error) { setStatus("Signaling server failed to start: " + info.error, "error"); startBtn.disabled = false; return; }
    if (!info.lanIp) { setStatus("Couldn't detect a LAN address — is this machine on a network?", "error"); startBtn.disabled = false; return; }
    linkDisplay.textContent = `http://${info.lanIp}:${info.port}`;

    const source = await window.hostAPI.getScreenSource();
    if (!source) { setStatus("No screen source available.", "error"); startBtn.disabled = false; return; }

    try {
      // The "mandatory: { chromeMediaSource: 'desktop' }" shape (not the
      // standard MediaStreamConstraints syntax) is Electron/Chromium's own
      // extension specifically for capturing a desktopCapturer source —
      // applying it to BOTH audio and video in the same call is what gets
      // system-audio loopback alongside the screen video, on Windows.
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "desktop" } },
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: source.id,
            maxFrameRate: 30,
          },
        },
      });
    } catch (e) {
      setStatus("Couldn't capture the screen/audio: " + e.message, "error");
      startBtn.disabled = false;
      return;
    }

    setStatus("Connecting to signaling server…");
    ws = new WebSocket(`ws://localhost:${info.port}/signal`);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "host" }));
    });
    ws.addEventListener("message", (evt) => handleSignal(JSON.parse(evt.data)));
    ws.addEventListener("close", () => setStatus("Disconnected from signaling server.", "error"));
    ws.addEventListener("error", () => setStatus("Couldn't reach the signaling server.", "error"));
  }

  async function handleSignal(msg) {
    if (msg.type === "hosting") {
      codeDisplay.textContent = msg.code;
      codeBox.classList.add("active");
      setStatus("Waiting for a viewer to connect…", "ok");
      return;
    }
    if (msg.type === "viewer-joined") {
      setStatus("Viewer connected — starting stream…", "ok");
      await createOffer();
      return;
    }
    if (msg.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      setStatus("Streaming.", "ok");
      return;
    }
    if (msg.type === "ice-candidate" && msg.candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) { /* can race the remote description; safe to drop */ }
      return;
    }
    if (msg.type === "viewer-left") {
      setStatus("Viewer disconnected. Waiting for the next one…", "ok");
      teardownPeerConnection();
      return;
    }
    if (msg.type === "offer") {
      // A renegotiation offer from the viewer — e.g. toggling their
      // microphone on/off. The host's pc already exists at this point (this
      // never fires during the initial handshake, which the host itself
      // starts by sending the first offer), so it just needs to answer.
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "answer", sdp: pc.localDescription }));
      return;
    }
  }

  async function createOffer() {
    pc = new RTCPeerConnection(RTC_CONFIG);
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    dataChannel = pc.createDataChannel("input");
    dataChannel.addEventListener("message", (evt) => {
      let cmd;
      try { cmd = JSON.parse(evt.data); } catch (e) { return; }
      window.hostAPI.injectInput(cmd);
    });

    pc.addEventListener("icecandidate", (evt) => {
      if (evt.candidate) ws.send(JSON.stringify({ type: "ice-candidate", candidate: evt.candidate }));
    });

    // The only incoming track this side ever gets is the viewer's
    // microphone (added later via renegotiation, see the "offer" branch in
    // handleSignal above) — play it out loud so it's audible on this
    // machine, the same way speakerphone would be.
    pc.addEventListener("track", (evt) => {
      remoteMicAudio.srcObject = evt.streams[0];
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription }));
  }

  function teardownPeerConnection() {
    if (dataChannel) { dataChannel.close(); dataChannel = null; }
    if (pc) { pc.close(); pc = null; }
  }

  startBtn.addEventListener("click", startSharing);
})();
