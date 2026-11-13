export interface ChatParams {
  system: string;
  prompt: string;
  label?: string;
}

export interface LlmClient {
  chat(params: ChatParams): Promise<string>;
}
