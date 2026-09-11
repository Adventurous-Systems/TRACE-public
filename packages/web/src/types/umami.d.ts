// Ambient types for the self-hosted Umami tracker, loaded same-origin from
// /stats/script.js. The tracker attaches `umami` to window and calls a global
// before-send hook named by the data-before-send attribute.
export {};

declare global {
  interface UmamiPayload {
    url?: string;
    referrer?: string;
    [key: string]: unknown;
  }

  interface Window {
    umami?: {
      track: (eventName: string, eventData?: Record<string, unknown>) => void;
    };
    __umamiBeforeSend?: (type: string, payload: UmamiPayload) => UmamiPayload;
  }
}
