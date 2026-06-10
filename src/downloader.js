import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DOWNLOAD_DIR = join(__dirname, '../downloads');

if (!existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

export async function downloadMedia(url, format = 'both') {
  const timestamp = Date.now();
  const baseName = `media_${timestamp}`;
  let outputPath;
  let ytdlpArgs;

  const commonArgs = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android',
  ];

  if (format === 'audio') {
    outputPath = join(DOWNLOAD_DIR, `${baseName}.mp3`);
    ytdlpArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      ...commonArgs,
      '-o', outputPath,
      url,
    ];
  } else if (format === 'video') {
    outputPath = join(DOWNLOAD_DIR, `${baseName}.mp4`);
    ytdlpArgs = [
      '-f', 'bestvideo[ext=mp4]/bestvideo',
      '--no-audio',
      ...commonArgs,
      '-o', outputPath,
      url,
    ];
  } else {
    outputPath = join(DOWNLOAD_DIR, `${baseName}.mp4`);
    ytdlpArgs = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      ...commonArgs,
      '-o', outputPath,
      url,
    ];
  }

  try {
    await execFileAsync('yt-dlp', ytdlpArgs, { timeout: 120000 });

    if (!existsSync(outputPath)) {
      const ext = format === 'audio' ? 'mp3' : 'mp4';
      const possibleFiles = [
        outputPath,
        outputPath.replace(`.${ext}`, `.${ext}`),
      ];

      for (const p of possibleFiles) {
        if (existsSync(p)) {
          outputPath = p;
          break;
        }
      }
    }

    if (!existsSync(outputPath)) {
      throw new Error('الملف لم يُنشأ - ربما الرابط غير مدعوم');
    }

    const stat = statSync(outputPath);
    const fileSizeMB = stat.size / (1024 * 1024);

    return { path: outputPath, sizeMB: fileSizeMB };
  } catch (err) {
    if (existsSync(outputPath)) {
      try { unlinkSync(outputPath); } catch {}
    }
    throw new Error(`فشل التحميل: ${err.message}`);
  }
}

export function cleanupFile(filePath) {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {}
}
