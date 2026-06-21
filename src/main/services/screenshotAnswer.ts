import { desktopCapturer, nativeImage, screen } from 'electron';
import type OpenAI from 'openai';
import { getConfig } from './configStore';
import { streamChatCompletion } from './openAiCompatible';

let isGenerating = false;

const MAX_SHOT_WIDTH = 1600;
const JPEG_QUALITY = 72;

const systemPrompts = {
  general:
    '你是在线笔试/面试截图解题助手。用户给你一张屏幕截图，里面可能是选择题、填空题、问答题或算法题。请用简体中文：先用一句话点明题目要点，再直接给出准确答案；如果是选择题直接给出正确选项；最后附简要解析。不要寒暄、不要复述无关界面元素。',
  acm:
    '你是 ACM 算法竞赛解题助手。截图里是一道编程题。请用简体中文输出三部分：1) 简要解题思路；2) 时间/空间复杂度；3) 一份可直接提交的完整代码（默认 Python3，从标准输入读取、标准输出打印，正确处理边界与多组数据）。代码必须用三反引号代码块包裹。'
};

export async function captureScreenshot(): Promise<string> {
  try {
    const dynamicRequire = eval('require') as NodeRequire;
    const screenshot = dynamicRequire('screenshot-desktop') as (opts?: { format?: string }) => Promise<Buffer>;
    const png = await screenshot({ format: 'png' });
    if (png && png.length > 0) {
      return downscaleToDataUrl(png);
    }
  } catch (error) {
    console.warn('[screenshot] screenshot-desktop 不可用，回退 desktopCapturer：', error instanceof Error ? error.message : error);
  }

  return captureWithDesktopCapturer();
}

async function captureWithDesktopCapturer(): Promise<string> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const physicalWidth = Math.round(primaryDisplay.size.width * primaryDisplay.scaleFactor);
  const physicalHeight = Math.round(primaryDisplay.size.height * primaryDisplay.scaleFactor);
  const scale = physicalWidth > 1920 ? 1920 / physicalWidth : 1;
  const thumbnailSize = {
    width: Math.max(1, Math.round(physicalWidth * scale)),
    height: Math.max(1, Math.round(physicalHeight * scale))
  };

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize
  });
  const primarySource = sources.find((source) => source.display_id === String(primaryDisplay.id)) ?? sources[0];

  if (!primarySource || primarySource.thumbnail.isEmpty()) {
    throw new Error('未能截取屏幕，请检查屏幕录制权限');
  }

  return downscaleToDataUrl(primarySource.thumbnail.toPNG());
}

function downscaleToDataUrl(pngBuffer: Buffer): string {
  try {
    let image = nativeImage.createFromBuffer(pngBuffer);
    if (image.isEmpty()) {
      throw new Error('nativeImage 解析截图为空');
    }

    const { width } = image.getSize();
    if (width > MAX_SHOT_WIDTH) {
      image = image.resize({ width: MAX_SHOT_WIDTH });
    }

    if (image.isEmpty()) {
      throw new Error('nativeImage 缩放截图为空');
    }

    const jpeg = image.toJPEG(JPEG_QUALITY);
    if (jpeg.length === 0) {
      throw new Error('nativeImage JPEG 编码为空');
    }

    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch (error) {
    console.warn('[screenshot] 截图降采样失败，回退原始 PNG：', error instanceof Error ? error.message : error);
    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
  }
}

export async function generateScreenshotAnswer(options: { onDelta: (d: string) => void }): Promise<string> {
  if (isGenerating) {
    throw new Error('截图答题正在生成中，请稍后再试。');
  }

  isGenerating = true;
  try {
    const config = getConfig();
    const dataUrl = await captureScreenshot();
    const systemPrompt = systemPrompts[config.screenshotMode];
    const userText =
      config.screenshotMode === 'acm'
        ? '请识别截图中的算法竞赛题，并按要求输出简要思路、复杂度和完整 Python3 代码。'
        : '请识别截图中的题目内容，并按要求给出准确答案和简要解析。';
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userText
          },
          {
            type: 'image_url',
            image_url: {
              url: dataUrl
            }
          }
        ]
      }
    ];

    return streamChatCompletion(config.screenshotModel, messages, options.onDelta, {
      maxTokens: 1500,
      temperature: 0.2
    });
  } finally {
    isGenerating = false;
  }
}
