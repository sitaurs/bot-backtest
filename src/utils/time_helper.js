/**
 * @file src/utils/time_helper.js
 * @description Kumpulan fungsi bantuan untuk mengelola dan memformat waktu.
 */

const moment = require('moment-timezone');

// Menetapkan zona waktu default untuk semua operasi di file ini
const TIMEZONE = 'Asia/Jakarta';

/**
 * Mengonversi objek Date atau string tanggal ke format yang ditentukan dalam zona waktu WIB.
 * @param {Date|string|moment.Moment} dateInput - Tanggal yang akan diformat.
 * @returns {string} Tanggal yang sudah diformat, contoh: "07 Jul 2025 09:30 WIB".
 */
function formatToWIB(dateInput) {
  return moment(dateInput).tz(TIMEZONE).format('DD MMM YYYY HH:mm [WIB]');
}

/**
 * Mendapatkan objek moment saat ini dalam zona waktu WIB.
 * @returns {moment.Moment} Objek moment saat ini.
 */
function now() {
  return moment().tz(TIMEZONE);
}

/**
 * Menghitung selisih waktu antara dua tanggal dalam menit.
 * @param {Date|string|moment.Moment} startTime - Waktu mulai.
 * @param {Date|string|moment.Moment} endTime - Waktu akhir.
 * @returns {number} Selisih waktu dalam menit.
 */
function differenceInMinutes(startTime, endTime) {
  const start = moment(startTime).tz(TIMEZONE);
  const end = moment(endTime).tz(TIMEZONE);
  return end.diff(start, 'minutes');
}

module.exports = {
  formatToWIB,
  now,
  differenceInMinutes,
  TIMEZONE,
};
