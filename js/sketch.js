/* ==========================================================================
   P5.JS CORE SETUP & DRAW LOOP
   ========================================================================== */
/**
 * p5.jsの初期化セットアップ関数
 */
function setup() {
    const canvasContainerElement = document.getElementById('canvas-container');
    const initialCanvasWidth = canvasContainerElement.clientWidth;
    const initialCanvasHeight = canvasContainerElement.clientHeight;

    const primaryCanvas = createCanvas(initialCanvasWidth, initialCanvasHeight, WEBGL);
    primaryCanvas.parent('canvas-container');
    pixelDensity(window.devicePixelRatio > 1 ? 2 : 1);

    generateProceduralTextures();
    pushUndoSnapshot(); // 初期状態をUndoスタックに保存
    setupUserInterfaceEventListeners();

    console.log(`[Setup] p5.js WebGL canvas initialized (${initialCanvasWidth}x${initialCanvasHeight}).`);
}

/**
 * ウィンドウリサイズハンドラ関数
 */
function windowResized() {
    const canvasContainerElement = document.getElementById('canvas-container');
    resizeCanvas(canvasContainerElement.clientWidth, canvasContainerElement.clientHeight);
    console.log(`[Window] Resized canvas to: ${width}x${height}`);
}

/**
 * メインの描画ループ関数
 */
function draw() {
    renderedVertexCount = 0;

    // 1. ループ進行度 (loopPhase: 0.0 - 1.0) の算出
    // 指定ループ数録画のオフライン描画中は、録画側が指定した時刻で描く
    const currentTimestamp = offlineRenderTimestamp ?? millis();
    const sceneState = computePeelSceneState(currentTimestamp);
    const loopPhase = sceneState.loopPhase;

    // オーディオ同期 (オフライン描画中は実時間と合わないため鳴らさない)
    if (offlineRenderTimestamp === null) updatePeelingAudioFeedback(sceneState);

    // 2. 背景描画
    const backgroundRgb = convertHexToRgb(sketchParameters.backgroundColorHex);
    background(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b);

    // 3-5. ライティング・視点制御・りんご本体 (剥離厚みと釣り合う微小スケール拡大でシームレスループ)
    renderAppleScene(p5.instance, sceneState, width, height);
    const balancedScaleFactor = sceneState.balancedScale;

    // 6. ポストプロセス: ざらついた質感 (フィルムグレイン) オーバーレイ
    if (sketchParameters.grainIntensity > 0.01) {
        renderPostProcessGrainFilter();
    }

    // 7. デバッグHUD情報更新
    if (isDebugModeEnabled) {
        updateDebugInformationOverlay(loopPhase, balancedScaleFactor);
    }

    // 8. 手動録画中はこのフレームをエンコーダへ送る
    captureRealtimeRecordingFrame();
}
