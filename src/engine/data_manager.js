/**
 * @file src/engine/data_manager.js
 * @description Modul untuk mengambil data OHLCV dari API eksternal dan mengelolanya dengan sistem cache.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const config = require('../../config/default.json');
const { TIMEZONE } = require('../utils/time_helper');

const CACHE_DIR = path.resolve(__dirname, '../../data/cache');

/**
 * Mengambil data OHLCV untuk simbol dan rentang waktu tertentu.
 * Akan mencoba memuat dari cache terlebih dahulu sebelum memanggil API.
 * @param {string} symbol - Simbol pair, contoh: "EURUSD".
 * @param {string} timeframe - Timeframe data, contoh: "M1" atau "M15".
 * @param {string} startDateStr - Tanggal mulai dalam format YYYY-MM-DD.
 * @param {string} endDateStr - Tanggal akhir dalam format YYYY-MM-DD.
 * @returns {Promise<Array|null>} Array data OHLCV atau null jika terjadi kegagalan.
 */
async function getOhlcvData(symbol, timeframe, startDateStr, endDateStr) {
  // 1. Hitung tanggal mulai pengambilan data sebenarnya dengan menambahkan buffer
  const bufferDays = config.data_sourcing.buffer_days;
  const fetchStartDate = moment.tz(startDateStr, TIMEZONE).subtract(bufferDays, 'days').format('YYYY-MM-DD');
  
  // 2. Buat nama file cache yang unik
  const cacheFileName = `${symbol}_${timeframe}_${fetchStartDate}_to_${endDateStr}.json`;
  const cacheFilePath = path.join(CACHE_DIR, cacheFileName);

  // 3. Cek apakah file cache sudah ada
  if (fs.existsSync(cacheFilePath)) {
    logger.info(`[Data Manager] Memuat data dari cache untuk ${timeframe}: ${cacheFileName}`);
    try {
      const cachedData = fs.readFileSync(cacheFilePath, 'utf-8');
      return JSON.parse(cachedData);
    } catch (error) {
      logger.error(`[Data Manager] Gagal membaca atau mem-parsing file cache: ${cacheFilePath}`, error);
      // Jika cache rusak, kita akan coba ambil dari API
    }
  }

  // 4. Jika cache tidak ada atau rusak, ambil dari API
  logger.info(`[Data Manager] Cache tidak ditemukan. Mengambil data dari API untuk ${timeframe}...`);
  
  const apiUrl = new URL(config.data_sourcing.api_url);
  apiUrl.searchParams.append('symbol', symbol);
  apiUrl.searchParams.append('timeframe', timeframe);
  // API memerlukan format ISO 8601 dengan 'Z' (UTC)
  apiUrl.searchParams.append('start', `${fetchStartDate}T00:00:00Z`);
  apiUrl.searchParams.append('end', `${endDateStr}T23:59:59Z`);

  try {
    const response = await axios.get(apiUrl.toString());
    
    if (response.data && Array.isArray(response.data)) {
      logger.info(`[Data Manager] Data ${timeframe} berhasil diambil dari API. Jumlah candle: ${response.data.length}`);
      
      // Pastikan direktori cache ada
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      
      // Simpan data ke cache untuk penggunaan selanjutnya
      fs.writeFileSync(cacheFilePath, JSON.stringify(response.data, null, 2));
      logger.info(`[Data Manager] Data ${timeframe} berhasil disimpan ke cache.`);
      
      return response.data;
    } else {
      logger.warn(`[Data Manager] Respons API untuk ${timeframe} tidak valid atau kosong.`);
      return null;
    }
  } catch (error) {
    logger.error(`[Data Manager] Gagal mengambil data ${timeframe} dari API.`, {
      url: apiUrl.toString(),
      message: error.message,
    });
    return null;
  }
}

module.exports = {
  getOhlcvData,
};
