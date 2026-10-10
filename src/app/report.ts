/**
 * Save a report artefact (screenshot / CSV) under docs/reports via the
 * dev-server endpoint provided by scripts/vite-report-plugin.ts.
 * Only works on `npm run dev`.
 */

export async function saveReportFile(path: string, content: string): Promise<boolean> {
  const isDataUrl = content.startsWith('data:');
  const body = isDataUrl ? await (await fetch(content)).blob() : new Blob([content], { type: 'text/plain' });
  const res = await fetch(`/__report/file?path=${encodeURIComponent(path)}`, { method: 'POST', body });
  return res.ok;
}
