/* ==========================================================================
   USER INTERFACE EVENT LISTENERS & INACTIVITY AUTO-HIDE
   ========================================================================== */
/**
 * UI全体のイベントリスナーおよび自動格納タイマーをセットアップする関数
 */
function setupUserInterfaceEventListeners() {
    // パレットドロップダウンの初期生成 (各パレットの色グラデーションを背景に反映)
    const paletteSelectElement = document.getElementById('select-palette');
    applicationColorPalettes.forEach((paletteItem, paletteIndex) => {
        const optionElement = document.createElement('option');
        optionElement.value = paletteIndex;
        optionElement.innerText = `${paletteItem.title} (${paletteItem.comment})`;

        // オプション背景にパレット色のストライプグラデーションを適用
        const gradientColorStops = paletteItem.colors.map((colorItem, colorIndex) => {
            const startPercentage = (colorIndex / paletteItem.colors.length) * 100;
            const endPercentage = ((colorIndex + 1) / paletteItem.colors.length) * 100;
            return `${colorItem.hex} ${startPercentage.toFixed(1)}%, ${colorItem.hex} ${endPercentage.toFixed(1)}%`;
        }).join(', ');
        optionElement.style.background = `linear-gradient(to right, ${gradientColorStops})`;
        optionElement.style.color = '#ffffff';
        optionElement.style.textShadow = '0 1px 3px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.8)';
        optionElement.style.fontWeight = 'bold';
        optionElement.style.padding = '4px 8px';

        paletteSelectElement.appendChild(optionElement);
    });
    paletteSelectElement.addEventListener('change', (event) => {
        applyColorPaletteByIndex(Number(event.target.value));
    });
    renderPaletteSwatchesDisplay(applicationColorPalettes[0]);

    // パレットランダム選択ボタン
    document.getElementById('random-palette-button').addEventListener('click', () => {
        const randomIndex = Math.floor(random(applicationColorPalettes.length));
        paletteSelectElement.selectedIndex = randomIndex;
        applyColorPaletteByIndex(randomIndex);
    });

    // 単色グラデーションテーマ生成
    document.getElementById('apply-gradient-button').addEventListener('click', () => {
        const seedColor = document.getElementById('picker-seed-color').value;
        generateGradientThemeFromSeedColor(seedColor);
    });

    // スライダー群のイベントバインディング
    bindSliderToParameter('slider-knife-speed', 'label-knife-speed', 'knifeTurnsPerSecond', false);
    // 速さ・巻き数を変えるとループ周期が変わるため、周期表示も更新する
    for (const sliderId of ['slider-knife-speed', 'slider-spiral-turns']) {
        document.getElementById(sliderId).addEventListener('input', refreshLoopDurationLabel);
    }
    refreshLoopDurationLabel();
    bindSliderToParameter('slider-spiral-turns', 'label-spiral-turns', 'spiralTurnCount', false);
    bindSliderToParameter('slider-peel-width', 'label-peel-width', 'peelRibbonWidth', false);
    bindSliderToParameter('slider-peel-curl', 'label-peel-curl', 'peelCurlCurvature', false);
    bindSliderToParameter('slider-rotation-speed', 'label-rotation-speed', 'autoRotationSpeed', false);
    bindSliderToParameter('slider-grain-intensity', 'label-grain-intensity', 'grainIntensity', false);
    bindSliderToParameter('slider-knife-scale', 'label-knife-scale', 'knifeScale', false);

    // ナイフ動作モード切替ボタン
    const buttonModeMoving = document.getElementById('button-mode-moving');
    const buttonModeFixed = document.getElementById('button-mode-fixed');

    buttonModeMoving.addEventListener('click', () => {
        setKnifeMotionMode('moving');
    });
    buttonModeFixed.addEventListener('click', () => {
        setKnifeMotionMode('fixed');
    });

    // ナイフ表示切替チェックボックス
    document.getElementById('toggle-knife-visibility').addEventListener('change', (event) => {
        sketchParameters.isKnifeVisible = event.target.checked;
        pushUndoSnapshot();
    });

    // カラーピッカー群
    bindColorPickerToParameter('picker-background', 'text-background', 'backgroundColorHex');
    bindColorPickerToParameter('picker-skin', 'text-skin', 'appleSkinColorHex', true);
    bindColorPickerToParameter('picker-flesh', 'text-flesh', 'appleFleshColorHex', true);
    bindColorPickerToParameter('picker-stem', 'text-stem', 'appleStemColorHex', false);

    // Undo / Redo
    document.getElementById('undo-button').addEventListener('click', executeUndoAction);
    document.getElementById('redo-button').addEventListener('click', executeRedoAction);

    // デバッグトグル
    document.getElementById('debug-toggle-button').addEventListener('click', toggleDebugMode);

    // サウンドトグル & ボリューム
    document.getElementById('toggle-audio-button').addEventListener('click', () => {
        if (!isAudioEngineStarted) {
            initializeAudioSynthesizers();
        }
        isPeelingAudioMuted = !isPeelingAudioMuted;
        const toggleButton = document.getElementById('toggle-audio-button');
        const soundIcon = document.getElementById('audio-status-icon');

        if (!isPeelingAudioMuted) {
            toggleButton.innerText = "Sound OFF";
            toggleButton.classList.replace('bg-sky-900/60', 'bg-rose-900/60');
            soundIcon.className = "fa-solid fa-volume-high text-sky-400";
            if (Tone.context.state !== 'running') {
                Tone.start();
            }
        } else {
            toggleButton.innerText = "Sound ON";
            toggleButton.classList.replace('bg-rose-900/60', 'bg-sky-900/60');
            soundIcon.className = "fa-solid fa-volume-xmark text-slate-400";
        }
    });

    document.getElementById('slider-volume').addEventListener('input', (event) => {
        if (Tone.Destination) {
            Tone.Destination.volume.value = Number(event.target.value);
        }
    });

    // ランダム機能
    document.getElementById('apply-random-button').addEventListener('click', executeSelectiveRandomization);
    document.getElementById('toggle-auto-random').addEventListener('change', (event) => {
        toggleAutoRandomIntervalMode(event.target.checked);
    });
    document.getElementById('slider-auto-random-ms').addEventListener('input', (event) => {
        const intervalValue = Number(event.target.value);
        document.getElementById('label-auto-random-ms').innerText = intervalValue;
        sketchParameters.autoRandomIntervalMilliseconds = intervalValue;
        if (sketchParameters.autoRandomEnabled) {
            toggleAutoRandomIntervalMode(true);
        }
    });

    // エクスポート & 録画
    document.getElementById('export-image-button').addEventListener('click', exportHighResolutionSnapshot);
    document.getElementById('record-start-button').addEventListener('click', () => startRecordingPipeline(0));
    document.getElementById('record-stop-button').addEventListener('click', stopRecordingPipeline);
    document.getElementById('record-n-loops-button').addEventListener('click', () => {
        const loopCount = Number(document.getElementById('select-record-loops').value);
        startRecordingPipeline(loopCount);
    });

    // JSON保存 & 復元
    document.getElementById('export-json-button').addEventListener('click', () => exportParametersToJsonFile());
    document.getElementById('file-input-json').addEventListener('change', (event) => {
        if (event.target.files.length > 0) {
            importParametersFromJsonFile(event.target.files[0]);
        }
    });

    // サイドバー開閉トグルボタン
    document.getElementById('toggle-sidebar-button').addEventListener('click', toggleSidebarVisibility);

    // しばらく無操作の場合にサイドバーを自動格納する監視処理
    setupUserInactivityAutoHide();

    // キーボードショートカット
    window.addEventListener('keydown', handleGlobalKeyboardShortcuts);
}

