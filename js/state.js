/* ==========================================================================
   GLOBAL VARIABLE DECLARATIONS (コード序盤でまとめて宣言)
   ========================================================================== */
// Configuration & Parameters State
let sketchParameters = {
    knifeTurnsPerSecond: 1.0, // ナイフが1秒あたりに回る平均周数 (ループ周期は巻き数とこの値から算出)
    spiralTurnCount: 8.0,
    peelRibbonWidth: 0.28,
    peelCurlCurvature: 1.20,
    peelThicknessRatio: 0.032, // 剥く皮のごく薄い厚み比率 (約3.2%)
    autoRotationSpeed: 1.0,
    grainIntensity: 0.35,
    backgroundColorHex: "#0d1117",
    appleSkinColorHex: "#c81d25",
    appleFleshColorHex: "#f6ebc6",
    appleStemColorHex: "#57361e",
    activePaletteTitle: "普通のリンゴ",
    surfaceTextureStyle: "apple", // 果皮・果肉の模様の種類 (SURFACE_TEXTURE_STYLES のキー)
    autoRandomEnabled: false,
    autoRandomIntervalMilliseconds: 12000,
    isKnifeVisible: true,
    knifeScale: 1.0,
    knifeMotionMode: "moving" // "moving" (ナイフが巡る) または "fixed" (ナイフ固定でリンゴ回転)
};

// Loop Clock (周期が変わっても位相が連続するよう時刻オフセットを保持)
let loopClockDurationMilliseconds = null;
let loopClockOffsetMilliseconds = 0;
// 自転 (1ループあたりの整数回転数と、回転数が変わったときに角度を保つオフセット)
let sceneRotationTurnsPerLoop = null;
let sceneRotationOffsetAngle = 0;

// Undo & Redo History Buffers
const undoHistoryStack = [];
const redoHistoryStack = [];
const MAXIMUM_HISTORY_CAPACITY = 30;

// Procedural Textures & Shading Resources
let appleSkinProceduralTexture = null;
let appleFleshProceduralTexture = null;
let grainNoiseOverlayTexture = null;

// Video Recording Architecture (60fps mp4, WebCodecs + mp4-muxer)
let recordingSession = null; // エンコーダ・マルチプレクサ・作業用キャンバスなど録画1回分の状態
let isRecordingActive = false;
let recordingStartTimestamp = 0;
let recordingTimerIntervalId = null;
let targetRecordingLoopCount = 0;
let offlineRenderTimestamp = null; // 指定ループ数録画のオフライン描画中だけ、millis() の代わりに使う時刻

// UI Auto-Hide Inactivity Timer
let userInactivityTimeoutId = null;
const INACTIVITY_DELAY_MILLISECONDS = 4500;
let isSidebarPanelOpened = true;

// Debug & Performance Variables
let isDebugModeEnabled = false;
let renderedVertexCount = 0;

// Audio Engine (Tone.js Synthetic ASMR Peeler)
let isAudioEngineStarted = false;
let isPeelingAudioMuted = false; // 既定でオン (ブラウザの自動再生制限により最初の操作で発音を開始)
let isReleasePopSoundEnabled = false; // 皮が切れる瞬間のポップ音 (既定でオフ)
let peelingNoiseSource = null;
let peelingFilter = null;
let peelingGain = null;
let recursionPopSynth = null;
let lastAudioPeelingState = null;

// Periodic Randomization Interval Variable
let autoRandomTimerId = null;
