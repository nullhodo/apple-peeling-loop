/* ==========================================================================
   PROCEDURAL TEXTURE GENERATION (解像感の高い果皮・果肉・微細ノイズ)
   ========================================================================== */
/*
 * 果皮・果肉テクスチャは (u = 周回 τ, v = 緯度) で貼られ、1周ごとに横方向へ繰り返す。
 * そのため横方向が継ぎ目なくつながるよう、ノイズは円柱面上の3次元座標でサンプリングする。
 * 色に依存しない模様 (マスク) は初回だけ計算してキャッシュし、色の変更時は合成のみやり直す。
 */
const APPLE_TEXTURE_WIDTH = 1024;
const APPLE_TEXTURE_HEIGHT = 512;
let appleTexturePatternCache = null;

/** 再現性のある疑似乱数 (グローバルの random() の系列を乱さないため独立させる) */
function createSeededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function smoothStepScalar(edge0, edge1, value) {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/**
 * 横方向に継ぎ目のないノイズ (u を円周に巻き付けてサンプリング)
 * @param {number} u 0-1 (1周)
 * @param {number} v 縦座標
 * @param {number} horizontalFrequency 1周あたりの細かさ
 */
function sampleWrappedNoise(u, v, horizontalFrequency, verticalFrequency, offset) {
    const angle = u * Math.PI * 2;
    const radius = horizontalFrequency / (Math.PI * 2);
    return noise(Math.cos(angle) * radius + offset, v * verticalFrequency + offset * 0.37, Math.sin(angle) * radius + offset * 1.91);
}

/**
 * 色に依存しない果皮・果肉の模様マスクを生成する関数 (初回のみ)
 */
function buildAppleTexturePatterns() {
    if (appleTexturePatternCache) return appleTexturePatternCache;
    const width = APPLE_TEXTURE_WIDTH;
    const height = APPLE_TEXTURE_HEIGHT;
    const pixelCount = width * height;
    noiseSeed(20241117);
    noiseDetail(4, 0.5);

    const blush = new Float32Array(pixelCount);      // 0: 地色 (黄緑) 〜 1: 濃い赤
    const streak = new Float32Array(pixelCount);     // 縦筋の濃淡 (-1〜1)
    const mottle = new Float32Array(pixelCount);     // 細かなムラ (-1〜1)
    const fleshGrain = new Float32Array(pixelCount); // 果肉の細胞粒 (-1〜1)
    const fleshVein = new Float32Array(pixelCount);  // 果肉の維管束の筋 (0〜1)
    const fleshTint = new Float32Array(pixelCount);  // 果肉の極付近の青み (0〜1)

    for (let y = 0; y < height; y++) {
        const latitude = (y + 0.5) / height;
        // ヘタ側 (上) とお尻側 (下) のくぼみは色づきにくく地色が出る
        const cavity = Math.max(1 - smoothStepScalar(0.03, 0.17, latitude), smoothStepScalar(0.86, 0.98, latitude));
        for (let x = 0; x < width; x++) {
            const u = (x + 0.5) / width;
            const index = x + y * width;

            // 日の当たった側ほど赤い大きな色づき + 緩やかなムラ
            const sunSide = 0.5 + 0.5 * Math.cos((u - 0.15) * Math.PI * 2);
            const largePatch = sampleWrappedNoise(u, latitude, 3.0, 2.4, 11.0);
            let blushValue = 0.45 + 0.5 * sunSide + (largePatch - 0.5) * 1.0;
            // 縦に流れる筋 (横は細かく縦は長い)。色づきの境界ほど筋がはっきり出る
            const streakNoise = sampleWrappedNoise(u, latitude, 46.0, 2.2, 47.0) - 0.5;
            const fineStreak = sampleWrappedNoise(u, latitude, 140.0, 5.0, 83.0) - 0.5;
            blushValue += (streakNoise * 0.95 + fineStreak * 0.5) * (0.55 + 0.45 * (1 - Math.abs(blushValue - 0.55) * 1.6));
            blushValue -= cavity * 0.75;
            blush[index] = smoothStepScalar(0.08, 0.92, blushValue);
            streak[index] = Math.max(-1, Math.min(1, streakNoise * 2.4 + fineStreak * 1.2));
            mottle[index] = (sampleWrappedNoise(u, latitude, 220.0, 110.0, 131.0) - 0.5) * 2;

            fleshGrain[index] = (sampleWrappedNoise(u, latitude, 380.0, 190.0, 211.0) - 0.5) * 2;
            fleshVein[index] = Math.pow(Math.max(0, 1 - Math.abs(sampleWrappedNoise(u, latitude, 26.0, 1.6, 257.0) - 0.5) * 9), 3);
            fleshTint[index] = Math.max(1 - smoothStepScalar(0.0, 0.2, latitude), smoothStepScalar(0.8, 1.0, latitude));
        }
    }

    // 果点 (皮の細かい白い点)。ヘタ付近ほど大きく密度が高い
    const lenticel = new Float32Array(pixelCount);
    const randomSource = createSeededRandom(1117);
    const dotCount = 3600;
    for (let dot = 0; dot < dotCount; dot++) {
        const centerX = randomSource() * width;
        const latitude = Math.pow(randomSource(), 1.25);
        const centerY = latitude * height;
        const nearStem = 1 - smoothStepScalar(0.0, 0.5, latitude);
        const radiusX = 0.9 + randomSource() * 1.3 + nearStem * 1.2;
        const radiusY = radiusX * (0.8 + randomSource() * 0.5);
        const strength = 0.45 + randomSource() * 0.55;
        for (let offsetY = Math.floor(-radiusY - 1); offsetY <= Math.ceil(radiusY + 1); offsetY++) {
            const pixelY = Math.round(centerY + offsetY);
            if (pixelY < 0 || pixelY >= height) continue;
            for (let offsetX = Math.floor(-radiusX - 1); offsetX <= Math.ceil(radiusX + 1); offsetX++) {
                const pixelX = ((Math.round(centerX + offsetX) % width) + width) % width;
                const distance = Math.hypot((pixelX - centerX + width * 1.5) % width - width * 0.5, pixelY - centerY);
                const normalizedX = ((pixelX - centerX + width * 1.5) % width - width * 0.5) / radiusX;
                const normalizedY = (pixelY - centerY) / radiusY;
                const falloff = 1 - smoothStepScalar(0.5, 1.0, Math.hypot(normalizedX, normalizedY));
                if (falloff <= 0 || distance > radiusX + 2) continue;
                const index = pixelX + pixelY * width;
                lenticel[index] = Math.max(lenticel[index], falloff * strength);
            }
        }
    }

    appleTexturePatternCache = { width, height, blush, streak, mottle, lenticel, fleshGrain, fleshVein, fleshTint };
    return appleTexturePatternCache;
}

function mixRgb(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/**
 * りんごの果皮・果肉テクスチャとフィルムグレインを生成する関数
 * 果皮: 日の当たり方による色づきのムラ、縦筋、くぼみ周りの地色、果点
 * 果肉: 細かな細胞の粒、維管束の淡い筋、極付近のわずかな青み
 */
function generateProceduralTextures() {
    console.log("[Texture Generator] Creating procedural textures...");
    const patterns = buildAppleTexturePatterns();
    const { width, height } = patterns;

    const skinRgb = convertHexToRgb(sketchParameters.appleSkinColorHex);
    const fleshRgb = convertHexToRgb(sketchParameters.appleFleshColorHex);
    // 地色はパレットと調和するよう果肉色寄りに、わずかに緑へ寄せる
    const groundRgb = mixRgb(mixRgb(fleshRgb, skinRgb, 0.22), { r: 168, g: 196, b: 82 }, 0.22);
    const deepRgb = { r: skinRgb.r * 0.62, g: skinRgb.g * 0.55, b: skinRgb.b * 0.65 };
    const lenticelRgb = mixRgb(fleshRgb, { r: 255, g: 250, b: 225 }, 0.4);

    // 1. りんごの果皮テクスチャ (Apple Skin)
    if (appleSkinProceduralTexture) appleSkinProceduralTexture.remove();
    appleSkinProceduralTexture = createGraphics(width, height);
    appleSkinProceduralTexture.pixelDensity(1);
    appleSkinProceduralTexture.loadPixels();
    const skinPixels = appleSkinProceduralTexture.pixels;
    for (let index = 0; index < width * height; index++) {
        const blush = patterns.blush[index];
        // 地色 → 赤 → 筋の濃い赤
        let color = mixRgb(groundRgb, skinRgb, blush);
        color = mixRgb(color, deepRgb, Math.max(0, patterns.streak[index]) * 0.75 * blush);
        color = mixRgb(color, groundRgb, Math.max(0, -patterns.streak[index]) * 0.25 * (1 - blush * 0.4));
        const shade = 1 + patterns.mottle[index] * 0.05;
        // 果点は赤い部分ほど目立ち、地色の部分ではほとんど見えない
        color = mixRgb(color, lenticelRgb, patterns.lenticel[index] * (0.15 + 0.35 * blush));
        const offset = index * 4;
        skinPixels[offset] = Math.min(255, color.r * shade);
        skinPixels[offset + 1] = Math.min(255, color.g * shade);
        skinPixels[offset + 2] = Math.min(255, color.b * shade);
        skinPixels[offset + 3] = 255;
    }
    appleSkinProceduralTexture.updatePixels();

    // 2. 果肉テクスチャ (Apple Flesh)
    if (appleFleshProceduralTexture) appleFleshProceduralTexture.remove();
    appleFleshProceduralTexture = createGraphics(width, height);
    appleFleshProceduralTexture.pixelDensity(1);
    appleFleshProceduralTexture.loadPixels();
    const fleshPixels = appleFleshProceduralTexture.pixels;
    const veinRgb = mixRgb(fleshRgb, { r: 200, g: 205, b: 150 }, 0.35);
    const tintRgb = mixRgb(fleshRgb, { r: 215, g: 225, b: 170 }, 0.45);
    for (let index = 0; index < width * height; index++) {
        let color = mixRgb(fleshRgb, tintRgb, patterns.fleshTint[index] * 0.6);
        color = mixRgb(color, veinRgb, patterns.fleshVein[index] * 0.5);
        const grain = patterns.fleshGrain[index];
        // 細胞粒: 明るい瑞々しい粒と、わずかに暗い隙間
        const shade = 1 + grain * 0.06 + (grain > 0.55 ? (grain - 0.55) * 0.18 : 0);
        const offset = index * 4;
        fleshPixels[offset] = Math.min(255, color.r * shade);
        fleshPixels[offset + 1] = Math.min(255, color.g * shade);
        fleshPixels[offset + 2] = Math.min(255, color.b * shade);
        fleshPixels[offset + 3] = 255;
    }
    appleFleshProceduralTexture.updatePixels();

    // 3. 全画面フィルムグレイン質感オーバーレイ
    grainNoiseOverlayTexture = createGraphics(256, 256);
    grainNoiseOverlayTexture.pixelDensity(1);
    grainNoiseOverlayTexture.loadPixels();
    for (let pixelCounter = 0; pixelCounter < 256 * 256; pixelCounter++) {
        const grainIndex = pixelCounter * 4;
        const grainLuminance = random(255);
        grainNoiseOverlayTexture.pixels[grainIndex] = grainLuminance;
        grainNoiseOverlayTexture.pixels[grainIndex + 1] = grainLuminance;
        grainNoiseOverlayTexture.pixels[grainIndex + 2] = grainLuminance;
        grainNoiseOverlayTexture.pixels[grainIndex + 3] = random(40, 100);
    }
    grainNoiseOverlayTexture.updatePixels();
    console.log("[Texture Generator] Textures successfully loaded into memory.");
}