/**
 * スライダー要素を変数にバインドするヘルパー関数
 * @param {string} sliderId 
 * @param {string} labelId 
 * @param {string} parameterKey 
 * @param {boolean} isInteger 
 */
function bindSliderToParameter(sliderId, labelId, parameterKey, isInteger) {
    const sliderElement = document.getElementById(sliderId);
    sliderElement.addEventListener('input', (event) => {
        const numericalValue = isInteger ? parseInt(event.target.value, 10) : parseFloat(event.target.value);
        document.getElementById(labelId).innerText = numericalValue;
        sketchParameters[parameterKey] = numericalValue;
    });
    sliderElement.addEventListener('change', () => {
        pushUndoSnapshot();
    });
}

/**
 * カラーピッカー要素を変数にバインドするヘルパー関数
 * @param {string} pickerId 
 * @param {string} labelId 
 * @param {string} parameterKey 
 * @param {boolean} shouldRegenerateTexture 
 */
function bindColorPickerToParameter(pickerId, labelId, parameterKey, shouldRegenerateTexture) {
    const colorPickerElement = document.getElementById(pickerId);
    colorPickerElement.addEventListener('input', (event) => {
        const selectedHex = event.target.value;
        document.getElementById(labelId).innerText = selectedHex;
        sketchParameters[parameterKey] = selectedHex;
        if (shouldRegenerateTexture) {
            generateProceduralTextures();
        }
    });
    colorPickerElement.addEventListener('change', () => {
        pushUndoSnapshot();
    });
}

/**
 * 巻き数とナイフの速さから決まるループ周期 (秒) を表示する関数
 */
