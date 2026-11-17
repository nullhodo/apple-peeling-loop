/* ==========================================================================
   UNDO / REDO STATE MANAGEMENT ENGINE
   ========================================================================== */
/**
 * 現在のパラメータのスナップショットをUndoスタックに保存する関数
 */
function pushUndoSnapshot() {
    const currentParametersSnapshot = JSON.stringify(sketchParameters);
    // 直前と同じ状態なら重複してプッシュしない
    if (undoHistoryStack.length > 0 && undoHistoryStack[undoHistoryStack.length - 1] === currentParametersSnapshot) {
        return;
    }

    undoHistoryStack.push(currentParametersSnapshot);
    if (undoHistoryStack.length > MAXIMUM_HISTORY_CAPACITY) {
        undoHistoryStack.shift();
    }
    // 新規アクション時はRedoスタックをクリア
    redoHistoryStack.length = 0;
    refreshUndoRedoButtonStates();
}

/**
 * 直前のパラメータ状態に戻す関数
 */
function executeUndoAction() {
    if (undoHistoryStack.length <= 1) return;

    const currentState = undoHistoryStack.pop();
    redoHistoryStack.push(currentState);

    const previousState = undoHistoryStack[undoHistoryStack.length - 1];
    sketchParameters = JSON.parse(previousState);

    synchronizeControlsFromParameters();
    generateProceduralTextures();
    refreshUndoRedoButtonStates();
    console.log("[History] Undo performed.");
}

/**
 * やり直す関数
 */
function executeRedoAction() {
    if (redoHistoryStack.length === 0) return;

    const nextState = redoHistoryStack.pop();
    undoHistoryStack.push(nextState);
    sketchParameters = JSON.parse(nextState);

    synchronizeControlsFromParameters();
    generateProceduralTextures();
    refreshUndoRedoButtonStates();
    console.log("[History] Redo performed.");
}

/**
 * Undo / Redo ボタンの有効/無効状態を更新する関数
 */
function refreshUndoRedoButtonStates() {
    document.getElementById('undo-button').disabled = (undoHistoryStack.length <= 1);
    document.getElementById('redo-button').disabled = (redoHistoryStack.length === 0);
}
