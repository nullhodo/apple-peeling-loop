/* ==========================================================================
   PROCEDURAL TEXTURE GENERATION (果物・野菜ごとの果皮・果肉・微細ノイズ)
   ========================================================================== */
/*
 * 果皮・果肉テクスチャは (u = 周回 τ, v = 緯度) で貼られ、1周ごとに横方向へ繰り返す。
 * そのため横方向が継ぎ目なくつながるよう、ノイズは円柱面上の3次元座標でサンプリングする。
 * 色に依存しない模様 (マスク) は初回だけ計算してキャッシュし、色の変更時は合成のみやり直す。
 */
const APPLE_TEXTURE_WIDTH = 1024;
const APPLE_TEXTURE_HEIGHT = 512;
const surfaceTexturePatternCache = {};

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
 * 横方向に継ぎ目なく、楕円状の点を散らしたマスク (0〜1) を作る関数
 * @param {object} options count, seed, radius(latitude, random) → [rx, ry], strength(random) → 0-1, latitude(random) → 0-1
 */
function stampScatteredDots(width, height, options) {
    const mask = new Float32Array(width * height);
    const randomSource = createSeededRandom(options.seed);
    const pickLatitude = options.latitude || ((rnd) => rnd());
    for (let dot = 0; dot < options.count; dot++) {
        const centerX = randomSource() * width;
        const latitude = pickLatitude(randomSource);
        const centerY = latitude * height;
        const [radiusX, radiusY] = options.radius(latitude, randomSource);
        const strength = options.strength(randomSource);
        for (let offsetY = Math.floor(-radiusY - 1); offsetY <= Math.ceil(radiusY + 1); offsetY++) {
            const pixelY = Math.round(centerY + offsetY);
            if (pixelY < 0 || pixelY >= height) continue;
            for (let offsetX = Math.floor(-radiusX - 1); offsetX <= Math.ceil(radiusX + 1); offsetX++) {
                const pixelX = ((Math.round(centerX + offsetX) % width) + width) % width;
                const wrappedDx = (pixelX - centerX + width * 1.5) % width - width * 0.5;
                const falloff = 1 - smoothStepScalar(0.5, 1.0, Math.hypot(wrappedDx / radiusX, (pixelY - centerY) / radiusY));
                if (falloff <= 0) continue;
                const index = pixelX + pixelY * width;
                mask[index] = Math.max(mask[index], falloff * strength);
            }
        }
    }
    return mask;
}

/** 緯度方向にも横方向にも細かな、均質なざらつき (-1〜1) */
function fillWrappedNoiseField(width, height, horizontalFrequency, verticalFrequency, offset) {
    const field = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        const latitude = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
            field[x + y * width] = (sampleWrappedNoise((x + 0.5) / width, latitude, horizontalFrequency, verticalFrequency, offset) - 0.5) * 2;
        }
    }
    return field;
}

/** 0.5 付近だけが細く盛り上がる尾根 (網目・筋) を取り出す */
function ridgeOf(noiseValue, sharpness) {
    return Math.pow(Math.max(0, 1 - Math.abs(noiseValue - 0.5) * sharpness), 3);
}

/** ヘタ側・お尻側のくぼみ付近の重み (0〜1) */
function poleWeight(latitude, innerEdge, outerEdge) {
    return Math.max(1 - smoothStepScalar(innerEdge, outerEdge, latitude), smoothStepScalar(1 - outerEdge, 1 - innerEdge, latitude));
}

/** 画素ごとに緯度・u を渡して模様を作るループ */
function forEachTexel(width, height, callback) {
    for (let y = 0; y < height; y++) {
        const latitude = (y + 0.5) / height;
        for (let x = 0; x < width; x++) {
            callback(x + y * width, (x + 0.5) / width, latitude);
        }
    }
}

