const Tesseract = require('tesseract.js');
const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

const testImage = path.join(__dirname, '../test2.png');
const tempPath = path.join(__dirname, '../test2_processed.png');

/**
 * STAR CITIZEN MINER TRACKER - OCR REGRESSION TEST
 * This script verifies that Tesseract can read the tabular data in test2.png correctly.
 * Expected values:
 * TUNGSTEN 649 9
 * TUNGSTEN 677 9
 * TUNGSTEN 696 1
 * TUNGSTEN 712 3
 * TUNGSTEN 715 8
 * TUNGSTEN 717 4
 */

async function runTest() {
    console.log(`--- Testing OCR for ${testImage} ---`);
    if (!fs.existsSync(testImage)) {
        console.error(`Error: ${testImage} not found.`);
        return;
    }

    try {
        console.log('Pre-processing image (Scale 5x, Grayscale, Threshold, Invert)...');
        const image = await Jimp.read(testImage);
        
        // Upscale 6x to improve digit detection
        image.resize({ w: image.bitmap.width * 6 }); 
        image.greyscale();
        image.normalize();
        image.contrast(0.3);
        image.threshold({ max: 255, replace: 255, auto: true });
        image.invert();
        
        await image.write(tempPath);

        const worker = await Tesseract.createWorker('eng', 1);

        await worker.setParameters({
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,\n',
            tessedit_pageseg_mode: '6', // PSM 6 for a single uniform block of text
            preserve_interword_spaces: '1', // Maintain columnar alignment
        });

        console.log('Running OCR...');
        const { data: { text } } = await worker.recognize(tempPath);
        await worker.terminate();

        console.log('\n--- RAW OCR OUTPUT ---');
        console.log(text);
        console.log('----------------------');

        const expectedRows = [
            "TUNGSTEN 649 9",
            "TUNGSTEN 677 9",
            "TUNGSTEN 696 1",
            "TUNGSTEN 712 3",
            "TUNGSTEN 715 8",
            "TUNGSTEN 717 4"
        ];

        let passCount = 0;
        expectedRows.forEach(row => {
            const rowRegex = new RegExp(row.replace(/\s+/g, '\\s+'), 'i');
            if (rowRegex.test(text)) {
                console.log(`[PASS] Identified: ${row}`);
                passCount++;
            } else {
                console.log(`[FAIL] Missed: ${row}`);
            }
        });

        console.log(`\nResults: ${passCount}/${expectedRows.length} rows matched correctly.`);
        
        // Cleanup temp file
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    } catch (error) {
        console.error('Test Error:', error);
    }
}

runTest();
