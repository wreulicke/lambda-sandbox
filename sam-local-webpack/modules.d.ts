
declare module "@slack/client" {
  interface OkResult {
    ok: true,
  }
  interface ErrorResult {
    ok: false,
    error: string
  }
  type Result = OkResult | ErrorResult

  interface WebChatApi {
    postMessage(channel: string, text: string, callback: (e: Error, result: Result) => void): void;
  }
  class WebClient {
    constructor(
      token: string
    )
    chat: WebChatApi
  }
  export { WebClient }
}