function refreshLoopDurationLabel() {
    document.getElementById('label-loop-duration').innerText = (getLoopDurationMilliseconds() / 1000).toFixed(1);
}

/**
 * スケッチパラメータの変更を全UI要素に反映・同期する関数
 */
function synchronizeControlsFromParameters() {
    document.getElementById('slider-knife-speed').value = sketchParameters.knifeTurnsPerSecond;
    document.getElementById('label-knife-speed').innerText = sketchParameters.knifeTurnsPerSecond;
    refreshLoopDurationLabel();

    document.getElementById('slider-spiral-turns').value = sketchParameters.spiralTurnCount;
    document.getElementById('label-spiral-turns').innerText = sketchParameters.spiralTurnCount;

    document.getElementById('slider-peel-width').value = sketchParameters.peelRibbonWidth;
    document.getElementById('label-peel-width').innerText = sketchParameters.peelRibbonWidth;

    document.getElementById('slider-peel-curl').value = sketchParameters.peelCurlCurvature;
    document.getElementById('label-peel-curl').innerText = sketchParameters.peelCurlCurvature;

    document.getElementById('slider-rotation-speed').value = sketchParameters.autoRotationSpeed;
    document.getElementById('label-rotation-speed').innerText = sketchParameters.autoRotationSpeed;

    document.getElementById('slider-grain-intensity').value = sketchParameters.grainIntensity;
    document.getElementById('label-grain-intensity').innerText = sketchParameters.grainIntensity;

    document.getElementById('slider-knife-scale').value = sketchParameters.knifeScale;
    document.getElementById('label-knife-scale').innerText = sketchParameters.knifeScale;
    document.getElementById('toggle-knife-visibility').checked = sketchParameters.isKnifeVisible;

    updateKnifeMotionModeUI();
    updateColorPickerInputsUI();
}

/**
 * ナイフ動作モードの切り替え関数
 * @param {string} targetMode "moving" または "fixed"
 */
function setKnifeMotionMode(targetMode) {
    if (sketchParameters.knifeMotionMode === targetMode) return;
    sketchParameters.knifeMotionMode = targetMode;
    updateKnifeMotionModeUI();
    pushUndoSnapshot();
    console.log(`[Motion Mode] Switched knife motion mode to: ${targetMode}`);
}

/**
 * ナイフ動作モードUIのボタンスタイルを更新する関数
 */
function updateKnifeMotionModeUI() {
    const buttonModeMoving = document.getElementById('button-mode-moving');
    const buttonModeFixed = document.getElementById('button-mode-fixed');

    if (sketchParameters.knifeMotionMode === 'fixed') {
        buttonModeFixed.className = "py-1 px-2 rounded font-medium transition bg-amber-500 text-slate-950 shadow flex items-center justify-center gap-1";
        buttonModeMoving.className = "py-1 px-2 rounded font-medium transition text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center gap-1";
    } else {
        buttonModeMoving.className = "py-1 px-2 rounded font-medium transition bg-amber-500 text-slate-950 shadow flex items-center justify-center gap-1";
        buttonModeFixed.className = "py-1 px-2 rounded font-medium transition text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center gap-1";
    }
}

/**
 * カラーピッカー群のUI表示値を更新する関数
 */
function updateColorPickerInputsUI() {
    document.getElementById('picker-background').value = sketchParameters.backgroundColorHex;
    document.getElementById('text-background').innerText = sketchParameters.backgroundColorHex;

    document.getElementById('picker-skin').value = sketchParameters.appleSkinColorHex;
    document.getElementById('text-skin').innerText = sketchParameters.appleSkinColorHex;

    document.getElementById('picker-flesh').value = sketchParameters.appleFleshColorHex;
    document.getElementById('text-flesh').innerText = sketchParameters.appleFleshColorHex;

    document.getElementById('picker-stem').value = sketchParameters.appleStemColorHex;
    document.getElementById('text-stem').innerText = sketchParameters.appleStemColorHex;
}

/**
 * サイドバーの開閉状態を切り替える関数
 */
function toggleSidebarVisibility() {
    const sidebarPanelElement = document.getElementById('sidebar-panel');
    const toggleIconElement = document.getElementById('toggle-sidebar-icon');
    isSidebarPanelOpened = !isSidebarPanelOpened;

    if (isSidebarPanelOpened) {
        sidebarPanelElement.classList.remove('-translate-x-full');
        toggleIconElement.className = "fa-solid fa-sliders text-lg";
        resetUserInactivityTimer();
    } else {
        sidebarPanelElement.classList.add('-translate-x-full');
        toggleIconElement.className = "fa-solid fa-bars text-lg";
    }
}

/**
 * 一定時間の無操作でUIを自動格納する監視タイマー関数
 */