/* ---------- りんご: 日の当たり方による色づき・縦筋・果点 / 細胞粒・維管束 ---------- */
function buildApplePatterns(width, height) {
    const pixelCount = width * height;
    const blush = new Float32Array(pixelCount);      // 0: 地色 (黄緑) 〜 1: 濃い赤
    const streak = new Float32Array(pixelCount);     // 縦筋の濃淡 (-1〜1)
    const fleshVein = new Float32Array(pixelCount);  // 果肉の維管束の筋 (0〜1)
    const fleshTint = new Float32Array(pixelCount);  // 果肉の極付近の青み (0〜1)
    forEachTexel(width, height, (index, u, latitude) => {
        // ヘタ側 (上) とお尻側 (下) のくぼみは色づきにくく地色が出る
        const cavity = Math.max(1 - smoothStepScalar(0.03, 0.17, latitude), smoothStepScalar(0.86, 0.98, latitude));
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
        fleshVein[index] = ridgeOf(sampleWrappedNoise(u, latitude, 26.0, 1.6, 257.0), 9);
        fleshTint[index] = poleWeight(latitude, 0.0, 0.2);
    });
    // 果点 (皮の細かい白い点)。ヘタ付近ほど大きく密度が高い
    const lenticel = stampScatteredDots(width, height, {
        count: 3600, seed: 1117,
        latitude: (rnd) => Math.pow(rnd(), 1.25),
        radius: (latitude, rnd) => {
            const radiusX = 0.9 + rnd() * 1.3 + (1 - smoothStepScalar(0.0, 0.5, latitude)) * 1.2;
            return [radiusX, radiusX * (0.8 + rnd() * 0.5)];
        },
        strength: (rnd) => 0.45 + rnd() * 0.55
    });
    return {
        blush, streak, fleshVein, fleshTint, lenticel,
        mottle: fillWrappedNoiseField(width, height, 220.0, 110.0, 131.0),
        fleshGrain: fillWrappedNoiseField(width, height, 380.0, 190.0, 211.0)
    };
}

function shadeAppleSkin(p, index, c) {
    const blush = p.blush[index];
    // 地色 → 果皮色 → 筋の濃い色
    let color = mixRgb(c.ground, c.skin, blush);
    color = mixRgb(color, c.deep, Math.max(0, p.streak[index]) * 0.75 * blush);
    color = mixRgb(color, c.ground, Math.max(0, -p.streak[index]) * 0.25 * (1 - blush * 0.4));
    // 果点は色づいた部分ほど目立ち、地色の部分ではほとんど見えない
    color = mixRgb(color, c.dot, p.lenticel[index] * (0.15 + 0.35 * blush));
    return scaleRgb(color, 1 + p.mottle[index] * 0.05);
}

function shadeAppleFlesh(p, index, c) {
    let color = mixRgb(c.flesh, c.fleshTint, p.fleshTint[index] * 0.6);
    color = mixRgb(color, c.fleshVein, p.fleshVein[index] * 0.5);
    const grain = p.fleshGrain[index];
    // 細胞粒: 明るい瑞々しい粒と、わずかに暗い隙間
    return scaleRgb(color, 1 + grain * 0.06 + (grain > 0.55 ? (grain - 0.55) * 0.18 : 0));
}

