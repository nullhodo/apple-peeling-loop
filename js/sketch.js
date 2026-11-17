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
    const currentTimestamp = millis();
    const loopPhase = (currentTimestamp % sketchParameters.loopDurationMilliseconds) / sketchParameters.loopDurationMilliseconds;

    // オーディオ同期
    updatePeelingAudioFeedback(loopPhase);

    // 2. 背景描画
    const backgroundRgb = convertHexToRgb(sketchParameters.backgroundColorHex);
    background(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b);

    // 3. ライティング環境の構築 (柔らかなスタジオライティング)
    ambientLight(150, 150, 155);
    directionalLight(255, 250, 240, 0.7, -1.0, -0.6);
    directionalLight(120, 140, 180, -0.7, 0.8, 0.5);
    pointLight(255, 240, 220, 0, -250, 350);

    // 4. カメラ & 全体視点制御 (ナイフ移動 vs ナイフ固定モードの切り替え)
    push();

    const isPeelingFleshPhase = loopPhase >= 0.5;
    const localPhaseProgress = isPeelingFleshPhase ? (loopPhase - 0.5) * 2.0 : loopPhase * 2.0;

    const thinPeelThicknessRatio = sketchParameters.peelThicknessRatio;
    const balancedScaleFactor = 1.0 / (1.0 - thinPeelThicknessRatio * localPhaseProgress);

    const appleBaseRadius = 140;
    const spiralTurns = sketchParameters.spiralTurnCount;
    const knifeLatitude = constrain(0.04 + localPhaseProgress * 0.90, 0.04, 0.94);
    const knifeLongitude = (localPhaseProgress * TWO_PI * spiralTurns) % TWO_PI;

    if (sketchParameters.knifeMotionMode === "fixed") {
        // --- ナイフ固定モード (リンゴ側が自転・昇降してナイフに送られる) ---
        const contactPointUnrotated = calculateAppleSurfacePoint(knifeLatitude, knifeLongitude, appleBaseRadius);

        // 刃と接触面が最も見やすい斜め前方のアングルに構える
        rotateX(0.24);
        rotateY(Math.PI * 0.30);

        // 切削接触点を常に定点（画面中央の高さ）へ保つための相殺変換
        translate(0, -contactPointUnrotated.y, 0);
        rotateY(-knifeLongitude);
    } else {
        // --- ナイフ移動モード (リンゴは自転し、ナイフが周囲を巡る) ---
        const sceneRotationAngle = (currentTimestamp * 0.0006 * sketchParameters.autoRotationSpeed);
        rotateY(sceneRotationAngle);
        rotateX(0.28); // 緩やかな見下ろし角
    }

    // 5. 薄い皮の剥離厚み (約3.2%) と完全に釣り合う微小スケール拡大によるシームレスループ
    push();
    scale(balancedScaleFactor);
    renderRecursiveAppleEntity(localPhaseProgress, isPeelingFleshPhase);
    pop();

    pop();

    // 6. ポストプロセス: ざらついた質感 (フィルムグレイン) オーバーレイ
    if (sketchParameters.grainIntensity > 0.01) {
        renderPostProcessGrainFilter();
    }

    // 7. デバッグHUD情報更新
    if (isDebugModeEnabled) {
        updateDebugInformationOverlay(loopPhase, balancedScaleFactor);
    }

    // 8. ループ指定録画の進行監視
    if (isRecordingActive && targetRecordingLoopCount > 0) {
        const totalRecordingElapsedTime = currentTimestamp - recordingStartTimestamp;
        const targetDurationLimit = targetRecordingLoopCount * sketchParameters.loopDurationMilliseconds;
        if (totalRecordingElapsedTime >= targetDurationLimit) {
            console.log(`[Recorder] Exact ${targetRecordingLoopCount} loops reached. Stopping recording.`);
            stopRecordingPipeline();
        }
    }
}
