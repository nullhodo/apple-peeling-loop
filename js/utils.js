/* ==========================================================================
   UTILITY FUNCTIONS (日時フォーマット & 色変換)
   ========================================================================== */
/**
 * 現在の日時を指定書式 (CCYY_MMDD_hhmmss) に整形して返す関数
 * @returns {string} フォーマットされた日付時刻文字列
 */
function getFormattedDate() {
    const currentDateTime = new Date();
    const yearValue = currentDateTime.getFullYear();
    const monthValue = String(currentDateTime.getMonth() + 1).padStart(2, '0');
    const dayValue = String(currentDateTime.getDate()).padStart(2, '0');
    const hourValue = String(currentDateTime.getHours()).padStart(2, '0');
    const minuteValue = String(currentDateTime.getMinutes()).padStart(2, '0');
    const secondValue = String(currentDateTime.getSeconds()).padStart(2, '0');
    return `${yearValue}_${monthValue}${dayValue}_${hourValue}${minuteValue}${secondValue}`;
}

/**
 * HEXカラーコードをRGBオブジェクトに変換する関数
 * @param {string} hexadecimalColorString 
 * @returns {{r: number, g: number, b: number}}
 */
function convertHexToRgb(hexadecimalColorString) {
    let sanitizedHex = hexadecimalColorString.replace('#', '');
    if (sanitizedHex.length === 3) {
        sanitizedHex = sanitizedHex.split('').map(character => character + character).join('');
    }
    const integerColor = parseInt(sanitizedHex, 16);
    return {
        r: (integerColor >> 16) & 255,
        g: (integerColor >> 8) & 255,
        b: integerColor & 255
    };
}

/**
 * 2つのHEXカラーを補間してグラデーションカラーを生成する関数
 * @param {string} startHex 
 * @param {string} endHex 
 * @param {number} interpolationFactor (0.0 - 1.0)
 * @returns {string} HEXカラーコード
 */
function interpolateHexColors(startHex, endHex, interpolationFactor) {
    const startRgb = convertHexToRgb(startHex);
    const endRgb = convertHexToRgb(endHex);
    const finalR = Math.round(startRgb.r + (endRgb.r - startRgb.r) * interpolationFactor);
    const finalG = Math.round(startRgb.g + (endRgb.g - startRgb.g) * interpolationFactor);
    const finalB = Math.round(startRgb.b + (endRgb.b - startRgb.b) * interpolationFactor);
    return `#${((1 << 24) + (finalR << 16) + (finalG << 8) + finalB).toString(16).slice(1)}`;
}
