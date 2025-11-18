// Model configuration
const modelURL = "./model/model.json";
const metadataURL = "./model/metadata.json";

// Global variables
let model, webcam, ctx, canvas, maxPredictions;
let isRunning = false;
let animationId = null;

// DOM elements
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const predictionsEl = document.getElementById("predictions");
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("canvas");

// Initialize
async function init() {
  try {
    statusEl.textContent = "Đang tải model...";
    statusEl.classList.add("loading");

    // Load the model and metadata
    model = await tmPose.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();

    // Create prediction items in UI
    createPredictionItems();

    statusEl.textContent = "Sẵn sàng";
    statusEl.classList.remove("loading");
    startBtn.disabled = false;

    console.log("Model loaded successfully");
  } catch (error) {
    console.error("Error loading model:", error);
    statusEl.textContent = "Lỗi khi tải model: " + error.message;
    statusEl.style.background = "rgba(220, 53, 69, 0.8)";
  }
}

// Create prediction items in the UI
function createPredictionItems() {
  const labels = model.getClassLabels();
  predictionsEl.innerHTML = "";

  labels.forEach((label, index) => {
    const item = document.createElement("div");
    item.className = "prediction-item";
    item.id = `prediction-${index}`;
    item.innerHTML = `
            <div class="prediction-header">
                <span class="prediction-label">${label}</span>
                <span class="prediction-percentage">0%</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar" style="width: 0%">0%</div>
            </div>
        `;
    predictionsEl.appendChild(item);
  });
}

// Update prediction UI
function updatePredictionUI(predictions) {
  predictions.forEach((prediction, index) => {
    const item = document.getElementById(`prediction-${index}`);
    const percentageEl = item.querySelector(".prediction-percentage");
    const progressBar = item.querySelector(".progress-bar");
    const percentage = Math.round(prediction.probability * 100);

    percentageEl.textContent = `${percentage}%`;
    progressBar.style.width = `${percentage}%`;
    progressBar.textContent = `${percentage}%`;

    // Highlight the highest prediction
    if (percentage > 50) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Find and highlight the top prediction
  const sortedPredictions = [...predictions].sort(
    (a, b) => b.probability - a.probability
  );
  const topPrediction = sortedPredictions[0];
  const topIndex = predictions.indexOf(topPrediction);

  // Remove active class from all items
  document.querySelectorAll(".prediction-item").forEach((item) => {
    item.classList.remove("active");
  });

  // Add active class to top prediction
  if (topPrediction.probability > 0.1) {
    const topItem = document.getElementById(`prediction-${topIndex}`);
    topItem.classList.add("active");
  }
}

// Start webcam and prediction loop
async function start() {
  try {
    statusEl.textContent = "Đang khởi động camera...";
    statusEl.classList.add("loading");

    // Setup webcam using tmPose.Webcam
    const flip = true; // whether to flip the webcam
    webcam = new tmPose.Webcam(640, 480, flip);
    await webcam.setup();
    await webcam.play();

    // Setup canvas for drawing pose overlay
    canvas = canvasEl;
    canvas.width = 640;
    canvas.height = 480;
    ctx = canvas.getContext("2d");

    // Connect webcam canvas stream to video element for display
    if (webcam.canvas) {
      try {
        const stream = webcam.canvas.captureStream(30);
        videoEl.srcObject = stream;
        videoEl.play().catch((err) => {
          console.error("Video play error:", err);
        });
      } catch (err) {
        console.error("Stream capture error:", err);
        // Fallback: hide video and show canvas only
        videoEl.style.display = "none";
      }
    }

    isRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = "Đang chạy";
    statusEl.classList.remove("loading");
    statusEl.style.background = "rgba(40, 167, 69, 0.8)";

    // Start prediction loop
    loop();

    console.log("Webcam started");
  } catch (error) {
    console.error("Error starting webcam:", error);
    statusEl.textContent = "Lỗi camera: " + error.message;
    statusEl.style.background = "rgba(220, 53, 69, 0.8)";
    isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

// Stop webcam
function stop() {
  if (webcam) {
    webcam.stop();
  }
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  // Stop video stream
  if (videoEl.srcObject) {
    const tracks = videoEl.srcObject.getTracks();
    tracks.forEach((track) => track.stop());
    videoEl.srcObject = null;
  }

  isRunning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = "Đã dừng";
  statusEl.style.background = "rgba(0, 0, 0, 0.7)";

  // Clear canvas
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Reset predictions
  document.querySelectorAll(".prediction-item").forEach((item) => {
    item.classList.remove("active");
    const percentageEl = item.querySelector(".prediction-percentage");
    const progressBar = item.querySelector(".progress-bar");
    percentageEl.textContent = "0%";
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
  });
}

// Main prediction loop
async function loop() {
  if (!isRunning) return;

  webcam.update(); // update the webcam frame
  await predict();
  animationId = window.requestAnimationFrame(loop);
}

// Run prediction
async function predict() {
  if (!model || !webcam || !webcam.canvas) {
    console.warn("Model or webcam not ready");
    return;
  }

  try {
    // Prediction #1: run input through posenet
    const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);

    // Prediction #2: run input through teachable machine classification model
    const prediction = await model.predict(posenetOutput);

    // Draw pose keypoints and skeleton
    drawPose(pose);

    // Update UI with predictions
    updatePredictionUI(prediction);
  } catch (error) {
    console.error("Prediction error:", error);
  }
}

// Draw pose keypoints and skeleton
function drawPose(pose) {
  if (!ctx || !canvas || !pose) return;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the webcam video frame first (from webcam canvas which has the video)
  if (webcam && webcam.canvas) {
    try {
      ctx.drawImage(webcam.canvas, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      console.error("Error drawing webcam canvas:", err);
    }
  }

  // Draw keypoints
  if (pose.keypoints) {
    for (let i = 0; i < pose.keypoints.length; i++) {
      const keypoint = pose.keypoints[i];
      if (keypoint.score > 0.5) {
        ctx.beginPath();
        ctx.arc(keypoint.x, keypoint.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "#00f2fe";
        ctx.fill();
      }
    }
  }

  // Draw skeleton
  if (pose.keypoints) {
    const adjacentKeyPoints = [
      ["nose", "leftEye"],
      ["nose", "rightEye"],
      ["leftEye", "leftEar"],
      ["rightEye", "rightEar"],
      ["leftShoulder", "rightShoulder"],
      ["leftShoulder", "leftElbow"],
      ["leftElbow", "leftWrist"],
      ["rightShoulder", "rightElbow"],
      ["rightElbow", "rightWrist"],
      ["leftShoulder", "leftHip"],
      ["rightShoulder", "rightHip"],
      ["leftHip", "rightHip"],
      ["leftHip", "leftKnee"],
      ["leftKnee", "leftAnkle"],
      ["rightHip", "rightKnee"],
      ["rightKnee", "rightAnkle"],
    ];

    adjacentKeyPoints.forEach(([first, second]) => {
      const firstPoint = pose.keypoints.find((kp) => kp.name === first);
      const secondPoint = pose.keypoints.find((kp) => kp.name === second);

      if (
        firstPoint &&
        secondPoint &&
        firstPoint.score > 0.5 &&
        secondPoint.score > 0.5
      ) {
        ctx.beginPath();
        ctx.moveTo(firstPoint.x, firstPoint.y);
        ctx.lineTo(secondPoint.x, secondPoint.y);
        ctx.strokeStyle = "#4facfe";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  }

  ctx.restore();
}

// Event listeners
startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

// Initialize on page load
init();