/* ---------- みかん: 油胞のくぼみ / 房の境目・砂じょう・白いアルベド ---------- */
function buildCitrusPatterns(width, height) {
    const pixelCount = width * height;
    const tone = new Float32Array(pixelCount);
    const segment = new Float32Array(pixelCount);
    const vesicle = new Float32Array(pixelCount);
    const albedo = new Float32Array(pixelCount);
    const segmentCount = 10;
    forEachTexel(width, height, (index, u, latitude) => {
        tone[index] = (sampleWrappedNoise(u, latitude, 4.0, 3.0, 17.0) - 0.5) * 2 - poleWeight(latitude, 0.0, 0.12) * 0.8;
        // 房の境目の薄皮 (経線方向の筋、少し揺らぐ)
        const wobble = (sampleWrappedNoise(u, latitude, 6.0, 3.0, 29.0) - 0.5) * 0.035;
        const phase = ((u + wobble) * segmentCount) % 1;
        segment[index] = Math.pow(Math.max(0, 1 - Math.min(phase, 1 - phase) * 14), 2) * (1 - poleWeight(latitude, 0.0, 0.08));
        // 砂じょう: 経線方向に細長い粒
        vesicle[index] = (sampleWrappedNoise(u, latitude, 260.0, 26.0, 61.0) - 0.5) * 2;
        albedo[index] = smoothStepScalar(0.52, 0.7, sampleWrappedNoise(u, latitude, 9.0, 6.0, 73.0));
    });
    const pore = stampScatteredDots(width, height, {
        count: 16000, seed: 2203,
        radius: (latitude, rnd) => { const r = 1.0 + rnd() * 1.1; return [r, r * (0.85 + rnd() * 0.3)]; },
        strength: (rnd) => 0.5 + rnd() * 0.5
    });
    return { tone, segment, vesicle, albedo, pore, mottle: fillWrappedNoiseField(width, height, 300.0, 150.0, 91.0) };
}

function shadeCitrusSkin(p, index, c) {
    let color = mixRgb(c.skin, p.tone[index] > 0 ? c.light : c.calyxTint, Math.abs(p.tone[index]) * 0.35);
    // 油胞はくぼんで暗く、縁がわずかに明るい
    color = scaleRgb(color, 1 - p.pore[index] * 0.22 + Math.max(0, p.mottle[index]) * 0.06);
    return color;
}

function shadeCitrusFlesh(p, index, c) {
    let color = mixRgb(c.flesh, c.pith, p.albedo[index] * 0.55);
    color = mixRgb(color, c.pith, p.segment[index] * 0.7);
    const grain = p.vesicle[index];
    return scaleRgb(color, 1 + grain * 0.09 + (grain > 0.5 ? (grain - 0.5) * 0.25 : 0));
}

/* ---------- 梨: 密な褐色の果点とさび / 石細胞のざらつき ---------- */
function buildPearPatterns(width, height) {
    const pixelCount = width * height;
    const russet = new Float32Array(pixelCount);
    forEachTexel(width, height, (index, u, latitude) => {
        const patch = sampleWrappedNoise(u, latitude, 5.0, 4.0, 37.0);
        russet[index] = smoothStepScalar(0.45, 0.75, patch) * 0.7 + poleWeight(latitude, 0.02, 0.2) * 0.5;
    });
    const lenticel = stampScatteredDots(width, height, {
        count: 14000, seed: 3301,
        radius: (latitude, rnd) => { const r = 0.9 + rnd() * 1.4; return [r, r * (0.7 + rnd() * 0.5)]; },
        strength: (rnd) => 0.4 + rnd() * 0.6
    });
    const stoneCell = stampScatteredDots(width, height, {
        count: 9000, seed: 3307,
        radius: (latitude, rnd) => { const r = 0.7 + rnd() * 0.9; return [r, r]; },
        strength: (rnd) => 0.5 + rnd() * 0.5
    });
    return {
        russet, lenticel, stoneCell,
        mottle: fillWrappedNoiseField(width, height, 180.0, 90.0, 41.0),
        fleshGrain: fillWrappedNoiseField(width, height, 380.0, 190.0, 43.0)
    };
}

function shadePearSkin(p, index, c) {
    let color = mixRgb(c.skin, c.deep, Math.min(1, p.russet[index]) * 0.45);
    color = mixRgb(color, c.dot, p.lenticel[index] * 0.6);
    return scaleRgb(color, 1 + p.mottle[index] * 0.07);
}

function shadePearFlesh(p, index, c) {
    const color = mixRgb(c.flesh, c.light, p.stoneCell[index] * 0.5);
    return scaleRgb(color, 1 + p.fleshGrain[index] * 0.05 - p.stoneCell[index] * 0.03);
}

