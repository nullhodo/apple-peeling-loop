/* ==========================================================================
   PROCEDURAL TEXTURE GENERATION (解像感の高い果皮・果肉・微細ノイズ)
   ========================================================================== */
/**
 * りんごの皮の斑点や筋、果肉の瑞々しさを表現するプロシージャルテクスチャを生成する関数
 */
function generateProceduralTextures() {
    console.log("[Texture Generator] Creating procedural textures...");
    const textureDimension = 512;

    // 1. りんごの果皮テクスチャ (Apple Skin)
    appleSkinProceduralTexture = createGraphics(textureDimension, textureDimension);
    appleSkinProceduralTexture.pixelDensity(1);
    const skinBaseRgb = convertHexToRgb(sketchParameters.appleSkinColorHex);

    appleSkinProceduralTexture.loadPixels();
    for (let horizontalPixel = 0; horizontalPixel < textureDimension; horizontalPixel++) {
        for (let verticalPixel = 0; verticalPixel < textureDimension; verticalPixel++) {
            const pixelIndex = (horizontalPixel + verticalPixel * textureDimension) * 4;
            // 縦縞のグラデーションと斑点ノイズ
            const verticalStripeNoise = noise(horizontalPixel * 0.04, verticalPixel * 0.005);
            const fineLenticelNoise = random() > 0.985 ? 45 : 0;
            const noiseVariation = (noise(horizontalPixel * 0.08, verticalPixel * 0.08) - 0.5) * 50;

            const colorRed = constrain(skinBaseRgb.r + verticalStripeNoise * 35 + noiseVariation + fineLenticelNoise, 0, 255);
            const colorGreen = constrain(skinBaseRgb.g + verticalStripeNoise * 15 + noiseVariation * 0.5 + fineLenticelNoise * 0.8, 0, 255);
            const colorBlue = constrain(skinBaseRgb.b + noiseVariation * 0.3, 0, 255);

            appleSkinProceduralTexture.pixels[pixelIndex] = colorRed;
            appleSkinProceduralTexture.pixels[pixelIndex + 1] = colorGreen;
            appleSkinProceduralTexture.pixels[pixelIndex + 2] = colorBlue;
            appleSkinProceduralTexture.pixels[pixelIndex + 3] = 255;
        }
    }
    appleSkinProceduralTexture.updatePixels();

    // 2. 果肉テクスチャ (Apple Flesh)
    appleFleshProceduralTexture = createGraphics(textureDimension, textureDimension);
    appleFleshProceduralTexture.pixelDensity(1);
    const fleshBaseRgb = convertHexToRgb(sketchParameters.appleFleshColorHex);

    appleFleshProceduralTexture.loadPixels();
    for (let horizontalPixel = 0; horizontalPixel < textureDimension; horizontalPixel++) {
        for (let verticalPixel = 0; verticalPixel < textureDimension; verticalPixel++) {
            const pixelIndex = (horizontalPixel + verticalPixel * textureDimension) * 4;
            // 繊維感と水分による微小ノイズ
            const cellularFleshNoise = noise(horizontalPixel * 0.1, verticalPixel * 0.1);
            const radialVeinNoise = noise(horizontalPixel * 0.02, verticalPixel * 0.02);

            const colorRed = constrain(fleshBaseRgb.r + cellularFleshNoise * 15 - radialVeinNoise * 10, 0, 255);
            const colorGreen = constrain(fleshBaseRgb.g + cellularFleshNoise * 15 - radialVeinNoise * 8, 0, 255);
            const colorBlue = constrain(fleshBaseRgb.b + cellularFleshNoise * 8, 0, 255);

            appleFleshProceduralTexture.pixels[pixelIndex] = colorRed;
            appleFleshProceduralTexture.pixels[pixelIndex + 1] = colorGreen;
            appleFleshProceduralTexture.pixels[pixelIndex + 2] = colorBlue;
            appleFleshProceduralTexture.pixels[pixelIndex + 3] = 255;
        }
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
