/* ==========================================================================
   HIGH RESOLUTION EXPORT ENGINE (スケーリング & 再配置 2560px+)
   ========================================================================== */
/**
 * 縦横1980px以上の高解像度画像をアスペクト比を維持して再レンダリングし書き出す関数
 * ファイル名形式: {スケッチタイトル}_{CCYY-MMDD-hhmmss}_{width}x{height}.png
 */
function exportHighResolutionSnapshot() {
    console.log("[High-Res Export] Commencing high resolution offscreen rendering...");
    const exportTargetWidth = 2560;
    const exportTargetHeight = 2560;
    const formattedDateString = getFormattedDate();
    const baseFileIdentifier = `RecursiveApple_${formattedDateString}_${exportTargetWidth}x${exportTargetHeight}`;

    // オフスクリーンWEBGLグラフィックスバッファの生成
    const highResolutionGraphics = createGraphics(exportTargetWidth, exportTargetHeight, WEBGL);
    highResolutionGraphics.pixelDensity(1);

    // 背景描画
    const backgroundRgb = convertHexToRgb(sketchParameters.backgroundColorHex);
    highResolutionGraphics.background(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b);

    // ライティング
    highResolutionGraphics.ambientLight(130, 130, 135);
    highResolutionGraphics.directionalLight(255, 250, 240, 0.7, -1.0, -0.6);
    highResolutionGraphics.directionalLight(120, 140, 180, -0.7, 0.8, 0.5);

    // 現在のループ進行度をそのままフリーズして高品質描画
    const currentProgress = (millis() % sketchParameters.loopDurationMilliseconds) / sketchParameters.loopDurationMilliseconds;

    highResolutionGraphics.push();
    highResolutionGraphics.rotateY((millis() * 0.0006 * sketchParameters.autoRotationSpeed));
    highResolutionGraphics.rotateX(0.28);

    // 高解像度スケールでりんごをレンダリング
    // (ここではhighResolutionGraphicsコンテキストに対して同一ロジックを適用)
    renderHighResolutionAppleScene(highResolutionGraphics, currentProgress);
    highResolutionGraphics.pop();

    // 画像保存
    save(highResolutionGraphics, `${baseFileIdentifier}.png`);

    // 同名でパラメータJSONファイルをダウンロード出力
    exportParametersToJsonFile(`${baseFileIdentifier}.json`);

    console.log(`[High-Res Export] Successfully exported ${baseFileIdentifier}.png + JSON`);
}

/**
 * オフスクリーン高解像度バッファ専用の描画パイプライン関数
 * @param {p5.Graphics} targetGraphics 
 * @param {number} loopPhase 
 */
function renderHighResolutionAppleScene(targetGraphics, loopPhase) {
    const isPeelingFleshPhase = loopPhase >= 0.5;
    const localPhaseProgress = isPeelingFleshPhase ? (loopPhase - 0.5) * 2.0 : loopPhase * 2.0;
    const thinPeelThicknessRatio = sketchParameters.peelThicknessRatio;
    const balancedScaleFactor = 1.0 / (1.0 - thinPeelThicknessRatio * localPhaseProgress);

    targetGraphics.push();
    targetGraphics.scale(balancedScaleFactor);

    targetGraphics.noStroke();
    targetGraphics.texture(isPeelingFleshPhase ? appleFleshProceduralTexture : appleSkinProceduralTexture);
    targetGraphics.sphere(140, 48, 48);

    // ヘタ
    targetGraphics.push();
    const stemRgb = convertHexToRgb(sketchParameters.appleStemColorHex);
    targetGraphics.fill(stemRgb.r, stemRgb.g, stemRgb.b);
    targetGraphics.translate(0, -140 * 0.92, 0);
    targetGraphics.cylinder(3.2, 34, 16, 1);
    targetGraphics.pop();

    targetGraphics.pop();
}

/* ==========================================================================
   JSON EXPORT & IMPORT ENGINE
   ========================================================================== */
/**
 * 現在のパラメータ設定をJSONファイルとして保存する関数
 * @param {string} fileName 
 */
function exportParametersToJsonFile(fileName = null) {
    const targetFileName = fileName || `ApplePeelParameters_${getFormattedDate()}.json`;
    const configurationPayload = {
        generator: "Recursive Apple Peel Engine",
        version: "1.0",
        timestamp: new Date().toISOString(),
        parameters: sketchParameters
    };

    const jsonBlob = new Blob([JSON.stringify(configurationPayload, null, 2)], { type: "application/json" });
    const temporaryAnchor = document.createElement('a');
    temporaryAnchor.href = URL.createObjectURL(jsonBlob);
    temporaryAnchor.download = targetFileName;
    document.body.appendChild(temporaryAnchor);
    temporaryAnchor.click();
    document.body.removeChild(temporaryAnchor);
    console.log(`[JSON Export] Parameters saved to ${targetFileName}`);
}

/**
 * ユーザーが選択したJSONファイルからパラメータを読み込みスケッチを復元する関数
 * @param {File} fileObject 
 */
function importParametersFromJsonFile(fileObject) {
    if (!fileObject) return;
    const fileReader = new FileReader();
    fileReader.onload = function (event) {
        try {
            const parsedConfiguration = JSON.parse(event.target.result);
            if (parsedConfiguration.parameters) {
                pushUndoSnapshot();
                sketchParameters = Object.assign({}, sketchParameters, parsedConfiguration.parameters);
                synchronizeControlsFromParameters();
                generateProceduralTextures();
                console.log("[JSON Import] Sketch parameters successfully restored.");
            }
        } catch (parseError) {
            console.error("[JSON Import] Invalid JSON structure: ", parseError);
        }
    };
    fileReader.readAsText(fileObject);
}
