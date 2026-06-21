import fs from 'node:fs';

export async function extractPdfText(filePath: string): Promise<string> {
  try {
    // 间接 require，确保 pdf-parse 缺失时不影响主进程启动。
    const dynamicRequire = eval('require') as NodeRequire;
    const pdfParse = dynamicRequire('pdf-parse') as (buffer: Buffer) => Promise<{ text?: string }>;
    const buffer = await fs.promises.readFile(filePath);
    const result = await pdfParse(buffer);
    return (result.text ?? '').trim();
  } catch (error) {
    console.warn('[pdf] 解析 PDF 失败或 pdf-parse 未安装：', error instanceof Error ? error.message : error);
    return '';
  }
}
