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
    // バッファ自身の寸法に合わせた既定カメラ・透視投影を明示的に設定 (メインキャンバス基準の視点を引き継がないようにする)
    const defaultEyeDistance = (exportTargetHeight / 2) / Math.tan(Math.PI / 6);
    highResolutionGraphics.camera(0, 0, defaultEyeDistance, 0, 0, 0, 0, 1, 0);
    highResolutionGraphics.perspective(Math.PI / 3, exportTargetWidth / exportTargetHeight, defaultEyeDistance / 10, defaultEyeDistance * 10);

    // 背景描画
    const backgroundRgb = convertHexToRgb(sketchParameters.backgroundColorHex);
    highResolutionGraphics.background(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b);

    // 現在の瞬間をそのままフリーズし、画面と同一のシーン (ナイフ・剥けた皮・視点モード含む) を高解像度で描画
    const currentTimestamp = millis();
    const sceneState = computePeelSceneState(currentTimestamp);
    renderAppleScene(highResolutionGraphics, sceneState, exportTargetWidth, exportTargetHeight);

    // 画像保存 (保存後はオフスクリーンバッファを解放)
    save(highResolutionGraphics, `${baseFileIdentifier}.png`);
    highResolutionGraphics.remove();

    // 同名でパラメータJSONファイルをダウンロード出力
    exportParametersToJsonFile(`${baseFileIdentifier}.json`);

    console.log(`[High-Res Export] Successfully exported ${baseFileIdentifier}.png + JSON`);
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
                const importedParameters = Object.assign({}, parsedConfiguration.parameters);
                // 旧形式 (ループ周期を直接保存) はナイフの速さへ換算する
                if (importedParameters.knifeTurnsPerSecond === undefined && importedParameters.loopDurationMilliseconds) {
                    const turnCount = importedParameters.spiralTurnCount || sketchParameters.spiralTurnCount;
                    const peelSeconds = importedParameters.loopDurationMilliseconds / 1000 / 2 * PEEL_PORTION_OF_HALF_PHASE;
                    importedParameters.knifeTurnsPerSecond = Number((turnCount / peelSeconds).toFixed(1));
                }
                delete importedParameters.loopDurationMilliseconds;
                sketchParameters = Object.assign({}, sketchParameters, importedParameters);
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
