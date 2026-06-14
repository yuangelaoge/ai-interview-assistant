export interface GlobalTriggerHandle {
  stop: () => void;
}

type UiohookLike = {
  on: (eventName: string, listener: (event: unknown) => void) => void;
  start: () => void;
  stop: () => void;
  removeAllListeners?: () => void;
};

type UiohookModule = {
  uIOhook?: UiohookLike;
};

const TRIPLE_CLICK_WINDOW_MS = 600;

let activeHandle: GlobalTriggerHandle | undefined;

export function startTripleClickTrigger(onTrigger: () => void): GlobalTriggerHandle {
  if (activeHandle) {
    activeHandle.stop();
    activeHandle = undefined;
  }

  let uIOhook: UiohookLike;
  try {
    const dynamicRequire = eval('require') as NodeRequire;
    const module = dynamicRequire('uiohook-napi') as UiohookModule;
    if (!module.uIOhook) {
      throw new Error('uIOhook export missing');
    }
    uIOhook = module.uIOhook;
  } catch {
    console.warn('[globalTrigger] uiohook-napi 未安装，全局三击触发不可用');
    return { stop() {} };
  }

  const clickTimes: number[] = [];
  const onMouseDown = (): void => {
    const now = Date.now();
    clickTimes.push(now);

    while (clickTimes.length > 0 && now - clickTimes[0] > TRIPLE_CLICK_WINDOW_MS) {
      clickTimes.shift();
    }

    if (clickTimes.length >= 3) {
      clickTimes.length = 0;
      onTrigger();
    }
  };

  try {
    // macOS 下 uiohook 需要「辅助功能(Accessibility)」权限才能收到全局输入。
    uIOhook.on('mousedown', onMouseDown);
    uIOhook.start();
  } catch (error) {
    console.warn('[globalTrigger] uiohook-napi 启动失败，全局三击触发不可用：', error instanceof Error ? error.message : error);
    try {
      uIOhook.removeAllListeners?.();
      uIOhook.stop();
    } catch {
      // 启动失败后的清理错误不影响应用继续运行。
    }
    return { stop() {} };
  }

  let stopped = false;
  const handle: GlobalTriggerHandle = {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (activeHandle === handle) {
        activeHandle = undefined;
      }

      try {
        uIOhook.removeAllListeners?.();
        uIOhook.stop();
      } catch (error) {
        console.warn('[globalTrigger] 停止 uiohook-napi 失败：', error instanceof Error ? error.message : error);
      }
    }
  };

  activeHandle = handle;
  return handle;
}