function setupUserInactivityAutoHide() {
    const resetInactivityHandler = () => {
        if (!isSidebarPanelOpened) return;
        resetUserInactivityTimer();
    };

    window.addEventListener('mousemove', resetInactivityHandler);
    window.addEventListener('mousedown', resetInactivityHandler);
    window.addEventListener('touchstart', resetInactivityHandler);

    // サイドバー上にマウスがある時は自動格納を一時停止
    const sidebarElement = document.getElementById('sidebar-panel');
    sidebarElement.addEventListener('mouseenter', () => {
        if (userInactivityTimeoutId) clearTimeout(userInactivityTimeoutId);
    });
    sidebarElement.addEventListener('mouseleave', () => {
        resetUserInactivityTimer();
    });

    resetUserInactivityTimer();
}

/**
 * 無操作タイマーをリセットする関数
 */
function resetUserInactivityTimer() {
    if (userInactivityTimeoutId) clearTimeout(userInactivityTimeoutId);
    userInactivityTimeoutId = setTimeout(() => {
        if (isSidebarPanelOpened) {
            toggleSidebarVisibility();
            console.log("[UI] Auto-hidden due to user inactivity.");
        }
    }, INACTIVITY_DELAY_MILLISECONDS);
}

/**
 * デバッグモードのON/OFF切り替え関数
 */
function toggleDebugMode() {
    isDebugModeEnabled = !isDebugModeEnabled;
    const debugHudElement = document.getElementById('debug-hud');
    if (isDebugModeEnabled) {
        debugHudElement.classList.remove('hidden');
    } else {
        debugHudElement.classList.add('hidden');
    }
}

/**
 * デバッグHUDの表示情報をリアルタイム更新する関数
 * @param {number} loopPhase 
 * @param {number} scaleFactor 
 */
function updateDebugInformationOverlay(loopPhase, scaleFactor) {
    document.getElementById('debug-fps').innerText = Math.round(frameRate());
    document.getElementById('debug-phase').innerText = loopPhase.toFixed(3);
    document.getElementById('debug-scale').innerText = scaleFactor.toFixed(3);
    document.getElementById('debug-vertices').innerText = renderedVertexCount;

    const peelStateLabel = document.getElementById('debug-peel-state');
    if (loopPhase < 0.5) {
        peelStateLabel.innerText = "Skin Peeling (Red -> Flesh)";
        peelStateLabel.className = "text-rose-400";
    } else {
        peelStateLabel.innerText = "Flesh Peeling (Flesh -> New Apple)";
        peelStateLabel.className = "text-amber-300";
    }
}

/**
 * キーボードショートカットのディスパッチ関数
 * @param {KeyboardEvent} keyboardEvent 
 */
function handleGlobalKeyboardShortcuts(keyboardEvent) {
    // 入力フォーム内での打鍵は除外
    if (keyboardEvent.target.tagName === 'INPUT' || keyboardEvent.target.tagName === 'SELECT') {
        return;
    }

    const pressedKey = keyboardEvent.key.toUpperCase();

    // R: 録画開始
    if (pressedKey === 'R' && !keyboardEvent.ctrlKey && !keyboardEvent.metaKey) {
        keyboardEvent.preventDefault();
        startRecordingPipeline(0);
    }
    // S: 録画停止
    else if (pressedKey === 'S' && !keyboardEvent.ctrlKey && !keyboardEvent.metaKey) {
        keyboardEvent.preventDefault();
        stopRecordingPipeline();
    }
    // U または Tab: UI開閉
    else if (pressedKey === 'U' || keyboardEvent.key === 'Tab') {
        keyboardEvent.preventDefault();
        toggleSidebarVisibility();
    }
    // D: デバッグモード切替
    else if (pressedKey === 'D') {
        keyboardEvent.preventDefault();
        toggleDebugMode();
    }
    // M: ナイフ固定 / 移動切替
    else if (pressedKey === 'M') {
        keyboardEvent.preventDefault();
        setKnifeMotionMode(sketchParameters.knifeMotionMode === 'moving' ? 'fixed' : 'moving');
    }
    // Ctrl+Z: Undo
    else if (pressedKey === 'Z' && (keyboardEvent.ctrlKey || keyboardEvent.metaKey) && !keyboardEvent.shiftKey) {
        keyboardEvent.preventDefault();
        executeUndoAction();
    }
    // Ctrl+Y または Ctrl+Shift+Z: Redo
    else if ((pressedKey === 'Y' && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) ||
             (pressedKey === 'Z' && (keyboardEvent.ctrlKey || keyboardEvent.metaKey) && keyboardEvent.shiftKey)) {
        keyboardEvent.preventDefault();
        executeRedoAction();
    }
}
