/**
 * @file src/utils/logger.js
 * @description Utilitas sederhana untuk menampilkan log ke konsol dengan format yang konsisten.
 */

const moment = require('moment-timezone');
const { TIMEZONE } = require('./time_helper');

/**
 * Fungsi dasar untuk mencetak log dengan level dan timestamp.
 * @param {string} level - Level log (e.g., INFO, WARN, ERROR).
 * @param {string} message - Pesan yang akan ditampilkan.
 * @param {any} [data] - Data tambahan (opsional) untuk ditampilkan.
 */
function log(level, message, data) {
  const timestamp = moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
  const levelColors = {
    INFO: '\x1b[32m', // Hijau
    WARN: '\x1b[33m', // Kuning
    ERROR: '\x1b[31m', // Merah
    DEBUG: '\x1b[36m', // Cyan
  };
  const color = levelColors[level] || '\x1b[0m'; // Default
  const resetColor = '\x1b[0m';

  console.log(`${timestamp} ${color}[${level}]${resetColor} ${message}`);
  
  // Jika ada data tambahan, tampilkan dalam format JSON yang mudah dibaca
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

const logger = {
  info: (message, data) => log('INFO', message, data),
  warn: (message, data) => log('WARN', message, data),
  error: (message, data) => log('ERROR', message, data),
  debug: (message, data) => log('DEBUG', message, data),
};

module.exports = logger;
