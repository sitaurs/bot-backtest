/**
 * @file src/engine/ai_service.js
 * @description Modul ini berfungsi sebagai jembatan ke layanan AI (Gemini).
 * Mendukung panggilan dua tahap: Analisis Utama dan Ekstraksi Data.
 */

const axios = require('axios');
const fs =require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');

const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`;
const geminiTextOnlyUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

// Memuat prompt untuk ekstraksi saat modul dijalankan
const extractorPromptPath = path.resolve(__dirname, '../../prompts/extractor_prompt.txt');
const EXTRACTOR_PROMPT = fs.readFileSync(extractorPromptPath, 'utf-8');


/**
 * TAHAP 1: Mengirim permintaan analisis utama ke Google Gemini.
 * @param {string} prompt - Teks prompt strategi utama.
 * @param {object} ohlcData - Objek berisi data OHLCV M1 dan M15.
 * @param {object} chartImagePaths - Objek berisi path ke file gambar chart.
 * @returns {Promise<string|null>} Hasil analisis naratif atau null jika gagal.
 */
async function getAnalysis(prompt, ohlcData, chartImagePaths) {
    logger.info('[AI Service - Tahap 1] Menyiapkan permintaan analisis utama...');
    
    const imageToBase64 = (filePath) => {
        try {
            if (fs.existsSync(filePath)) {
                const fileData = fs.readFileSync(filePath);
                return fileData.toString('base64');
            }
        } catch (e) {
            logger.error(`[AI Service] Gagal membaca file gambar: ${filePath}`, e);
        }
        return null;
    };
    
    const m1Image = imageToBase64(chartImagePaths.m1_chart_file);
    const m15Image = imageToBase64(chartImagePaths.m15_chart_file);

    if (!m1Image || !m15Image) {
        logger.error("[AI Service - Tahap 1] Gagal memuat gambar chart untuk dikirim ke AI.");
        return null;
    }

    const payload = {
        contents: [{
            parts: [
                { text: prompt },
                { text: `\nData Teks OHLCV:\n${JSON.stringify(ohlcData, null, 2)}` },
                { inline_data: { mime_type: "image/png", data: m1Image }},
                { inline_data: { mime_type: "image/png", data: m15Image }}
            ]
        }],
    };
    
    try {
        const response = await axios.post(geminiUrl, payload, { headers: { 'Content-Type': 'application/json' } });
        logger.info('[AI Service - Tahap 1] Respons analisis utama diterima.');
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        logger.error(`[AI Service - Tahap 1] Gagal saat menghubungi Gemini.`, {
            message: error.message,
            response: error.response ? error.response.data : 'No response data'
        });
        return null;
    }
}


/**
 * TAHAP 2: Mengirim laporan naratif ke Gemini untuk diekstrak datanya.
 * @param {string} narrativeText - Teks laporan lengkap dari hasil Tahap 1.
 * @returns {Promise<string|null>} Teks singkat hasil ekstraksi atau null jika gagal.
 */
async function extractDataWithAI(narrativeText) {
    logger.info('[AI Service - Tahap 2] Menyiapkan permintaan ekstraksi data...');

    const fullPrompt = `${EXTRACTOR_PROMPT}\n\n${narrativeText}`;

    const payload = {
        contents: [{ parts: [{ text: fullPrompt }] }],
    };

    try {
        const response = await axios.post(geminiTextOnlyUrl, payload, { headers: { 'Content-Type': 'application/json' } });
        logger.info('[AI Service - Tahap 2] Respons ekstraksi data diterima.');
        return response.data.candidates[0].content.parts[0].text.trim();
    } catch (error) {
        logger.error(`[AI Service - Tahap 2] Gagal saat menghubungi Gemini untuk ekstraksi.`, {
            message: error.message,
            response: error.response ? error.response.data : 'No response data'
        });
        return null;
    }
}

module.exports = {
    getAnalysis,
    extractDataWithAI // Ekspor fungsi baru
};