/* ---------- 柿: なめらかな果皮と黒いすじ / ゴマ (褐色の斑点) と繊維 ---------- */
function buildPersimmonPatterns(width, height) {
    const pixelCount = width * height;
    const tone = new Float32Array(pixelCount);
    const fiber = new Float32Array(pixelCount);
    forEachTexel(width, height, (index, u, latitude) => {
        // 4つの溝に沿ってわずかに色が濃くなる
        const groove = Math.pow(0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 4), 6) * poleWeight(latitude, 0.1, 0.45);
        tone[index] = (sampleWrappedNoise(u, latitude, 3.0, 2.0, 53.0) - 0.5) * 1.6 - groove * 0.8 - poleWeight(latitude, 0.0, 0.1) * 0.6;
        fiber[index] = ridgeOf(sampleWrappedNoise(u, latitude, 60.0, 2.0, 59.0), 7);
    });
    const speck = stampScatteredDots(width, height, {
        count: 2600, seed: 4409,
        latitude: (rnd) => 0.1 + rnd() * 0.8,
        radius: (latitude, rnd) => { const r = 0.8 + rnd() * 1.8; return [r * 0.7, r * (1.2 + rnd())]; },
        strength: (rnd) => 0.35 + rnd() * 0.65
    });
    return { tone, fiber, speck, mottle: fillWrappedNoiseField(width, height, 160.0, 80.0, 67.0) };
}

function shadePersimmonSkin(p, index, c) {
    const t = p.tone[index];
    const color = mixRgb(c.skin, t > 0 ? c.light : c.deep, Math.min(1, Math.abs(t)) * 0.4);
    return scaleRgb(color, 1 + p.mottle[index] * 0.025);
}

function shadePersimmonFlesh(p, index, c) {
    let color = mixRgb(c.flesh, c.fleshVein, p.fiber[index] * 0.35);
    color = mixRgb(color, c.speck, p.speck[index] * 0.85);
    return color;
}

/* ---------- じゃがいも: 網目状の褐色の皮と芽のくぼみ / でんぷん質のきめ ---------- */
function buildPotatoPatterns(width, height) {
    const pixelCount = width * height;
    const net = new Float32Array(pixelCount);
    const blotch = new Float32Array(pixelCount);
    forEachTexel(width, height, (index, u, latitude) => {
        net[index] = Math.max(
            ridgeOf(sampleWrappedNoise(u, latitude, 70.0, 35.0, 101.0), 8),
            ridgeOf(sampleWrappedNoise(u, latitude, 110.0, 55.0, 103.0), 8) * 0.7
        );
        blotch[index] = (sampleWrappedNoise(u, latitude, 6.0, 4.0, 107.0) - 0.5) * 2;
    });
    const eye = stampScatteredDots(width, height, {
        count: 9, seed: 5501,
        latitude: (rnd) => 0.15 + rnd() * 0.7,
        radius: (latitude, rnd) => { const r = 6 + rnd() * 6; return [r * 1.6, r]; },
        strength: () => 1
    });
    return {
        net, blotch, eye,
        mottle: fillWrappedNoiseField(width, height, 240.0, 120.0, 109.0),
        fleshGrain: fillWrappedNoiseField(width, height, 420.0, 210.0, 113.0)
    };
}

function shadePotatoSkin(p, index, c) {
    let color = mixRgb(c.skin, p.blotch[index] > 0 ? c.light : c.deep, Math.abs(p.blotch[index]) * 0.35);
    color = mixRgb(color, c.deep, p.net[index] * 0.45);
    // 芽: 中心が暗く、まわりがわずかに盛り上がって明るい
    const eye = p.eye[index];
    color = mixRgb(color, eye > 0.7 ? c.speck : c.light, eye > 0.7 ? (eye - 0.7) * 2.4 : eye * 0.35);
    return scaleRgb(color, 1 + p.mottle[index] * 0.08);
}

function shadePotatoFlesh(p, index, c) {
    return scaleRgb(c.flesh, 1 + p.fleshGrain[index] * 0.04);
}

