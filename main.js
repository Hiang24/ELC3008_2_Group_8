const MODEL_URL = "https://teachablemachine.withgoogle.com/models/meZmCHgZF/";

const CONFIG = {
  confidence: 0.75,
  warningTime: 5,
};

const state = {
  model: null,
  webcam: null,
  ctx: null,
  isRunning: false,
  timerInterval: null,

  // Global Data
  mode: "NORMAL", // 'NORMAL' or 'POMODORO'
  logs: [],

  // AI Logic
  currentStatus: "Unknown",
  tempCurrentStatus: "Unknown",
  statusDuration: 0,

  // Pomodoro Specific
  pomoSettings: { focus: 25, break: 5 },
  pomoState: {
    phase: "FOCUS", // 'FOCUS' or 'BREAK'
    remainingSec: 0,
    sessionCount: 0,
    totalBreakTime: 0,
  },

  // Stats
  stats: { focused: 0, distracted: 0, absent: 0, warnings: 0 },
};

const app = {
  // --- NAVIGATION ---
  switchScreen(id) {
    document
      .querySelectorAll(".screen")
      .forEach((s) => s.classList.remove("active"));
    document.getElementById(`screen-${id}`).classList.add("active");
  },

  goToSetup() {
    this.switchScreen("setup");
  },

  // --- START MODES ---
  async startNormalMode() {
    state.mode = "NORMAL";
    this.setupStudyScreen("Normal Mode", "NORMAL");
    await this.initAI();
    state.isRunning = true;
    state.startTime = Date.now();
    state.timerInterval = setInterval(() => this.tickNormal(), 1000);
    this.loop();
  },

  async startPomodoroMode() {
    const focusMin =
      parseInt(document.getElementById("input-focus-time").value) || 25;
    const breakMin =
      parseInt(document.getElementById("input-break-time").value) || 5;

    state.mode = "POMODORO";
    state.pomoSettings = { focus: focusMin, break: breakMin };
    state.pomoState = {
      phase: "FOCUS",
      remainingSec: focusMin * 60,
      sessionCount: 1,
      totalBreakTime: 0,
    };

    this.setupStudyScreen("Pomodoro - Session 1", "POMODORO");
    document.getElementById("pomodoro-stats").classList.remove("hidden");

    await this.initAI();
    state.isRunning = true;
    state.timerInterval = setInterval(() => this.tickPomodoro(), 1000);
    this.loop();
  },

  setupStudyScreen(title, badge) {
    this.switchScreen("study");
    document.getElementById("session-title").innerText = title;
    document.getElementById("mode-badge").innerText = badge;
  },

  // --- AI INIT & LOOP ---
  async initAI() {
    if (state.model) return; // Đã load rồi thì thôi
    try {
      state.model = await tmPose.load(
        MODEL_URL + "model.json",
        MODEL_URL + "metadata.json"
      );
      const size = 500;
      const flip = true;
      state.webcam = new tmPose.Webcam(size, size, flip);
      await state.webcam.setup();
      await state.webcam.play();
      const canvas = document.getElementById("canvas");
      canvas.width = size;
      canvas.height = size;
      state.ctx = canvas.getContext("2d");
      document.getElementById("loader").classList.add("hidden");
    } catch (e) {
      alert("Lỗi tải AI: " + e.message);
      location.reload();
    }
  },

  async loop() {
    if (!state.isRunning) return;
    state.webcam.update();
    await this.predict();
    window.requestAnimationFrame(() => this.loop());
  },

  async predict() {
    const { pose, posenetOutput } = await state.model.estimatePose(
      state.webcam.canvas
    );
    const prediction = await state.model.predict(posenetOutput);

    // Nếu đang Break thì không vẽ xương để nhìn cho thư giãn
    if (state.mode === "POMODORO" && state.pomoState.phase === "BREAK") {
      // Clear canvas
      state.ctx.drawImage(state.webcam.canvas, 0, 0);
    } else {
      this.drawPose(pose);
    }

    this.processPredictions(prediction);
  },

  drawPose(pose) {
    if (state.webcam.canvas) {
      state.ctx.drawImage(state.webcam.canvas, 0, 0);
      if (pose) {
        tmPose.drawKeypoints(pose.keypoints, 0.5, state.ctx);
        tmPose.drawSkeleton(pose.keypoints, 0.5, state.ctx);
      }
    }
  },

  processPredictions(prediction) {
    let highestProb = 0;
    let bestClass = "";

    prediction.forEach((p) => {
      const percentage = (p.probability * 100).toFixed(0) + "%";
      const name = p.className.toLowerCase();

      if (name.includes("tập trung") && !name.includes("mất")) {
        document.getElementById("bar-focus").style.width = percentage;
        document.getElementById("score-focus").innerText = percentage;
        if (p.probability > highestProb) {
          highestProb = p.probability;
          bestClass = "Focused";
        }
      } else if (name.includes("mất") || name.includes("distract")) {
        document.getElementById("bar-distract").style.width = percentage;
        document.getElementById("score-distract").innerText = percentage;
        if (p.probability > highestProb) {
          highestProb = p.probability;
          bestClass = "Distracted";
        }
      } else if (name.includes("vắng") || name.includes("absent")) {
        document.getElementById("bar-absent").style.width = percentage;
        document.getElementById("score-absent").innerText = percentage;
        if (p.probability > highestProb) {
          highestProb = p.probability;
          bestClass = "Absent";
        }
      }
    });

    if (highestProb > CONFIG.confidence) {
      state.tempCurrentStatus = bestClass;
    }
  },

  // --- LOGIC ENGINE ---
  // Xử lý chung cho cả 2 chế độ về việc: Xác định trạng thái, Cảnh báo, Logging
  processCoreLogic() {
    const status = state.tempCurrentStatus || "Unknown";

    // Đếm thời gian trạng thái
    if (status === state.currentStatus) state.statusDuration++;
    else {
      state.currentStatus = status;
      state.statusDuration = 1;
    }

    // Chỉ xử lý Cảnh báo/Màu nền nếu ĐANG HỌC (Focus Phase)
    const isStudyPhase =
      state.mode === "NORMAL" ||
      (state.mode === "POMODORO" && state.pomoState.phase === "FOCUS");

    if (isStudyPhase) {
      // Update UI Text
      this.updateStatusText(status, state.statusDuration);

      // Logic Cảnh báo
      if (state.statusDuration > CONFIG.warningTime) {
        if (status === "Focused") {
          this.hideWarning();
          this.updateBackgroundColor("Focused");
        } else if (status === "Distracted") {
          // Kiểm tra xem popup "Mất tập trung" đã hiển thị chưa
          const popup = document.getElementById("warning-popup");
          const wasShowing = popup.style.display === "flex";

          // Hiển thị popup "Mất tập trung"
          this.showWarning("⚠️ Mất tập trung! Quay lại học đi nào.");
          this.updateBackgroundColor("Distracted");

          // Log vào nhật ký khi popup "Mất tập trung" vừa xuất hiện
          if (!wasShowing) {
            this.addLog("Study", "Distracted");
          }
        } else if (status === "Absent") {
          // Kiểm tra xem popup "Vắng mặt" đã hiển thị chưa
          const popup = document.getElementById("warning-popup");
          const wasShowing = popup.style.display === "flex";

          // Hiển thị popup "Vắng mặt"
          this.showWarning("❗ Vắng mặt! Bạn đi đâu rồi?");
          this.updateBackgroundColor("Absent");

          // Đếm cảnh báo và log vào nhật ký khi popup "Vắng mặt" vừa xuất hiện
          if (!wasShowing) {
            state.stats.warnings++;
            this.addLog("Study", "Absent");
          }
        }
      } else {
        // Nếu chưa đạt ngưỡng, ẩn popup
        this.hideWarning();
      }

      // Stats counting
      if (status === "Focused") state.stats.focused++;
      else if (status === "Distracted") state.stats.distracted++;
      else if (status === "Absent") state.stats.absent++;
    } else {
      // BREAK MODE - Không log trạng thái gì cả
      this.hideWarning();
      this.updateBackgroundColor("Break");
      // Stats counting for Break? -> No, we count totalBreakTime separately
    }
  },

  // --- TIMER LOOPS ---
  tickNormal() {
    if (!state.isRunning) return;

    // Timer tăng dần
    const diff = Math.floor((Date.now() - state.startTime) / 1000);
    this.renderTimer(diff);

    this.processCoreLogic();
  },

  tickPomodoro() {
    if (!state.isRunning) return;

    // 1. Timer giảm dần
    state.pomoState.remainingSec--;
    this.renderTimer(state.pomoState.remainingSec);

    // 2. Xử lý Hết giờ
    if (state.pomoState.remainingSec <= 0) {
      this.switchPomodoroPhase();
    }

    // 3. Đếm thời gian Break tổng
    if (state.pomoState.phase === "BREAK") {
      state.pomoState.totalBreakTime++;
    }

    // 4. Logic AI
    this.processCoreLogic();
  },

  switchPomodoroPhase() {
    if (state.pomoState.phase === "FOCUS") {
      // Chuyển sang BREAK
      state.pomoState.phase = "BREAK";
      state.pomoState.remainingSec = state.pomoSettings.break * 60;

      document.getElementById("session-title").innerText = "Nghỉ giải lao";
      document.getElementById("break-overlay").classList.remove("hidden");

      // Log khi chuyển sang Break phase
      this.addLog("Break", "Break");
    } else {
      // Chuyển sang FOCUS (Session mới)
      state.pomoState.phase = "FOCUS";
      state.pomoState.remainingSec = state.pomoSettings.focus * 60;
      state.pomoState.sessionCount++;

      document.getElementById(
        "session-title"
      ).innerText = `Pomodoro - Session ${state.pomoState.sessionCount}`;
      document.getElementById("break-overlay").classList.add("hidden");
      document.getElementById("pomo-session-count").innerText =
        state.pomoState.sessionCount;
    }
  },

  // --- UI HELPERS ---
  renderTimer(seconds) {
    const h = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    document.getElementById("main-timer").innerText = `${h}:${m}:${s}`;
  },

  updateStatusText(status, duration) {
    const d = document.getElementById("status-display");
    const s = document.getElementById("status-sub");

    if (status === "Focused") {
      d.innerText = "Tập trung";
      d.className = "text-3xl font-bold text-emerald-600 mb-1";
      s.innerText = `${duration}s liên tục`;
    } else if (status === "Distracted") {
      d.innerText = "Mất tập trung";
      d.className = "text-3xl font-bold text-yellow-600 mb-1";
      s.innerText = `${duration}s liên tục`;
    } else if (status === "Absent") {
      d.innerText = "Vắng mặt";
      d.className = "text-3xl font-bold text-red-600 mb-1";
      s.innerText = `${duration}s liên tục`;
    }
  },

  updateBackgroundColor(type) {
    const body = document.getElementById("main-body");
    body.className =
      "min-h-screen text-slate-800 transition-colors duration-500 ";

    if (type === "Focused") body.classList.add("bg-emerald-600");
    else if (type === "Distracted") body.classList.add("bg-yellow-500");
    else if (type === "Absent") body.classList.add("bg-red-600");
    else if (type === "Break")
      body.classList.add("bg-slate-400"); // Màu xám khi nghỉ
    else body.classList.add("bg-slate-100");
  },

  showWarning(text) {
    const p = document.getElementById("warning-popup");
    document.getElementById("warning-text").innerText = text;
    p.style.display = "flex";
  },
  hideWarning() {
    document.getElementById("warning-popup").style.display = "none";
  },

  // Helper function để thêm log vào nhật ký
  addLog(phase, status) {
    const now = new Date().toLocaleTimeString();
    state.logs.push({
      time: now,
      phase: phase,
      status: status,
      note: "",
    });
  },

  // --- END SESSION & SUMMARY ---
  endSessionConfirm() {
    if (confirm("Bạn muốn kết thúc và xem tổng kết?")) {
      state.isRunning = false;
      clearInterval(state.timerInterval);
      if (state.webcam) state.webcam.stop();
      this.updateBackgroundColor("Default");
      this.switchScreen("summary");
      this.renderSummary();
    }
  },

  renderSummary() {
    // Tính toán
    const totalStudyTime =
      state.stats.focused + state.stats.distracted + state.stats.absent;
    const totalBreakTime =
      state.mode === "POMODORO" ? state.pomoState.totalBreakTime : 0;
    const pomodoros =
      state.mode === "POMODORO"
        ? state.pomoState.sessionCount
        : totalStudyTime > 1500
        ? 1
        : 0;

    const format = (s) => {
      const m = Math.floor(s / 60);
      return `${m}p ${s % 60}s`;
    };

    // Render Text
    document.getElementById("summary-subtitle").innerText = `Chế độ: ${
      state.mode
    } | Tổng thời gian: ${format(totalStudyTime + totalBreakTime)}`;
    document.getElementById("sum-time").innerText = format(totalStudyTime);
    document.getElementById("sum-break").innerText = format(totalBreakTime);
    document.getElementById("sum-pomodoros").innerText = pomodoros;

    const pFocus = totalStudyTime
      ? ((state.stats.focused / totalStudyTime) * 100).toFixed(1)
      : 0;
    document.getElementById("sum-focus").innerText = pFocus + "%";

    // Hiển thị trực tiếp số lần cảnh báo (mỗi lần popup xuất hiện = 1)
    document.getElementById("sum-warnings").innerText = state.stats.warnings;

    // Chart
    const ctx = document.getElementById("summaryChart").getContext("2d");
    if (window.myChart) window.myChart.destroy();
    window.myChart = new Chart(ctx, {
      type: "pie",
      data: {
        labels: ["Tập trung", "Mất tập trung", "Vắng mặt"],
        datasets: [
          {
            data: [
              state.stats.focused,
              state.stats.distracted,
              state.stats.absent,
            ],
            backgroundColor: ["#10b981", "#eab308", "#ef4444"],
          },
        ],
      },
    });

    // Logs Table
    const tbody = document.getElementById("log-table-body");
    tbody.innerHTML = "";
    state.logs.forEach((log) => {
      const tr = document.createElement("tr");
      tr.className = "border-b border-slate-50";

      let color = "text-slate-600";
      if (log.status === "Focused") color = "text-emerald-600 font-bold";
      if (log.status === "Distracted") color = "text-yellow-600 font-bold";
      if (log.status === "Absent") color = "text-red-600 font-bold";
      if (log.status === "Break") color = "text-slate-500 font-bold";

      tr.innerHTML = `
        <td class="px-4 py-2 font-mono text-slate-500">${log.time}</td>
        <td class="px-4 py-2 text-xs font-bold uppercase text-indigo-500">${log.phase}</td>
        <td class="px-4 py-2 ${color}">${log.status}</td>
        <td class="px-4 py-2 text-slate-400 italic">${log.note}</td>
      `;
      tbody.appendChild(tr);
    });
  },
};
