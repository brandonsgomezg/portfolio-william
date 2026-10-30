/* Voice assistant for the portfolio — real-time Gemini Live, ephemeral token, AudioWorklet capture. */
(function () {
  "use strict";

  var WS_BASE =
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
  var MODEL = "models/gemini-3.8-live";
  var IN_RATE = 16000;
  var OUT_RATE = 24000;

  var sections = {
    top: "#top",
    about: "#about",
    work: "#work",
    experience: "#experience",
    skills: "#skills",
    contact: "#contact"
  };

  var state = {
    open: false,
    ws: null,
    token: null,
    connecting: false,
    live: false,
    micStream: null,
    inCtx: null,
    outCtx: null,
    worklet: null,
    source: null,
    sources: [],
    nextTime: 0,
    outActive: null,
    inActive: null,
    muted: false
  };

  /* ───────── UI ───────── */
  var MIC_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15Z"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3.5"/></svg>';
  var SPARK_SVG =
    '<svg viewBox="0 0 24 24" fill="#052528" aria-hidden="true"><path d="M12 2.4 13.6 9 20 10.4 14.2 13.2 15.6 20 12 16.8 8.4 20 9.8 13.2 4 10.4 10.4 9Z"/></svg>';

  var launcher = document.createElement("button");
  launcher.id = "avz-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Talk to the voice assistant");
  launcher.innerHTML =
    '<span class="avz-orb">' + SPARK_SVG + "</span><span>Ask about William</span>";

  var panel = document.createElement("div");
  panel.id = "avz-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Voice assistant");
  panel.innerHTML =
    '<div class="avz-top">' +
    '<span class="avz-orb">' + SPARK_SVG + "</span>" +
    "<div><div id=\"avz-title\">William's assistant</div><div id=\"avz-status\">Ready</div></div>" +
    '<button id="avz-close" type="button" aria-label="Close assistant">✕</button>' +
    "</div>" +
    '<div id="avz-log" aria-live="polite"></div>' +
    '<div id="avz-foot">' +
    '<div id="avz-actions"><button id="avz-mic" type="button" aria-label="Start talking">' + MIC_SVG + "</button></div>" +
    '<div class="avz-hint" id="avz-hint">Tap the mic and ask out loud — or type below. Your voice is sent to Google to answer; nothing is stored.</div>' +
    '<div id="avz-text"><input id="avz-input" type="text" placeholder="Or type your question…" autocomplete="off"><button id="avz-send" type="button">Send</button></div>' +
    "</div>";

  function mount() {
    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    document.getElementById("avz-close").addEventListener("click", close);
    launcher.addEventListener("click", open);
    document.getElementById("avz-mic").addEventListener("click", toggleMic);
    document.getElementById("avz-send").addEventListener("click", sendText);
    document.getElementById("avz-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        sendText();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) close();
    });
    window.addEventListener("beforeunload", teardown);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state.micStream) {
        stopMic();
        status("Paused");
      }
    });
  }

  function log(cls, text) {
    var el = document.createElement("div");
    el.className = "avz-msg " + cls;
    el.textContent = text;
    var box = document.getElementById("avz-log");
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function status(txt) {
    document.getElementById("avz-status").textContent = txt;
  }

  function open() {
    state.open = true;
    launcher.style.display = "none";
    panel.classList.add("is-open");
    if (!panel.dataset.greeted) {
      panel.dataset.greeted = "1";
      log(
        "avz-bot",
        "Hi — I'm William's assistant. Ask me anything about his experience, skills or how to reach him. Hablo español también."
      );
    }
    setTimeout(function () {
      var i = document.getElementById("avz-input");
      if (i) i.focus();
    }, 250);
  }

  function close() {
    state.open = false;
    panel.classList.remove("is-open");
    launcher.style.display = "";
    stopMic();
  }

  /* ───────── connection ───────── */
  function toggleMic() {
    if (state.live && state.micStream) {
      stopMic();
      status("Mic off");
      return;
    }
    start();
  }

  function start() {
    if (state.connecting) return;
    if (!state.ws) {
      state.connecting = true;
      var micBtn = document.getElementById("avz-mic");
      micBtn.disabled = true;
      status("Connecting…");
      fetch("/api/token", { method: "POST", headers: { "Content-Type": "application/json" } })
        .then(function (r) {
          if (!r.ok) throw new Error("token " + r.status);
          return r.json();
        })
        .then(function (data) {
          if (!data.token) throw new Error("no token");
          state.token = data.token;
          state.connecting = false;
          micBtn.disabled = false;
          connectWs(data.token);
        })
        .catch(function (err) {
          state.connecting = false;
          micBtn.disabled = false;
          status("Unavailable");
          log("avz-err", "I can't start the voice session right now (" + err.message + "). You can still write to William at williamsgonzalezt@outlook.com.");
        });
      return;
    }
    if (state.ws) {
      if (state.ws.readyState !== 1 || !state.ready) {
        log("avz-sys", "Still connecting, one moment…");
        return;
      }
      state.muted = false;
      resumeAudio();
      if (!state.micStream) startCapture();
      return;
    }
  }

  function connectWs(token) {
    var url = WS_BASE + "?access_token=" + encodeURIComponent(token);
    var ws = new WebSocket(url);
    state.ws = ws;
    status("Connecting…");

    ws.onopen = function () {
      ws.send(JSON.stringify({ setup: { model: MODEL } }));
    };

    ws.onmessage = function (ev) {
      var raw = ev.data;
      if (typeof raw === "string") {
        parseAndHandle(raw);
      } else if (raw instanceof Blob) {
        raw.text().then(parseAndHandle);
      } else if (raw instanceof ArrayBuffer) {
        parseAndHandle(new TextDecoder().decode(raw));
      }
    };

    function parseAndHandle(text) {
      var msg;
      try {
        msg = JSON.parse(text);
      } catch (e) {
        return;
      }
      handle(msg);
    }

    ws.onerror = function () {
      status("Error");
    };

    ws.onclose = function (e) {
      state.live = false;
      state.ready = false;
      state.ws = null;
      state.token = null;
      stopMic();
      launcher.classList.remove("is-live");
      var mic = document.getElementById("avz-mic");
      if (mic) mic.classList.remove("is-live");
      if (state.open) status("Disconnected");
      if (e.code && e.code !== 1000 && e.code !== 1005) {
        log("avz-sys", "Session ended. Tap the mic to start again.");
      }
    };
  }

  function handle(msg) {
    if (msg.setupComplete) {
      state.ready = true;
      status("Listening");
      if (pendingText) {
        var t = pendingText;
        pendingText = null;
        if (state.ws && state.ws.readyState === 1) {
          state.ws.send(
            JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: t }] }], turnComplete: true } })
          );
        }
        return;
      }
      startCapture();
      return;
    }

    if (msg.toolCall && msg.toolCall.functionCalls) {
      var responses = msg.toolCall.functionCalls.map(function (call) {
        var out = { ok: false };
        if (call.name === "ir_a_seccion") {
          var key = (call.args && (call.args.seccion || call.args.section)) || "top";
          var sel = sections[key];
          var target = sel && document.querySelector(sel);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            out = { ok: true, seccion: key };
          } else {
            out = { ok: false, error: "unknown section" };
          }
        }
        return { id: call.id, name: call.name, response: out };
      });
      if (state.ws && state.ws.readyState === 1) {
        state.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      }
      return;
    }

    var sc = msg.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      flushPlayback();
      state.outActive = null;
      status("Listening");
    }

    if (sc.inputTranscription && sc.inputTranscription.text) {
      if (!state.inActive) state.inActive = log("avz-user", "");
      state.inActive.textContent += sc.inputTranscription.text;
      var box = document.getElementById("avz-log");
      box.scrollTop = box.scrollHeight;
    }

    if (sc.outputTranscription && sc.outputTranscription.text) {
      if (!state.outActive) state.outActive = log("avz-bot", "");
      state.outActive.textContent += sc.outputTranscription.text;
      var b2 = document.getElementById("avz-log");
      b2.scrollTop = b2.scrollHeight;
    }

    if (sc.modelTurn && sc.modelTurn.parts) {
      sc.modelTurn.parts.forEach(function (part) {
        if (part.inlineData && part.inlineData.data) {
          playChunk(part.inlineData.data);
        }
        if (part.text && !sc.outputTranscription) {
          if (!state.outActive) state.outActive = log("avz-bot", "");
          state.outActive.textContent += part.text;
        }
      });
    }

    if (sc.turnComplete) {
      state.outActive = null;
      state.inActive = null;
      status(state.micStream ? "Listening" : "Paused");
    }
  }

  /* ───────── microphone ───────── */
  function startCapture() {
    if (state.micStream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log("avz-err", "This browser can't use the microphone. You can type your question below.");
      status("Text only");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (stream) {
        state.micStream = stream;
        var Ctx = window.AudioContext || window.webkitAudioContext;
        state.inCtx = new Ctx({ sampleRate: IN_RATE });
        var ratio = state.inCtx.sampleRate / IN_RATE;
        return state.inCtx.audioWorklet
          .addModule("/pcm-capture.js")
          .then(function () {
            state.source = state.inCtx.createMediaStreamSource(stream);
            state.worklet = new AudioWorkletNode(state.inCtx, "pcm-capture");
            state.worklet.port.onmessage = function (ev) {
              if (!state.live || state.muted) return;
              var frame = ev.data;
              if (ratio !== 1) frame = resample(frame, ratio);
              var pcm = floatTo16(frame);
              if (state.ws && state.ws.readyState === 1) {
                state.ws.send(
                  JSON.stringify({
                    realtimeInput: {
                      audio: { data: b64(pcm), mimeType: "audio/pcm;rate=16000" }
                    }
                  })
                );
              }
            };
            state.source.connect(state.worklet);
            state.worklet.connect(state.inCtx.destination);
            state.live = true;
            launcher.classList.add("is-live");
            document.getElementById("avz-mic").classList.add("is-live");
            status("Listening");
            clearTimeout(state.capTimer);
            state.capTimer = setTimeout(function () {
              if (state.micStream) {
                stopMic();
                status("Mic off");
                log("avz-sys", "Mic off after five minutes to keep this free — tap it again to carry on, or email William.");
              }
            }, 5 * 60 * 1000);
          });
      })
      .catch(function (err) {
        status("Mic blocked");
        log(
          "avz-err",
          "I couldn't open your microphone (" + (err && err.name ? err.name : "error") + "). You can type your question below instead."
        );
      });
  }

  function stopMic() {
    if (state.worklet) {
      try {
        state.worklet.port.onmessage = null;
        state.worklet.disconnect();
      } catch (e) {}
    }
    if (state.source) {
      try {
        state.source.disconnect();
      } catch (e) {}
    }
    if (state.micStream) {
      state.micStream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
    if (state.inCtx) {
      try {
        state.inCtx.close();
      } catch (e) {}
    }
    state.worklet = null;
    state.source = null;
    state.micStream = null;
    state.inCtx = null;
    state.live = false;
    launcher.classList.remove("is-live");
    var mic = document.getElementById("avz-mic");
    if (mic) mic.classList.remove("is-live");
  }

  function resumeAudio() {
    if (state.inCtx && state.inCtx.state === "suspended") state.inCtx.resume();
    if (state.outCtx && state.outCtx.state === "suspended") state.outCtx.resume();
  }

  function resample(buf, ratio) {
    var len = Math.floor(buf.length / ratio);
    var out = new Float32Array(len);
    for (var i = 0; i < len; i++) out[i] = buf[Math.floor(i * ratio)];
    return out;
  }

  /* ───────── playback ───────── */
  function playChunk(b64data) {
    state.bytesIn = (state.bytesIn || 0) + b64data.length;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!state.outCtx) state.outCtx = new Ctx({ sampleRate: OUT_RATE });
    var ctx = state.outCtx;
    if (ctx.state === "suspended") ctx.resume();

    var bytes = atob(b64data);
    var n = bytes.length >> 1;
    var view = new DataView(new ArrayBuffer(n * 2));
    for (var i = 0; i < n; i++) view.setUint8(i * 2, bytes.charCodeAt(i * 2));
    for (var j = 0; j < n; j++) view.setUint8(j * 2 + 1, bytes.charCodeAt(j * 2 + 1));
    var int16 = new Int16Array(view.buffer);
    var buf = ctx.createBuffer(1, n, OUT_RATE);
    var ch = buf.getChannelData(0);
    for (var k = 0; k < n; k++) ch[k] = int16[k] / 32768;

    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    var now = ctx.currentTime;
    if (state.nextTime < now + 0.02) state.nextTime = now + 0.06;
    src.start(state.nextTime);
    state.nextTime += buf.duration;
    var endAt = state.nextTime;
    state.sources.push({ src: src, end: endAt });
    // drop finished references so the list can't grow forever
    if (state.sources.length > 8) {
      state.sources = state.sources.filter(function (s) {
        return s.end > ctx.currentTime;
      });
    }
    src.onended = function () {
      state.sources = state.sources.filter(function (s) {
        return s.src !== src;
      });
    };
    status("Speaking");
  }

  function flushPlayback() {
    state.sources.forEach(function (s) {
      try {
        s.src.stop();
      } catch (e) {}
    });
    state.sources = [];
    state.nextTime = 0;
  }

  /* ───────── text fallback ───────── */
  function sendText() {
    var input = document.getElementById("avz-input");
    var text = (input.value || "").trim();
    if (!text) return;
    input.value = "";
    log("avz-user", text);
    state.outActive = null;
    if (!state.ws) {
      state.connecting = true;
      status("Connecting…");
      fetch("/api/token", { method: "POST", headers: { "Content-Type": "application/json" } })
        .then(function (r) {
          if (!r.ok) throw new Error("token " + r.status);
          return r.json();
        })
        .then(function (d) {
          state.connecting = false;
          pendingText = text;
          connectWs(d.token);
        })
        .catch(function (err) {
          state.connecting = false;
          status("Unavailable");
          log("avz-err", "The assistant is unavailable right now (" + err.message + "). Write to williamsgonzalezt@outlook.com and he'll answer.");
        });
      return;
    }
    if (state.ws.readyState !== 1) {
      log("avz-sys", "Reconnecting, one moment…");
      return;
    }
    state.ws.send(
      JSON.stringify({
        clientContent: { turns: [{ role: "user", parts: [{ text: text }] }], turnComplete: true }
      })
    );
  }

  var pendingText = null;

  /* ───────── helpers ───────── */
  function floatTo16(f32) {
    var out = new Int16Array(f32.length);
    for (var i = 0; i < f32.length; i++) {
      var s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function b64(int16) {
    var bytes = new Uint8Array(int16.buffer);
    var str = "";
    var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      str += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(str);
  }

  function teardown() {
    stopMic();
    if (state.ws) {
      try {
        state.ws.close();
      } catch (e) {}
    }
  }

  // send any queued text once the socket is ready

  // small public hook so the owner can check the session from the console
  window.__avzStats = function () {
    return {
      live: state.live,
      mic: !!state.micStream,
      audioBase64Chars: state.bytesIn || 0,
      queuedSources: state.sources.length,
      status: (document.getElementById("avz-status") || {}).textContent
    };
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