/* ---------- キウイ: 細かな毛羽 / 放射状の筋と黒い種 ---------- */
function buildKiwiPatterns(width, height) {
    const pixelCount = width * height;
    const fuzz = new Float32Array(pixelCount);
    const ray = new Float32Array(pixelCount);
    forEachTexel(width, height, (index, u, latitude) => {
        // 毛羽: 横に短く縦に流れる細い毛
        fuzz[index] = (sampleWrappedNoise(u, latitude, 520.0, 60.0, 151.0) - 0.5) * 2;
        ray[index] = ridgeOf(sampleWrappedNoise(u, latitude, 90.0, 1.2, 157.0), 6);
    });
    const seed = stampScatteredDots(width, height, {
        count: 1400, seed: 6607,
        latitude: (rnd) => 0.08 + rnd() * 0.84,
        radius: (latitude, rnd) => { const r = 1.3 + rnd() * 0.9; return [r, r * 1.7]; },
        strength: () => 1
    });
    return {
        fuzz, ray, seed,
        tone: fillWrappedNoiseField(width, height, 5.0, 3.0, 163.0),
        fleshGrain: fillWrappedNoiseField(width, height, 380.0, 190.0, 167.0)
    };
}

function shadeKiwiSkin(p, index, c) {
    const fuzz = p.fuzz[index];
    let color = mixRgb(c.skin, p.tone[index] > 0 ? c.light : c.deep, Math.abs(p.tone[index]) * 0.3);
    color = mixRgb(color, fuzz > 0 ? c.light : c.deep, Math.abs(fuzz) * 0.45);
    return color;
}

function shadeKiwiFlesh(p, index, c) {
    let color = mixRgb(c.flesh, c.pith, p.ray[index] * 0.4);
    color = scaleRgb(color, 1 + p.fleshGrain[index] * 0.06);
    return mixRgb(color, c.seed, p.seed[index] * 0.95);
}

/**
 * 果物・野菜ごとの質感 (模様の作り方・果皮の艶)
 * gloss: 果皮の艶 (1 で りんごのロウ質の艶、0 に近いほどつや消し)
 */
const SURFACE_TEXTURE_STYLES = {
    apple: { label: "りんご", gloss: 1.0, build: buildApplePatterns, skin: shadeAppleSkin, flesh: shadeAppleFlesh },
    citrus: { label: "みかん", gloss: 0.7, build: buildCitrusPatterns, skin: shadeCitrusSkin, flesh: shadeCitrusFlesh },
    pear: { label: "梨", gloss: 0.45, build: buildPearPatterns, skin: shadePearSkin, flesh: shadePearFlesh },
    persimmon: { label: "柿", gloss: 1.15, build: buildPersimmonPatterns, skin: shadePersimmonSkin, flesh: shadePersimmonFlesh },
    potato: { label: "じゃがいも", gloss: 0.15, build: buildPotatoPatterns, skin: shadePotatoSkin, flesh: shadePotatoFlesh },
    kiwi: { label: "キウイ", gloss: 0.1, build: buildKiwiPatterns, skin: shadeKiwiSkin, flesh: shadeKiwiFlesh }
};

function getActiveSurfaceTextureStyleKey() {
    return sketchParameters.surfaceTextureStyle in SURFACE_TEXTURE_STYLES ? sketchParameters.surfaceTextureStyle : "apple";
}

/**
 * 色に依存しない模様マスクを質感ごとに生成してキャッシュする関数
 */
function buildSurfaceTexturePatterns(styleKey) {
    if (surfaceTexturePatternCache[styleKey]) return surfaceTexturePatternCache[styleKey];
    const style = SURFACE_TEXTURE_STYLES[styleKey];
    noiseSeed(20241117);
    noiseDetail(4, 0.5);
    surfaceTexturePatternCache[styleKey] = style.build(APPLE_TEXTURE_WIDTH, APPLE_TEXTURE_HEIGHT);
    return surfaceTexturePatternCache[styleKey];
}

/** 差し色を配色に合わせて {r, g, b} で返す (無彩色の配色ではグレー) */
function toneRgb(red, green, blue) {
    const [r, g, b] = toneForColorScheme(red, green, blue);
    return { r, g, b };
}

