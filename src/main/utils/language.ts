import type { AnswerLanguage } from '../../shared/types';

export function answerLanguageDirective(lang: AnswerLanguage): string {
  switch (lang) {
    case 'zh':
      return '请用简体中文作答。';
    case 'en':
      return 'Please answer in English.';
    case 'ja':
      return '日本語で回答してください。';
    case 'ko':
      return '한국어로 답변해 주세요.';
    case 'auto':
    default:
      return '请用与面试官问题相同的语言作答。';
  }
}
