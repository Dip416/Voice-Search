const searchInput = document.getElementById('searchInput');
const micBtn = document.getElementById('micBtn');
const statusText = document.getElementById('statusText');
const canvas = document.getElementById('waveCanvas');
const canvasCtx = canvas.getContext('2d');

// --- Configuration ---
// --- Configuration ---
// These are default values, but we will read from UI now
let currentConstraints = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};

const redirectDelay = 1500;

// --- State ---
let isListening = false;
let audioContext;
let analyser;
let microphone;
let animationId;
let stream; // Store globally to stop it properly

// --- DOM Elements for Settings ---
const noiseToggle = document.getElementById('noiseToggle');
const monitorToggle = document.getElementById('monitorToggle');

// Update constraints when toggles change (only if not currently listening, for simplicity)
// If listening, we'd need to restart the stream, which we can do.
noiseToggle.addEventListener('change', () => {
    currentConstraints.audio.noiseSuppression = noiseToggle.checked;
    currentConstraints.audio.echoCancellation = noiseToggle.checked; // Usually go together
    if (isListening) {
        restartStream();
    }
});

monitorToggle.addEventListener('change', () => {
    if (isListening) {
        if (monitorToggle.checked) {
            if (microphone && audioContext) microphone.connect(audioContext.destination);
        } else {
            if (microphone && audioContext) microphone.disconnect(audioContext.destination);
            // Reconnect to analyser only
            if (microphone && analyser) microphone.connect(analyser); 
        }
    }
});

async function restartStream() {
    stopVisualizer();
    await startVisualizer();
}

// --- Speech Recognition Setup ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
    statusText.textContent = "Your browser does not support Voice Search.";
    micBtn.disabled = true;
    micBtn.style.background = "#64748b"; // Grey out
} else {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    micBtn.addEventListener('click', toggleListening);

    function toggleListening() {
        if (isListening) {
            stopRecognition();
        } else {
            startRecognition();
        }
    }

    function startRecognition() {
        // 1. Start Audio Visualizer (User Media)
        startVisualizer().then(() => {
             // 2. Start Speech Recognition
            try {
                recognition.start();
            } catch (e) {
                console.error("Recognition already started", e);
            }

            // 3. UI Updates
            isListening = true;
            micBtn.classList.add('listening');
            micBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
            searchInput.value = '';
            searchInput.placeholder = "Listening...";
            statusText.textContent = "Go ahead, I'm listening...";
        });
    }

    function stopRecognition() {
        recognition.stop();
        stopVisualizer();
        resetUI();
    }

    function resetUI() {
        isListening = false;
        micBtn.classList.remove('listening');
        micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        // statusText.textContent = "Tap the microphone to start";
    }

    // --- Recognition Events ---
    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0])
            .map(result => result.transcript)
            .join('');

        searchInput.value = transcript;
        
        if (event.results[0].isFinal) {
            statusText.textContent = `Searching for: "${transcript}"`;
            stopVisualizer(); 
            handleSearch(transcript);
        }
    };

    recognition.onend = () => {
        if (isListening) {
            resetUI();
            statusText.textContent = "Tap the microphone to start";
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        stopVisualizer();
        resetUI();
        statusText.textContent = "Error: " + event.error;
    };
}

function handleSearch(query) {
    if (!query) return;
    
    setTimeout(() => {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        window.open(url, '_blank') || (window.location.href = url);
        statusText.textContent = "Redirecting...";
    }, redirectDelay);
}

// --- Audio Visualizer Logic ---
async function startVisualizer() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Get stream with dynamic constraints
        currentConstraints.audio.noiseSuppression = noiseToggle.checked;
        currentConstraints.audio.echoCancellation = noiseToggle.checked;
        
        stream = await navigator.mediaDevices.getUserMedia(currentConstraints);
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        // Monitor Audio Logic
        if (monitorToggle.checked) {
            microphone.connect(audioContext.destination);
        }
        
        drawWave();
    } catch (err) {
        console.error("Error accessing microphone for visualizer:", err);
        statusText.textContent = "Microphone access required for visuals.";
    }
}

function stopVisualizer() {
    if (animationId) cancelAnimationFrame(animationId);
    
    if (microphone) {
        microphone.disconnect(); 
        // Also disconnect from destination if connected
        if (monitorToggle.checked && audioContext) {
           // disconnect handled by disconnect() usually? 
           // disconnect() without args disconnects all outputs.
        }
    }
    
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    
    // Clear canvas
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawWave() {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Resize canvas to match display size
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;

    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    function renderFrame() {
        if (!isListening) return; // Stop drawing if not listening

        animationId = requestAnimationFrame(renderFrame);

        analyser.getByteFrequencyData(dataArray);

        canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

        // Styling the wave
        const barWidth = (WIDTH / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        // Use a gradient for the bars
        const gradient = canvasCtx.createLinearGradient(0, HEIGHT, 0, 0);
        gradient.addColorStop(0, '#3b82f6'); // Base color
        gradient.addColorStop(1, '#8b5cf6'); // Top color

        canvasCtx.fillStyle = gradient;

        // Draw bars (mirrored for a nice effect)
        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2; // Scale down
            
            // Center the visualization vertically
            const y = (HEIGHT - barHeight) / 2;
            
            // Rounded bars
            roundRect(canvasCtx, x, y, barWidth - 1, barHeight, 5);

            x += barWidth + 1;
        }
    }

    renderFrame();
}

// Helper for rounded rectangles on canvas
function roundRect(ctx, x, y, width, height, radius) {
    if (height < radius) radius = height / 2;
    if (width < radius) radius = width / 2;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
}
