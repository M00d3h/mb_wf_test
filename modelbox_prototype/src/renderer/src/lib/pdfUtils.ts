import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const PDF_MAX_VISION_PAGES = 10;

export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ')
      .trim();
    if (text) pages.push(text);
  }
  return pages.join('\n\n');
}

export async function renderPdfPages(
  file: File,
): Promise<Array<{ dataUrl: string; page: number; totalPages: number }>> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = pdf.numPages;
  const pagesToRender = Math.min(totalPages, PDF_MAX_VISION_PAGES);
  const results: Array<{ dataUrl: string; page: number; totalPages: number }> = [];

  for (let i = 1; i <= pagesToRender; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    results.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), page: i, totalPages });
  }

  return results;
}
