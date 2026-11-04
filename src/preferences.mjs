import fs from 'node:fs/promises';
import path from 'node:path';

function isSupportedLocale(locale) {
  return locale === 'zh-CN' || locale === 'en-US';
}

export async function loadPreferences(runtime) {
  const file = path.join(runtime, 'preferences.json');
  const temporary = file + '.' + process.pid + '.tmp';
  const saved = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  let locale = isSupportedLocale(saved?.locale) ? saved.locale : 'zh-CN';
  let pending = Promise.resolve();

  return {
    get locale() { return locale; },
    setLocale(next) {
      if (!isSupportedLocale(next)) return Promise.reject(new Error('Unsupported locale'));
      const write = pending.then(async () => {
        if (next === locale) return;
        try {
          await fs.writeFile(temporary, JSON.stringify({ locale: next }, null, 2) + '\n', 'utf8');
          await fs.rename(temporary, file);
          locale = next;
        } catch (error) {
          await fs.rm(temporary, { force: true }).catch(() => {});
          throw error;
        }
      });
      pending = write.catch(() => {});
      return write;
    },
    flush: () => pending,
  };
}
