/* ==========================================================================
   RANDOMIZATION ARCHITECTURE (対象選択式 & オート周期ループ)
   ========================================================================== */
/**
 * チェックボックスで選択されたカテゴリのパラメータをランダム設定する関数
 */
function executeSelectiveRandomization() {
    pushUndoSnapshot();
    const shouldRandomizeGeometry = document.getElementById('check-rand-geometry').checked;
    const shouldRandomizeColor = document.getElementById('check-rand-color').checked;
    const shouldRandomizeSpeed = document.getElementById('check-rand-speed').checked;
    const shouldRandomizeGrain = document.getElementById('check-rand-grain').checked;

    if (shouldRandomizeGeometry) {
        sketchParameters.spiralTurnCount = Number((random(3.0, 8.5)).toFixed(1));
        sketchParameters.peelRibbonWidth = Number((random(0.18, 0.45)).toFixed(2));
        sketchParameters.peelCurlCurvature = Number((random(0.6, 2.0)).toFixed(1));
    }

    if (shouldRandomizeSpeed) {
        sketchParameters.knifeTurnsPerSecond = Number((random(0.5, 2.0)).toFixed(1));
        sketchParameters.autoRotationSpeed = Number((random(-2.0, 2.5)).toFixed(1));
    }

    if (shouldRandomizeGrain) {
        sketchParameters.grainIntensity = Number((random(0.1, 0.6)).toFixed(2));
    }

    if (shouldRandomizeColor) {
        const randomPaletteIndex = Math.floor(random(applicationColorPalettes.length));
        document.getElementById('select-palette').selectedIndex = randomPaletteIndex;
        applyColorPaletteByIndex(randomPaletteIndex);
    }

    synchronizeControlsFromParameters();
    console.log("[Randomizer] Selective parameters updated.");
}

/**
 * 周期的な自動ランダム化タイマーの起動/停止を制御する関数
 * @param {boolean} isEnabled 
 */
function toggleAutoRandomIntervalMode(isEnabled) {
    sketchParameters.autoRandomEnabled = isEnabled;
    if (autoRandomTimerId) {
        clearInterval(autoRandomTimerId);
        autoRandomTimerId = null;
    }

    if (isEnabled) {
        console.log(`[Auto Random] Enabled with interval ${sketchParameters.autoRandomIntervalMilliseconds}ms`);
        autoRandomTimerId = setInterval(() => {
            executeSelectiveRandomization();
        }, sketchParameters.autoRandomIntervalMilliseconds);
    } else {
        console.log("[Auto Random] Disabled.");
    }
}
