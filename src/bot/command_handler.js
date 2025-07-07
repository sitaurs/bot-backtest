/**
 * @file src/bot/command_handler.js
 * @description Mem-parsing dan menangani logika untuk setiap perintah yang dikirim pengguna.
 */

const fs = require('fs');
const path = require('path');
const { runBacktest } = require('../engine/main.js');
const logger = require('../utils/logger');
const config = require('../../config/default.json');

let backtestConfig = {
  notificationMode: config.backtest_defaults.notification_mode || 0
};
let isBacktestRunning = false;

function toCamelCase(str) {
  return str.toLowerCase().replace(/([-_][a-z])/g, group =>
    group
      .toUpperCase()
      .replace('-', '')
      .replace('_', '')
  );
}

async function handleCommand(sock, jid, text) {
  const [command, ...args] = text.trim().split(/\s+/);

  switch (command.toLowerCase()) {
    case '!config':
      await handleConfigCommand(sock, jid, args);
      break;
    case '!notify_mode':
      await handleNotifyModeCommand(sock, jid, args);
      break;
    case '!run':
      await handleRunCommand(sock, jid);
      break;
    case '!status':
      await handleStatusCommand(sock, jid);
      break;
    case '!stop':
      await sock.sendMessage(jid, { text: '⚠️ Fitur !stop sedang dalam pengembangan.' });
      break;
    case '!help':
    default:
      await handleHelpCommand(sock, jid);
      break;
  }
}

async function handleConfigCommand(sock, jid, args) {
  if (args.length === 0) {
    await sock.sendMessage(jid, { text: 'Gunakan: !config pair=EURUSD prompt_file=nama.txt ...' });
    return;
  }
  
  args.forEach(arg => {
    const [rawKey, value] = arg.split('=');
    if (rawKey && value) {
      const key = toCamelCase(rawKey);
      backtestConfig[key] = value;
    }
  });

  const levelDesc = ['Diam', 'Ringkas', 'Detail', 'Debug'];
  let response = '✅ **Konfigurasi diperbarui!**\n\n';
  response += `*Pair:* \`${backtestConfig.pair || 'Belum diatur'}\`\n`;
  response += `*Prompt:* \`${backtestConfig.promptFile || 'Belum diatur'}\`\n`;
  response += `*Periode:* \`${backtestConfig.startDate || '?'} s/d ${backtestConfig.endDate || '?'}\`\n`;
  response += `*Mode Notifikasi:* Level ${backtestConfig.notificationMode} (${levelDesc[backtestConfig.notificationMode]})\n\n`;
  response += 'Ketik `!run` untuk memulai.';
  await sock.sendMessage(jid, { text: response });
}

async function handleNotifyModeCommand(sock, jid, args) {
  const level = parseInt(args[0], 10);
  if (isNaN(level) || level < 0 || level > 3) {
    await sock.sendMessage(jid, { text: '❌ Level tidak valid. Gunakan angka 0, 1, 2, atau 3.' });
    return;
  }
  backtestConfig.notificationMode = level;
  const levelDesc = ['Diam', 'Ringkas', 'Detail', 'Debug'];
  await sock.sendMessage(jid, { text: `🔔 Mode notifikasi diatur ke *Level ${level} (${levelDesc[level]})*.` });
}

async function handleRunCommand(sock, jid) {
  if (isBacktestRunning) {
    await sock.sendMessage(jid, { text: '⚠️ Proses lain sedang berjalan. Harap tunggu.' });
    return;
  }
  const { pair, promptFile, startDate, endDate } = backtestConfig;
  if (!pair || !promptFile || !startDate || !endDate) {
    await sock.sendMessage(jid, { text: '❌ Konfigurasi belum lengkap! Atur `pair`, `promptFile`, `startDate`, dan `endDate`.' });
    return;
  }

  isBacktestRunning = true;
  // --- LOG PELACAKAN DITAMBAHKAN ---
  logger.info(`[Handler] Mencoba mengirim pesan 'Backtest Dimulai' ke JID: ${jid}`);
  try {
      await sock.sendMessage(jid, { text: `🚀 **Backtest Dimulai!**\n\n- Pair: \`${pair}\`\n- Periode: \`${startDate}\` s/d \`${endDate}\`\n- Notifikasi: Level ${backtestConfig.notificationMode}` });
  } catch (e) {
      logger.error(`[Handler] GAGAL mengirim pesan 'Backtest Dimulai'.`, e);
  }
  
  logger.info(`[Bot] Memulai backtest untuk user ${jid}`, backtestConfig);

  const result = await runBacktest(backtestConfig, sock, jid);
  
  isBacktestRunning = false;

  if (result && result.reportPath) {
    logger.info(`[Handler] Backtest selesai. Mencoba mengirim laporan ke ${jid}`);
    try {
        const reportContent = JSON.parse(fs.readFileSync(result.reportPath, 'utf-8'));
        const summary = reportContent.performance_summary;
        let summaryText = `🎉 **Backtest Selesai!**\n\nBerikut ringkasan performa:\n\n`;
        summaryText += `*Total Trade:* ${summary.total_trades}\n*Win Rate:* ${summary.win_rate_percent}%\n`;
        summaryText += `*Profit/Loss Bersih:* $${summary.net_profit_loss}\n*Profit Factor:* ${summary.profit_factor}\n`;
        summaryText += `*Kegagalan AI:* ${summary.ai_analysis_failures}\n\nLaporan detail terlampir.`;
        
        await sock.sendMessage(jid, { text: summaryText });
        await sock.sendMessage(jid, { document: fs.readFileSync(result.reportPath), mimetype: 'application/json', fileName: path.basename(result.reportPath) });
        await sock.sendMessage(jid, { document: fs.readFileSync(result.logPath), mimetype: 'application/json', fileName: path.basename(result.logPath) });
    } catch(e) {
        logger.error(`[Handler] GAGAL mengirim laporan akhir.`, e);
    }
  } else {
    logger.error(`[Handler] Backtest gagal untuk user ${jid}. Pesan error seharusnya sudah dikirim dari 'runBacktest'.`);
  }
}

async function handleStatusCommand(sock, jid) {
    const statusMessage = isBacktestRunning ? '⚙️ **Status:** Sedang berjalan.' : '✅ **Status:** Siap.';
    await sock.sendMessage(jid, { text: statusMessage });
}

async function handleHelpCommand(sock, jid) {
  const helpText = `👋 **Perintah Bot Backtester AI**

*!config*
Mengatur parameter. Contoh:
\`!config pair=EURUSD prompt_file=strat1.txt\`

*!notify_mode [level]*
Mengatur notifikasi:
- 0: Diam (Hanya laporan akhir)
- 1: Ringkas (Buka/Tutup posisi)
- 2: Detail (Semua aksi order)
- 3: Debug (Melihat input & output AI)
Contoh: \`!notify_mode 3\`

*!run*
Memulai backtest.

*!status*
Melihat status bot.
`;
  await sock.sendMessage(jid, { text: helpText });
}

module.exports = { handleCommand };