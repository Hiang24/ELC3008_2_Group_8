const URL = "https://teachablemachine.withgoogle.com/models/meZmCHgZF/";
let model, webcam, ctx, labelContainer, maxPredictions;
let isRunning = false;

// Các Element giao diện
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const loader = document.getElementById('loader');
const placeholder = document.getElementById('camera-placeholder');
const canvasWrapper = document.getElementById('canvas-wrapper');

// Lắng nghe sự kiện nút bấm
startBtn.addEventListener('click', init);

async function init() {
    startBtn.classList.add('hidden');
    loader.classList.remove('hidden');
    statusText.innerText = "Loading...";

    try {
        const modelURL = URL + "model.json";
        const metadataURL = URL + "metadata.json";

        // 1. Load Model
        model = await tmPose.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();

        // 2. Setup Webcam
        const size = 200;
        const flip = true; 
        webcam = new tmPose.Webcam(size, size, flip); 
        await webcam.setup(); 
        await webcam.play();
        
        // 3. Setup Canvas
        canvasWrapper.classList.remove('hidden');
        placeholder.classList.add('hidden');
        loader.classList.add('hidden');
        
        const canvas = document.getElementById("canvas");
        canvas.width = size; 
        canvas.height = size;
        ctx = canvas.getContext("2d");
        
        setupLabels();
        statusText.innerText = "Active";
        statusText.className = "text-xs font-bold text-green-500";

        isRunning = true;
        window.requestAnimationFrame(loop);

    } catch (e) {
        console.error(e);
        loader.classList.add('hidden');
        startBtn.classList.remove('hidden');
        alert("Lỗi: " + e.message);
    }
}

function setupLabels() {
    labelContainer = document.getElementById("label-container");
    labelContainer.innerHTML = '';
    const classLabels = model.getClassLabels();

    for (let i = 0; i < maxPredictions; i++) {
        const name = classLabels[i] || `Pose ${i + 1}`;
        const div = document.createElement("div");
        div.className = "mb-2";
        div.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-bold text-slate-600 uppercase tracking-tight">${name}</span>
                <span class="text-xs font-mono text-violet-600 font-bold class-score-${i}">0%</span>
            </div>
            <div class="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                <div class="h-full rounded-full bg-violet-500 class-bar-${i}" style="width: 0%"></div>
            </div>
        `;
        labelContainer.appendChild(div);
    }
}

async function loop() {
    if (!isRunning) return;
    webcam.update(); 
    await predict();
    window.requestAnimationFrame(loop);
}

async function predict() {
    const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
    const prediction = await model.predict(posenetOutput);

    drawPose(pose);

    for (let i = 0; i < maxPredictions; i++) {
        const probability = prediction[i].probability;
        const percentage = (probability * 100).toFixed(0) + "%";
        
        const scoreEl = document.querySelector(`.class-score-${i}`);
        const barEl = document.querySelector(`.class-bar-${i}`);

        if (scoreEl) scoreEl.innerText = percentage;
        if (barEl) {
            barEl.style.width = percentage;
            if (probability > 0.8) {
                barEl.className = `h-full rounded-full bg-green-500 class-bar-${i}`; 
            } else {
                barEl.className = `h-full rounded-full bg-violet-500 class-bar-${i}`;
            }
        }
    }
}

function drawPose(pose) {
    if (webcam.canvas) {
        ctx.drawImage(webcam.canvas, 0, 0);
        if (pose) {
            const minPartConfidence = 0.5;
            tmPose.drawKeypoints(pose.keypoints, minPartConfidence, ctx);
            tmPose.drawSkeleton(pose.keypoints, minPartConfidence, ctx);
        }
    }
}