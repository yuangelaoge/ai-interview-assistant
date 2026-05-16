import { AlertCircle, CheckCircle2, CircleDashed, Loader2, Radio } from 'lucide-react';
import type { ServiceStatus } from '../../../shared/types';

interface StatusPillProps {
  label: string;
  status: ServiceStatus;
}

const statusCopy: Record<ServiceStatus, string> = {
  idle: '待机',
  listening: '监听',
  thinking: '处理中',
  ready: '就绪',
  error: '异常'
};

export function StatusPill({ label, status }: StatusPillProps) {
  const Icon =
    status === 'ready'
      ? CheckCircle2
      : status === 'error'
        ? AlertCircle
        : status === 'thinking'
          ? Loader2
          : status === 'listening'
            ? Radio
            : CircleDashed;

  return (
    <span className={`status-pill status-${status}`}>
      <Icon size={14} className={status === 'thinking' ? 'spin' : undefined} />
      <span>{label}</span>
      <strong>{statusCopy[status]}</strong>
    </span>
  );
}