function mixRgb(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function scaleRgb(color, factor) {
    return { r: color.r * factor, g: color.g * factor, b: color.b * factor };
}

/**
 * 果皮・果肉の色から、テクスチャの差し色一式を作る関数
 * 差し色はすべて果皮・果肉の色から作り、どの配色でも調和させる
 */
function buildSurfaceTextureColors(skin, flesh) {
    return {
        skin,
        flesh,
        // 地色はパレットと調和するよう果肉色寄りに、わずかに緑へ寄せる
        ground: mixRgb(mixRgb(flesh, skin, 0.22), toneRgb(168, 196, 82), 0.22),
        deep: { r: skin.r * 0.62, g: skin.g * 0.55, b: skin.b * 0.65 },
        light: mixRgb(skin, toneRgb(255, 245, 220), 0.3),
        dot: mixRgb(flesh, toneRgb(255, 250, 225), 0.4),
        calyxTint: mixRgb(skin, toneRgb(120, 150, 60), 0.5),
        pith: mixRgb(flesh, toneRgb(255, 252, 240), 0.6),
        speck: mixRgb(skin, toneRgb(40, 25, 15), 0.75),
        seed: toneRgb(22, 16, 12),
        fleshVein: mixRgb(flesh, toneRgb(200, 205, 150), 0.35),
        fleshTint: mixRgb(flesh, toneRgb(215, 225, 170), 0.45)
    };
}

/**
 * 選択中の質感で果皮・果肉テクスチャを、あわせてフィルムグレインを生成する関数
 * 模様はキャッシュから取り、配色 (果皮・果肉色) との合成だけを毎回やり直す
 */
function generateProceduralTextures() {
    console.log("[Texture Generator] Creating procedural textures...");
    const styleKey = getActiveSurfaceTextureStyleKey();
    const style = SURFACE_TEXTURE_STYLES[styleKey];
    const patterns = buildSurfaceTexturePatterns(styleKey);
    const width = APPLE_TEXTURE_WIDTH;
    const height = APPLE_TEXTURE_HEIGHT;

    const flesh = convertHexToRgb(sketchParameters.appleFleshColorHex);
    const colors = buildSurfaceTextureColors(convertHexToRgb(sketchParameters.appleSkinColorHex), flesh);

    appleSkinProceduralTexture = paintSurfaceTexture(appleSkinProceduralTexture, width, height, (index) => style.skin(patterns, index, colors));
    appleFleshProceduralTexture = paintSurfaceTexture(appleFleshProceduralTexture, width, height, (index) => style.flesh(patterns, index, colors));
    if (sketchParameters.isSkinAlternationEnabled) {
        const alternateColors = buildSurfaceTextureColors(convertHexToRgb(sketchParameters.alternateSkinColorHex), flesh);
        appleAlternateSkinProceduralTexture = paintSurfaceTexture(appleAlternateSkinProceduralTexture, width, height, (index) => style.skin(patterns, index, alternateColors));
    } else if (appleAlternateSkinProceduralTexture) {
        appleAlternateSkinProceduralTexture.remove();
        appleAlternateSkinProceduralTexture = null;
    }

    // 全画面フィルムグレイン質感オーバーレイ
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

/** 画素ごとの色関数でテクスチャを塗る (古いバッファは破棄する) */
function paintSurfaceTexture(previousGraphics, width, height, colorAt) {
    if (previousGraphics) previousGraphics.remove();
    const graphics = createGraphics(width, height);
    graphics.pixelDensity(1);
    graphics.loadPixels();
    const pixels = graphics.pixels;
    for (let index = 0; index < width * height; index++) {
        const color = colorAt(index);
        const offset = index * 4;
        pixels[offset] = Math.min(255, Math.max(0, color.r));
        pixels[offset + 1] = Math.min(255, Math.max(0, color.g));
        pixels[offset + 2] = Math.min(255, Math.max(0, color.b));
        pixels[offset + 3] = 255;
    }
    graphics.updatePixels();
    return graphics;
}
