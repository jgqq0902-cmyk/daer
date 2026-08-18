import {
  createAIWorkerMessageHandler,
  type AIWorkerRequest,
  type AIWorkerResponse,
} from './ai-worker-runtime';

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

const postResponse = (response: AIWorkerResponse) => {
  window.ReactNativeWebView?.postMessage(JSON.stringify(response));
};

const handleRequest = createAIWorkerMessageHandler(postResponse);

const postParseError = (rawData: unknown, error: unknown) => {
  postResponse({
    id: 'worker-parse-error',
    type: 'parse-error',
    success: false,
    error: {
      code: 'REQUEST_FAILED',
      message: `Failed to parse worker request: ${error instanceof Error ? error.message : String(error)} :: ${String(rawData)}`,
    },
  });
};

const onMessage = async (event: MessageEvent | { data?: string }) => {
  const rawData = event?.data;
  if (typeof rawData !== 'string' || rawData.length === 0) {
    return;
  }

  try {
    const request = JSON.parse(rawData) as AIWorkerRequest;
    await handleRequest(request);
  } catch (error) {
    postParseError(rawData, error);
  }
};

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('message', onMessage as EventListener);
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('message', onMessage as EventListener);
}

postResponse({
  id: 'worker-ready',
  type: 'ready',
  success: true,
  payload: { ready: true },
});
