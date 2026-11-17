/* ==========================================================================
   GLOBAL VARIABLE DECLARATIONS (コード序盤でまとめて宣言)
   ========================================================================== */
// Configuration & Parameters State
let sketchParameters = {
    loopDurationMilliseconds: 6000,
    spiralTurnCount: 5.5,
    peelRibbonWidth: 0.28,
    peelCurlCurvature: 1.20,
    peelThicknessRatio: 0.032, // 剥く皮のごく薄い厚み比率 (約3.2%)
    autoRotationSpeed: 1.0,
    grainIntensity: 0.35,
    backgroundColorHex: "#0d1117",
    appleSkinColorHex: "#c81d25",
    appleFleshColorHex: "#fef08a",
    appleStemColorHex: "#57361e",
    activePaletteTitle: "Retro Sunny Living",
    autoRandomEnabled: false,
    autoRandomIntervalMilliseconds: 12000,
    isKnifeVisible: true,
    knifeScale: 1.0,
    knifeMotionMode: "moving" // "moving" (ナイフが巡る) または "fixed" (ナイフ固定でリンゴ回転)
};

// Undo & Redo History Buffers
const undoHistoryStack = [];
const redoHistoryStack = [];
const MAXIMUM_HISTORY_CAPACITY = 30;

// Procedural Textures & Shading Resources
let appleSkinProceduralTexture = null;
let appleFleshProceduralTexture = null;
let grainNoiseOverlayTexture = null;

// Video Recording Architecture (60fps High Bitrate)
let mediaStreamRecorder = null;
let recordedVideoDataChunks = [];
let isRecordingActive = false;
let recordingStartTimestamp = 0;
let recordingTimerIntervalId = null;
let targetRecordingLoopCount = 0;
let recordingInitialPhaseAccumulator = 0;

// UI Auto-Hide Inactivity Timer
let userInactivityTimeoutId = null;
const INACTIVITY_DELAY_MILLISECONDS = 4500;
let isSidebarPanelOpened = true;

// Debug & Performance Variables
let isDebugModeEnabled = false;
let renderedVertexCount = 0;

// Audio Engine (Tone.js Synthetic ASMR Peeler)
let isAudioEngineStarted = false;
let isPeelingAudioMuted = true;
let peelingNoiseSynth = null;
let peelingFilter = null;
let recursionPopSynth = null;
let lastPlayedHalfPhaseIndex = 0;

// Periodic Randomization Interval Variable
let autoRandomTimerId = null;
